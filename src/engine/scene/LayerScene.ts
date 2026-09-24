import { Assets, Container, Sprite, Texture } from 'pixi.js'

import { WaterFilter } from '../filters/WaterFilter'
import { WindFilter } from '../filters/WindFilter'
import { CatActor } from './actors/CatActor'
import { FlameActor } from './actors/FlameActor'
import { PlumeActor } from './actors/PlumeActor'
import { RadioActor } from './actors/RadioActor'
import { versioned } from '../assetVersion'
import { loadLayerTexture, runLimited } from '../textureLoad'
import type { LoadProgress } from '../loading'
import type { Ambience } from './Ambience'
import type { ActorSpec, LayerSpec, SceneSpec } from './types'

/** Сколько секунд идёт перекрёстное затухание вариантных слоёв. */
const VARIANT_FADE = 1.4

/**
 * Какую долю запаса под параллакс разрешено потратить на смещение кадра.
 *
 * Остаток — ход камеры: при размахе 0.3 и параллаксе 0.34 слой ездит на
 * 0.1 слака, так что 0.3 в резерве хватает с запасом. Забрать всё значило
 * бы поменять чёрную полосу снизу на чёрную полосу сбоку.
 */
const FOCUS_LIMIT = 0.7

/** Как грузить сцену: бюджет памяти под устройство. */
export interface SceneLoadOptions {
  /** Множитель размера текстур слоёв: 1 — как есть, 0.5 — вдвое меньше (телефон). */
  layerTextureScale?: number
  /** Сколько картинок декодировать одновременно. */
  loadConcurrency?: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

interface BuiltLayer {
  spec: LayerSpec
  sprite: Sprite
  water?: WaterFilter
  wind?: WindFilter
}

export interface BuiltActor {
  spec: ActorSpec
  flame?: FlameActor
  cat?: CatActor
  radio?: RadioActor
  plume?: PlumeActor
}

/**
 * Сцена как стопка слоёв с параллаксом.
 *
 * Сейчас в манифесте один слой-плейсхолдер — целая картинка. Когда она
 * будет разрезана, меняется только массив layers в scene.json: код здесь
 * не трогается вообще. Ради этого манифест и заведён до нарезки.
 */
export class LayerScene {
  readonly root = new Container()

  /**
   * Зоны нажатия интерактивных предметов сцены.
   *
   * Живут отдельным контейнером, потому что стол пасьянса перекрывает
   * весь экран своей областью попадания. Stage кладёт этот слой ПОВЕРХ
   * стола — иначе кнопки магнитофона не получили бы ни одного клика.
   */
  readonly input = new Container()

  private layers: BuiltLayer[] = []
  private actors: BuiltActor[] = []
  private spec!: SceneSpec
  private normalMap!: Texture

  /**
   * Подмена слоёв на время торжества (извержение Камчатки).
   *
   * Вариантный слой кладётся в стопку сразу ПОВЕРХ своего оригинала и
   * проявляется. Так подмена не требует ни выгрузки текстур, ни
   * перестройки сцены — и ровно поэтому она обратима одной строкой.
   */
  private variants: Sprite[] = []
  /** Отрицательное — торжества нет. Иначе секунды с начала затухания. */
  private winFade = -1
  private winLoading = false
  private baseUrl = ''
  private texScale = 1

  /** Куда «смотрит» камера: -1..1 по обеим осям. */
  private targetX = 0
  private targetY = 0
  private camX = 0
  private camY = 0

  private viewW = 1
  private viewH = 1

  /**
   * Обратный множитель к уменьшению текстур слоёв. На телефоне слои
   * загружены вдвое меньше (0.5), значит на экране их надо растянуть в
   * 1/0.5 = 2 раза, чтобы кадр сошёлся. На десктопе — 1, ничего не меняет.
   */
  private layerTexScale = 1

