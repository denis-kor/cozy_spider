import { Assets, Container, Sprite, Texture } from 'pixi.js'

import { WaterFilter } from '../filters/WaterFilter'
import { WindFilter } from '../filters/WindFilter'
import { CatActor } from './actors/CatActor'
import { FlameActor } from './actors/FlameActor'
import { RadioActor } from './actors/RadioActor'
import { versioned } from '../assetVersion'
import type { LoadProgress } from '../loading'
import type { Ambience } from './Ambience'
import type { ActorSpec, LayerSpec, SceneSpec } from './types'

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

  /** Куда «смотрит» камера: -1..1 по обеим осям. */
  private targetX = 0
  private targetY = 0
  private camX = 0
  private camY = 0

  private viewW = 1
  private viewH = 1

  async load(baseUrl: string, commonUrl: string, progress?: LoadProgress): Promise<void> {
    const [spec, normalMap] = await Promise.all([
      Assets.load<SceneSpec>(versioned(`${baseUrl}/scene.json`)),
      Assets.load<Texture>(versioned(`${commonUrl}/water-normal.png`)),
    ])
    this.spec = spec
    this.normalMap = normalMap

    // Normal-map тайлится — иначе на швах вылезет разрыв освещения.
    this.normalMap.source.addressMode = 'repeat'

    // Все картинки сцены — одной параллельной пачкой. Последовательные
    // await складывали задержки двух десятков запросов друг на друга:
    // на быстрой сети незаметно, на мобильной — секунды чёрного экрана.
    const urls = new Set<string>()
    for (const layer of this.spec.layers) {
      urls.add(layer.src)
      if (layer.effects?.length && layer.mask) urls.add(layer.mask)
    }
    for (const actor of this.spec.actors ?? []) {
      if (actor.src) urls.add(actor.src)
      if (actor.blinkSrc) urls.add(actor.blinkSrc)
    }

    progress?.add(urls.size)
    const textures = new Map<string, Texture>()
    await Promise.all(
      [...urls].map(async (url) => {
        textures.set(url, await Assets.load<Texture>(versioned(`${baseUrl}/${url}`)))
        progress?.tick()
      }),
    )

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

      const blinkTexture = (spec.blinkSrc ? textures.get(spec.blinkSrc) : undefined) ?? texture
      const cat = new CatActor(spec, texture, blinkTexture)
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
      layer.sprite.scale.set(scale)
    }
  }

  update(dt: number, ambience: Ambience): void {
    // Камера догоняет указатель с инерцией. Мгновенная привязка к мыши
    // читается как дёрганье; вся мягкость сцены живёт в этом лаге.
    const k = 1 - Math.exp(-dt * 3.2)
    this.camX += (this.targetX - this.camX) * k
    this.camY += (this.targetY - this.camY) * k

    const [dw, dh] = this.spec.designSize
    const scale = Math.max(this.viewW / dw, this.viewH / dh) * (1 + this.spec.overscan)
    const slackX = (dw * scale - this.viewW) * 0.5
    const slackY = (dh * scale - this.viewH) * 0.5

    const [lx, ly] = this.spec.light.pos
    const color = ambience.current.lightColor

    for (const layer of this.layers) {
      const p = layer.spec.parallax
      layer.sprite.position.set(
        this.viewW * 0.5 - this.camX * slackX * p,
        this.viewH * 0.5 - this.camY * slackY * p,
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
      const originX = this.viewW * 0.5 - this.camX * slackX * p
      const originY = this.viewH * 0.5 - this.camY * slackY * p

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
    }
  }
}
