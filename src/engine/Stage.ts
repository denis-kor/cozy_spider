import { Application, Container, RenderTexture } from 'pixi.js'

import { Game } from '../core/game'
import { pickEasySeed } from '../core/rules'
import type { SuitCount } from '../core/types'
import { CardTable } from './cards/CardTable'
import { loadDeckArt } from './cards/deckArt'
import { AtmosphereFilter } from './filters/AtmosphereFilter'
import type { LoadProgress } from './loading'
import { Celebration, type WinEffect } from './scene/Celebration'
import { Ambience } from './scene/Ambience'
import { LayerScene } from './scene/LayerScene'
import type { RadioActor } from './scene/actors/RadioActor'
import { detectDeviceProfile } from './deviceProfile'
import { TIERS, TierProbe, type QualityTier } from './quality'

export interface StageOptions {
  host: HTMLElement
  sceneUrl: string
  commonUrl: string
  /** Папка с иллюстрациями колоды. Отсутствует — играем на заглушках. */
  deckUrl?: string
  seed?: number
  suits?: SuitCount
  /**
   * Ход загрузки ассетов — для бегунка на заставке. Знаменатель дорастает
   * по мере чтения манифестов, см. LoadProgress.
   */
  onProgress?: (done: number, total: number) => void
}

export class Stage {
  readonly app = new Application()
  readonly ambience = new Ambience()
  readonly scene = new LayerScene()

  /**
   * Контейнер под весь мир: фон И карты.
   *
   * Карты лежат внутри, а не поверх, намеренно. Атмосферный проход висит
   * на этом контейнере, поэтому гало лампы, мерцание пламени, дождь и
   * виньетка ложатся и на карты тоже — без единой дополнительной строки.
   * Это и есть связка «один огонь на всю сцену» (§15.3). DOM-оверлей HUD
   * остаётся снаружи и ничего этого не получает.
   */
  readonly world = new Container()

  table!: CardTable

  private atmosphere!: AtmosphereFilter
  /**
   * Силуэт карт для атмосферного прохода: гало лампы не должно
   * просвечивать сквозь бумагу. Рендерится каждый кадр перед постом —
   * карты двигаются. Полразрешения хватает: краю силуэта лёгкая мягкость
   * только на пользу, это полутень.
   */
  private cardOcclusion!: RenderTexture
  private celebration = new Celebration()
  private probe = new TierProbe()
  private tier: QualityTier = 'high'
  private tierResolved = false
  private onTierResolved?: (tier: QualityTier) => void