  async load(
    baseUrl: string,
    commonUrl: string,
    progress?: LoadProgress,
    opts?: SceneLoadOptions,
  ): Promise<void> {
    const [spec, normalMap] = await Promise.all([
      Assets.load<SceneSpec>(versioned(`${baseUrl}/scene.json`)),
      Assets.load<Texture>(versioned(`${commonUrl}/water-normal.png`)),
    ])
    this.spec = spec
    this.normalMap = normalMap
    this.baseUrl = baseUrl

    // Normal-map тайлится — иначе на швах вылезет разрыв освещения.
    this.normalMap.source.addressMode = 'repeat'

    // Бюджет памяти под устройство. На телефоне слои грузим вдвое меньше
    // (иначе Safari убивает WebGL-контекст ещё на декоде — §13, жалоба с
    // iPhone) и декодируем не всё разом, а пачками, чтобы срезать пиковый
    // всплеск памяти на старте.
    const texScale = opts?.layerTextureScale ?? 1
    const concurrency = opts?.loadConcurrency ?? 8
    this.layerTexScale = texScale > 0 ? 1 / texScale : 1
    this.texScale = texScale

    // Слои и их маски — те самые тяжёлые мастера 2560×1600, их и уменьшаем.
    const layerUrls = new Set<string>()
    for (const layer of this.spec.layers) {
      layerUrls.add(layer.src)
      if (layer.effects?.length && layer.mask) layerUrls.add(layer.mask)
    }
    // Акторы (пламя, котик, кассетник) — мелкие спрайты, и их пиксельный
    // размер держит геометрию сцены; грузим как есть.
    const actorUrls = new Set<string>()
    for (const actor of this.spec.actors ?? []) {
      if (actor.src) actorUrls.add(actor.src)
      if (actor.blinkSrc) actorUrls.add(actor.blinkSrc)
      if (actor.watchSrc) actorUrls.add(actor.watchSrc)
      if (actor.leapSrc) actorUrls.add(actor.leapSrc)
    }

    progress?.add(layerUrls.size + actorUrls.size)
    const textures = new Map<string, Texture>()

    // Последовательные await складывали задержки двух десятков запросов;
    // грузим параллельно, но с потолком одновременных ради памяти телефона.
    const tasks: Array<() => Promise<void>> = []
    for (const url of layerUrls) {
      tasks.push(async () => {
        textures.set(url, await loadLayerTexture(versioned(`${baseUrl}/${url}`), texScale))
        progress?.tick()
      })
    }
    for (const url of actorUrls) {
      tasks.push(async () => {
        textures.set(url, await Assets.load<Texture>(versioned(`${baseUrl}/${url}`)))
        progress?.tick()
      })
    }
    await runLimited(tasks, concurrency)

    // Сборка — синхронно и в порядке манифеста: порядок детей root это
    // порядок параллакса, его нельзя отдавать на волю гонки загрузки.
    for (const spec of this.spec.layers) {
      const sprite = new Sprite(textures.get(spec.src))
      sprite.anchor.set(0.5)

      const built: BuiltLayer = { spec, sprite }
      const filters = []

      if (spec.effects?.length && spec.mask) {
        const mask = textures.get(spec.mask)!

        if (spec.effects.includes('water')) {
          built.water = new WaterFilter({
            normalMap: this.normalMap,
            mask,
            amplitude: 7.0 * (spec.intensity ?? 1),
          })
          filters.push(built.water)
        }
        if (spec.effects.includes('wind')) {
          built.wind = new WindFilter({ mask, amplitude: 5.0 * (spec.intensity ?? 1) })
          filters.push(built.wind)
        }
      }

      if (filters.length) sprite.filters = filters

      this.root.addChild(sprite)
      this.layers.push(built)
    }

    this.buildActors(textures)
  }

  /**
   * Акторы кладутся поверх слоёв.
   *
   * Порядок внутри стопки слоёв им не нужен: пламя светится поверх лампы,
   * котик — поверх воды, и оба живут на переднем плане сцены. Когда
   * появятся все тринадцать слоёв, у актора добавится поле «за каким
   * слоем», а пока лишняя сущность только мешала бы.
   */
  private buildActors(textures: Map<string, Texture>): void {
    for (const spec of this.spec.actors ?? []) {
      // У магнитофона картинка необязательна — он умеет рисовать себя сам.
      const texture = spec.src ? textures.get(spec.src) : undefined

      if (spec.type === 'radio') {
        const radio = new RadioActor(spec, texture)
        this.insertActor(radio.root, spec.after)
        this.input.addChild(radio.input)
        this.actors.push({ spec, radio })
        continue
      }

      if (!texture) {
        console.warn(`[scene] у актора «${spec.id}» нет src`)
        continue
      }

      if (spec.type === 'flame') {
        const flame = new FlameActor(spec, texture)
        this.insertActor(flame.root, spec.after)
        this.actors.push({ spec, flame })
        continue
      }

      if (spec.type === 'plume') {
        const plume = new PlumeActor(spec, texture)
        this.insertActor(plume.root, spec.after)
        this.actors.push({ spec, plume })
        continue
      }

      const blinkTexture = (spec.blinkSrc ? textures.get(spec.blinkSrc) : undefined) ?? texture
      const cat = new CatActor(spec, texture, blinkTexture, Math.random, {
        watch: spec.watchSrc ? textures.get(spec.watchSrc) : undefined,
        leap: spec.leapSrc ? textures.get(spec.leapSrc) : undefined,
      })
      this.insertActor(cat.root, spec.after)
      this.actors.push({ spec, cat })
    }
  }

  /**
   * Вставить актора сразу за указанным слоем.
   *
   * Глубина актора — не то же самое, что его параллакс. Пламя едет вместе
   * с лампой, но обязано быть ПОД стеклом; котик едет с водой, но должен
   * оказаться над кувшинками и под цветами переднего плана. Один параллакс
   * этого не выражает.
   */
  private insertActor(node: Container, after?: string): void {
    if (!after) {
      this.root.addChild(node)
      return
    }

    const target = this.layers.find((l) => l.spec.id === after)
    if (!target) {
      console.warn(`[scene] актор ссылается на слой «${after}», которого нет`)
      this.root.addChild(node)
      return
    }

    this.root.addChildAt(node, this.root.getChildIndex(target.sprite) + 1)
  }

  /**
   * Извержение: подменить слои, поднять столб.
   *
   * Вариантные текстуры грузятся здесь, а не вместе со сценой: два лишних
   * холста 2560x1600 в памяти — это 32 МБ GPU, которые на телефоне стоят
   * дороже, чем полсекунды ожидания раз в партию. Пока грузится, торжество
   * уже идёт — задержка приходится на разгон салюта и не видна.
   */
  async erupt(): Promise<void> {
    const variant = this.spec.winVariant
    if (this.winLoading || this.winFade >= 0 || !variant?.layers?.length) {
      this.actors.find((a) => a.plume)?.plume?.erupt()
      return
    }
    this.winLoading = true

    // Столб поднимается сразу: он не ждёт неба, он его и поджигает.
    this.actors.find((a) => a.plume)?.plume?.erupt()

    const loaded = await Promise.all(
      variant.layers.map(async (v) => ({
        v,
        tex: await loadLayerTexture(versioned(`${this.baseUrl}/${v.src}`), this.texScale),
      })),
    )

    for (const { v, tex } of loaded) {
      const base = this.layers.find((l) => l.spec.id === v.id)
      if (!base) {
        console.warn(`[scene] подмена ссылается на слой «${v.id}», которого нет`)
        continue
      }
      const sprite = new Sprite(tex)
      sprite.anchor.set(0.5)
      sprite.scale.copyFrom(base.sprite.scale)
      sprite.position.copyFrom(base.sprite.position)
      sprite.alpha = 0
      // Сразу ПОВЕРХ оригинала: всё, что было впереди него, впереди и
      // останется — в том числе столб, вставленный за конусом.
      this.root.addChildAt(sprite, this.root.getChildIndex(base.sprite) + 1)
      // Едет с тем же параллаксом, поэтому просто становится слоем.
      this.layers.push({ spec: { ...base.spec, id: `${v.id}.win`, src: v.src }, sprite })
      this.variants.push(sprite)
    }

    this.winLoading = false
    this.winFade = 0
  }

  /** Муд, в который уезжает сцена на время торжества. */
  get winMood(): string | undefined {
    return this.spec.winVariant?.mood
  }

  /** Новая партия: погасить извержение. */
  resetWin(): void {
    this.winFade = -1
    for (const v of this.variants) v.alpha = 0
    this.actors.find((a) => a.plume)?.plume?.reset()
    this.actors.find((a) => a.cat)?.cat?.resetPose()
  }

  /** Актор по идентификатору — для отладки и настройки позиции вживую. */
  actor(id: string): BuiltActor | undefined {
    return this.actors.find((a) => a.spec.id === id)
  }

  get sceneSpec(): SceneSpec {
    return this.spec
  }