  async init(options: StageOptions): Promise<void> {
    await this.app.init({
      background: '#0d1512',
      antialias: false,
      // §5: клампить DPR. На 3x-экранах телефона нативный рендер площади
      // в 9 раз убивает любой пост.
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: options.host,
      preference: 'webgl',
      powerPreference: 'high-performance',
    })

    options.host.appendChild(this.app.canvas)

    // Потеря контекста: на телефоне Safari может отобрать WebGL под нехваткой
    // памяти. По умолчанию браузер теряет его насовсем; preventDefault
    // оставляет шанс на восстановление, а колбэк даёт приложению показать
    // человеку, что случилось, вместо немого чёрного экрана.
    const canvas = this.app.canvas as HTMLCanvasElement
    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault()
        console.warn('[stage] WebGL-контекст потерян (вероятно, нехватка памяти)')
        this.onContextLost?.()
      },
      false,
    )

    // Профиль устройства: на телефоне уменьшаем текстуры слоёв и режем
    // параллелизм декода — иначе Safari роняет загрузку на нехватке памяти.
    const device = detectDeviceProfile()

    // Сцена и колода не зависят друг от друга и едут параллельно — как и
    // картинки внутри каждой из них. Прогресс обеих стекается в один
    // счётчик: у заставки один бегунок, а не два.
    let done = 0
    let total = 0
    const progress: LoadProgress = {
      add: (count) => {
        total += count
        options.onProgress?.(done, total)
      },
      tick: () => {
        done += 1
        options.onProgress?.(done, total)
      },
    }

    // Иллюстрации колоды необязательны: игра обязана запускаться без художника.
    const [, art] = await Promise.all([
      this.scene.load(options.sceneUrl, options.commonUrl, progress, {
        layerTextureScale: device.layerTextureScale,
        loadConcurrency: device.loadConcurrency,
      }),
      options.deckUrl ? loadDeckArt(options.deckUrl, progress, device.loadConcurrency) : undefined,
    ])

    // Стартовое настроение — из манифеста сцены. У пруда это совпадает с
    // дефолтом Ambience, поэтому пропажа этой строки не была видна; у
    // сцены таро дождь в комнате выдал бы её с головой.
    this.ambience.setMood(this.scene.sceneSpec.defaultMood)

    // Сид по умолчанию — случайный. Детерминированный «расклад дня»
    // (dailySeed) остаётся отдельной фишкой и должен включаться явно:
    // молчаливый дневной сид на старте выглядит как сломанный рандом —
    // весь день одна и та же раздача.
    const suits = options.suits ?? 1
    // Стартовый расклад тоже облегчаем: без явного сида берём «дружелюбный»
    // (pickEasySeed), иначе самая первая партия шла бы мимо облегчения.
    const game = new Game(options.seed ?? pickEasySeed(suits), suits)
    this.table = new CardTable(game, {
      renderer: this.app.renderer,
      locale: 'en',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      art,
    })

    // Зоны нажатия предметов сцены кладутся ПОВЕРХ стола: у стола область
    // попадания на весь экран, и кнопки под ним были бы недоступны.
    // Сами предметы при этом остаются в сцене и рисуются на своём месте.
    // Торжество — поверх всего в world: салют светит и над картами, но
    // атмосферный проход ложится и на него.
    this.world.addChild(this.scene.root, this.table.root, this.scene.input, this.celebration.root)
    this.app.stage.addChild(this.world)

    this.table.onWon = () => this.celebrate()
    this.table.onNewDeal = () => this.resetCelebration()

    this.cardOcclusion = RenderTexture.create({
      width: this.app.screen.width,
      height: this.app.screen.height,
      resolution: 0.5,
    })
    // Разрешение фильтра в Pixi — абсолютное, а не доля от рендерера:
    // без множителя пост на DPR-2 экране рисовал бы весь world (включая
    // карты) в половину нативных пикселей и растягивал — мыло.
    this.atmosphere = new AtmosphereFilter({
      resolution: TIERS[this.tier].postResolution * this.app.renderer.resolution,
      occlusion: this.cardOcclusion,
    })
    this.world.filters = [this.atmosphere]

    this.applyTier(this.tier)
    this.handleResize()

    this.app.renderer.on('resize', this.handleResize)
    options.host.addEventListener('pointermove', this.handlePointer)

    // DPR живой страницы меняется: окно уехало на монитор с другим
    // масштабом, зум браузера, или страница стартовала до того, как
    // браузер сообщил настоящий DPR. Без пересчёта игра навсегда
    // остаётся в разрешении первого кадра — то самое «мыло на другом
    // компьютере». matchMedia — канонический способ поймать смену;
    // подписка одноразовая, поэтому перевешиваемся после каждого
    // срабатывания.
    this.watchDpr()

    // Прогрев: прогнать кадр до того, как пользователь что-то тронет,
    // иначе первый подъём карты даст фриз на компиляции программы (§13).
    this.app.renderer.render(this.app.stage)

    this.app.ticker.add((ticker) => this.frame(ticker.deltaMS))
  }

  onTier(cb: (tier: QualityTier) => void): void {
    this.onTierResolved = cb
  }

  get currentTier(): QualityTier {
    return this.tier
  }

  get fps(): number {
    return this.app.ticker.FPS
  }

  /**
   * Кассетник на столе, если он есть в сцене.
   *
   * Точка подключения плеера: `stage.radio.onCommand` получает нажатия,
   * `playing` и `setLabel` управляют видом. Звук актор не трогает —
   * он про кнопки, а не про аудио.
   */
  get radio(): RadioActor | undefined {
    return this.scene.actor('radio')?.radio
  }

  /**
   * Запустить победное торжество сцены.
   *
   * Эффект берётся из манифеста (`win` в scene.json), в разгаре из
   * укрытия выныривает котик — он есть в обеих сценах, и его появление
   * и есть «поздравление» от сцены.
   */
  /** Дёргается при старте торжества — приложение навешивает свою подачу. */
  onCelebrate?: (effect: WinEffect) => void

  /**
   * Дёргается при потере WebGL-контекста (на телефоне — обычно нехватка
   * памяти). Приложение показывает человеку сообщение вместо чёрного экрана.
   */
  onContextLost?: () => void

  /**
   * Дёргается, когда торжество можно закрыть плашкой «Поздравляем»: у пруда —
   * после того как котик ускакал за кадр, у прочих сцен — по таймеру.
   */
  onFinale?: () => void

  celebrate(): void {
    if (this.celebration.active) return
    const effect = this.scene.sceneSpec.win ?? 'fireworks'
    const cat = this.scene.actor('cat')?.cat

    // Извержение начинается сразу, а не в разгаре: столб обязан успеть
    // подняться, пока котик ещё лежит. Иначе он вскидывается на пустое
    // небо, и вся причинность финала читается задом наперёд.
    if (effect === 'eruption') {
      void this.scene.erupt()
      const mood = this.scene.winMood
      if (mood) this.ambience.setMood(mood)
    }

    this.celebration.start(effect, () => {
      if (cat?.canRun) {
        // Камчатка: встал, посмотрел на сопку и ускакал за косяк.
        cat.runAway(() => this.onFinale?.())
      } else if (cat?.canCelebrate) {
        // Пруд: котик высовывается из воды выше обычного, подмигивает и ныряет;
        // плашку показываем, когда он нырнул обратно.
        cat.celebrate(() => this.onFinale?.())
      } else {
        // Прочие сцены: котик просто выныривает, плашка — по таймеру.
        cat?.surfaceNow()
        setTimeout(() => this.onFinale?.(), 1500)
      }
    })
    this.onCelebrate?.(effect)
  }

  /** Новая партия: свернуть торжество и вернуть сцене обычный вид. */
  resetCelebration(): void {
    this.scene.resetWin()
    this.ambience.setMood(this.scene.sceneSpec.defaultMood)
  }

  private frame(deltaMs: number): void {
    if (!this.tierResolved) {
      const resolved = this.probe.sample(deltaMs)
      if (resolved) {
        this.tierResolved = true
        if (resolved !== this.tier) this.applyTier(resolved)
        this.onTierResolved?.(resolved)
      }
    }

    const dt = Math.min(deltaMs, 50) / 1000
    this.ambience.update(dt)
    this.scene.update(dt, this.ambience)
    this.table.update(dt)
    this.celebration.resize(this.app.screen.width, this.app.screen.height)
    // Жерло знает сцена: его экранная точка зависит от параллакса, фокуса
    // и вьюпорта. Без этого угли задаются долей кадра и на другом экране
    // сыплются со склона.
    const plume = this.scene.actor('plume')?.plume
    if (plume) this.celebration.setOrigin(plume.ventX, plume.ventY)
    this.celebration.update(dt)

    const a = this.ambience
    const spec = this.scene.sceneSpec
    this.atmosphere.time = a.time
    this.atmosphere.flicker = a.flicker
    this.atmosphere.exposure = a.current.exposure
    this.atmosphere.vignette = a.current.vignette
    this.atmosphere.rain = a.current.rain * TIERS[this.tier].rain
    this.atmosphere.dust = a.current.dust * TIERS[this.tier].dust
    this.atmosphere.lightIntensity = a.current.lightIntensity
    this.atmosphere.setLight(spec.light.pos[0], spec.light.pos[1], a.current.lightColor)

    // Силуэт карт — до основного рендера кадра (пост читает эту текстуру).
    // table.root живёт в единичной трансформации, поэтому его рендер «как
    // есть» уже совпадает с экранными UV атмосферного фильтра.
    this.app.renderer.render({ container: this.table.root, target: this.cardOcclusion, clear: true })
  }

  private applyTier(tier: QualityTier): void {
    this.tier = tier
    const t = TIERS[tier]
    this.atmosphere.resolution = t.postResolution * this.app.renderer.resolution
    this.atmosphere.grain = t.grain
    this.atmosphere.aberration = t.aberration
  }

  private watchDpr(): void {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mq.addEventListener(
      'change',
      () => {
        this.handleDprChange()
        this.watchDpr()
      },
      { once: true },
    )
  }

  private handleDprChange(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (this.app.renderer.resolution === dpr) return
    this.app.renderer.resolution = dpr
    // Разрешение пост-прохода абсолютное — пересчитать вслед за рендерером.
    this.applyTier(this.tier)
    // resize() перекраивает бэкинг канваса под новую resolution и роняет
    // событие 'resize' — там уже обновятся сцена, стол и маска карт.
    this.app.resize()
  }

  private handleResize = (): void => {
    const { width, height } = this.app.screen
    this.scene.resize(width, height)
    this.table.resize(width, height)
    this.atmosphere.aspect = width / height
    // resize() меняет источник на месте, привязка в фильтре остаётся живой.
    this.cardOcclusion.resize(width, height)
  }

  private handlePointer = (e: PointerEvent): void => {
    this.scene.pointTo(e.clientX, e.clientY)
  }
}