  /** Указатель в координатах вьюпорта. Управляет параллаксом. */
  pointTo(px: number, py: number): void {
    // Демпфер отклика на мышь. На полной амплитуде фон ощутимо ездил за
    // курсором во время игры и отвлекал от карт (фидбек тестеров). Слабое
    // движение сохраняет глубину сцены, но перестаёт спорить со столом.
    const sway = 0.3
    this.targetX = ((px / this.viewW) * 2 - 1) * sway
    this.targetY = ((py / this.viewH) * 2 - 1) * sway
  }

  resize(width: number, height: number): void {
    this.viewW = width
    this.viewH = height

    const [dw, dh] = this.spec.designSize
    // cover + запас под параллакс
    const scale = Math.max(width / dw, height / dh) * (1 + this.spec.overscan)

    for (const layer of this.layers) {
      // layerTexScale возвращает уменьшенным на телефоне слоям их экранный
      // размер: текстура вдвое меньше — рисуем вдвое крупнее.
      layer.sprite.scale.set(scale * this.layerTexScale)
    }
  }

  update(dt: number, ambience: Ambience): void {
    // Перекрёстное затухание вариантных слоёв. Идёт своим счётчиком, а не
    // от Ambience: муд меняется за 2 с, а небо должно загореться быстрее.
    if (this.winFade >= 0 && this.variants.length) {
      this.winFade += dt
      const k = Math.min(1, this.winFade / VARIANT_FADE)
      const eased = k * k * (3 - 2 * k)
      for (const v of this.variants) v.alpha = eased
    }

    // Камера догоняет указатель с инерцией. Мгновенная привязка к мыши
    // читается как дёрганье; вся мягкость сцены живёт в этом лаге.
    const k = 1 - Math.exp(-dt * 3.2)
    this.camX += (this.targetX - this.camX) * k
    this.camY += (this.targetY - this.camY) * k

    const [dw, dh] = this.spec.designSize
    const scale = Math.max(this.viewW / dw, this.viewH / dh) * (1 + this.spec.overscan)
    const slackX = (dw * scale - this.viewW) * 0.5
    const slackY = (dh * scale - this.viewH) * 0.5

    // Смещение видимого окна. Знак обратный: чтобы показать НИЗ холста,
    // стопку надо поднять.
    const [fx, fy] = this.spec.focus ?? [0.5, 0.5]
    const biasX = clamp(-(fx - 0.5) * 2 * slackX, -slackX * FOCUS_LIMIT, slackX * FOCUS_LIMIT)
    const biasY = clamp(-(fy - 0.5) * 2 * slackY, -slackY * FOCUS_LIMIT, slackY * FOCUS_LIMIT)

    const [lx, ly] = this.spec.light.pos
    const color = ambience.current.lightColor

    for (const layer of this.layers) {
      const p = layer.spec.parallax
      layer.sprite.position.set(
        this.viewW * 0.5 + biasX - this.camX * slackX * p,
        this.viewH * 0.5 + biasY - this.camY * slackY * p,
      )

      if (layer.water) {
        layer.water.time = ambience.time
        layer.water.flicker = ambience.flicker
        layer.water.setLight(lx, ly, color)
      }
      if (layer.wind) {
        layer.wind.time = ambience.time
        layer.wind.gust = ambience.gust
      }
    }

    // Акторы заданы в координатах холста, поэтому переводятся в экранные
    // тем же масштабом и тем же сдвигом параллакса, что и слои. Иначе при
    // движении камеры пламя уехало бы от лампы.
    for (const actor of this.actors) {
      const p = actor.spec.parallax
      const originX = this.viewW * 0.5 + biasX - this.camX * slackX * p
      const originY = this.viewH * 0.5 + biasY - this.camY * slackY * p

      const [ax, ay] = actor.spec.anchor
      const sx = originX + (ax - dw * 0.5) * scale
      const sy = originY + (ay - dh * 0.5) * scale

      if (actor.flame) {
        actor.flame.place(sx, sy, scale)
        actor.flame.update(dt, ambience.flicker)
      }
      if (actor.cat) {
        const waterY = originY + ((actor.spec.waterline ?? ay) - dh * 0.5) * scale
        actor.cat.place(sx, sy, waterY, scale)
        actor.cat.update(dt)
      }
      if (actor.radio) {
        actor.radio.place(sx, sy, scale)
        actor.radio.update(dt, ambience.flicker)
      }
      if (actor.plume) {
        actor.plume.place(sx, sy, scale)
        actor.plume.update(dt)
      }
    }
  }
}
