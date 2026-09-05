import { Container, Sprite, Texture } from 'pixi.js'

/**
 * Победное торжество сцены.
 *
 * Эффект задаётся манифестом (`"win"` в scene.json), а не кодом:
 *
 *   fireworks   салют над прудом: ракеты со шлейфами, залпы, отсвет неба
 *   starfall    таро: кометы с хвостами, золотая морось, блики-вспышки
 *
 * Контейнер живёт ВНУТРИ world — атмосферный проход (зерно, виньетка,
 * экспозиция) ложится и на праздник, иначе он выглядит наклейкой поверх
 * игры.
 *
 * Частицы — НЕ кружки Graphics, а спрайты с мягким радиальным градиентом
 * в аддитивном смешивании: это свет, а не конфетти. Быстрые частицы
 * вытягиваются вдоль скорости — дешёвый motion blur, который и делает
 * «как в генеративных скетчах»: шлейф, а не горох.
 *
 * `onPeak` дёргается один раз в разгаре (кошечка выпрыгивает из-за
 * салюта — вызывающий решает, что случится).
 */

export type WinEffect = 'fireworks' | 'starfall'

/** Сколько секунд идёт подсыпка нового; хвост дотлевает сам. */
const SPAWN_FOR = 5.2
const PEAK_AT = 1.5

const FIREWORK_PALETTES: number[][] = [
  [0xffd27f, 0xffb45e, 0xfff3d8], // янтарь керосинки
  [0xff9d8a, 0xe8788c, 0xffd8c9], // роза
  [0x9fd8c9, 0x7fc8b8, 0xe0fff3], // мята пруда
  [0xf3ecdb, 0xd8c9a0, 0xffffff], // бумага и луна
]
const GOLD = [0xffd27f, 0xf3ecdb, 0xe3b34f]

// ---------------------------------------------------------------------------
//  Текстуры частиц: рисуются один раз Canvas2D — Pixi Graphics не умеет
//  мягких краёв, а именно мягкий край превращает кружок в источник света.
// ---------------------------------------------------------------------------

let glowTexture: Texture | null = null

function glow(): Texture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  glowTexture = Texture.from(c)
  return glowTexture
}

let starTexture: Texture | null = null

/** Четырёхлучевая звезда с мягким ядром — для звездопада и бликов. */
function star(): Texture {
  if (starTexture) return starTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!

  const core = ctx.createRadialGradient(32, 32, 0, 32, 32, 10)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, 64, 64)

  // Лучи — вытянутые ромбы, сходящие на нет к кончикам.
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    ctx.beginPath()
    ctx.moveTo(32 + dx * 30, 32 + dy * 30)
    ctx.lineTo(32 + dy * 2.6, 32 + dx * 2.6)
    ctx.lineTo(32 - dy * 2.6, 32 - dx * 2.6)
    ctx.closePath()
    ctx.fill()
  }
  starTexture = Texture.from(c)
  return starTexture
}

// ---------------------------------------------------------------------------

type Kind = 'spark' | 'rocket' | 'comet' | 'glint' | 'flash'

interface Particle {
  kind: Kind
  s: Sprite
  vx: number
  vy: number
  age: number
  ttl: number
  gravity: number
  /** Трение: скорость гаснет экспоненциально — искры «повисают». */
  drag: number
  size: number
  /** Вытягивание вдоль скорости, 0 — не вытягивать. */
  stretch: number
  twinkle: number
  twinkleSpeed: number
  spin: number
  /** Ракеты и кометы сыплют за собой шлейф. */
  trailEvery: number
  trailIn: number
  /** Цвет залпа, которым ракета разорвётся. */
  burstPalette?: number[]
  /** Высота разрыва ракеты: долетела — рвётся. */
  burstY?: number
}

export class Celebration {
  readonly root = new Container()

  private parts: Particle[] = []
  private effect: WinEffect = 'fireworks'
  /** Время с запуска; отрицательное — торжество не идёт. */
  private t = -1
  private nextRocket = 0
  private nextComet = 0
  private nextGlint = 0
  private peakFired = true
  private onPeak?: () => void
  private w = 1
  private h = 1

  constructor() {
    this.root.eventMode = 'none'
  }

  resize(w: number, h: number): void {
    this.w = w
    this.h = h
  }

  get active(): boolean {
    return this.t >= 0
  }

  start(effect: WinEffect, onPeak?: () => void): void {
    this.effect = effect
    this.onPeak = onPeak
    this.peakFired = false
    this.t = 0
    this.nextRocket = 0.05
    this.nextComet = 0.2
    this.nextGlint = 0.4
  }

  update(dt: number): void {
    if (this.t < 0 && this.parts.length === 0) return

    if (this.t >= 0) {
      this.t += dt

      if (!this.peakFired && this.t >= PEAK_AT) {
        this.peakFired = true
        this.onPeak?.()
      }

      if (this.t <= SPAWN_FOR) this.spawn(dt)
      else this.t = -1 // подсыпка кончилась, дальше только дотлевание
    }

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.age += dt

      // Ракета рвётся, долетев до своей высоты (или на излёте, если
      // трение съело скорость раньше).
      if (p.kind === 'rocket'
        && (p.s.y <= (p.burstY ?? 0) || p.vy > -this.h * 0.04 || p.age >= p.ttl)) {
        this.burst(p.s.x, p.s.y, p.burstPalette ?? FIREWORK_PALETTES[0])
        p.s.destroy()
        this.parts.splice(i, 1)
        continue
      }

      if (p.age >= p.ttl || p.s.y > this.h + p.size * 4) {
        p.s.destroy()
        this.parts.splice(i, 1)
        continue
      }

      const damp = p.drag ? Math.exp(-p.drag * dt) : 1
      p.vx *= damp
      p.vy = p.vy * damp + p.gravity * dt
      p.s.x += p.vx * dt
      p.s.y += p.vy * dt

      // Шлейф: маленькие гаснущие огоньки в точке, где частица была.
      if (p.trailEvery > 0) {
        p.trailIn -= dt
        if (p.trailIn <= 0) {
          p.trailIn = p.trailEvery
          this.trailDot(p)
        }
      }

      const life = 1 - p.age / p.ttl
      const tw = p.twinkle ? 0.6 + 0.4 * Math.sin(p.age * p.twinkleSpeed + p.twinkle) : 1

      if (p.kind === 'glint') {
        // Блик: беззвучная вспышка на месте — разгорается и тает.
        const env = Math.sin(Math.min(1, p.age / p.ttl) * Math.PI)
        p.s.alpha = env * tw
        p.s.scale.set((p.size / 32) * (0.6 + env * 0.4))
        p.s.rotation += p.spin * dt
        continue
      }

      if (p.kind === 'flash') {
        p.s.alpha = 0.32 * life * life
        continue
      }

      p.s.alpha = life * tw

      if (p.stretch > 0) {
        // Вытянуть вдоль скорости: быстрое — черта, повисшее — точка.
        const speed = Math.hypot(p.vx, p.vy)
        p.s.rotation = Math.atan2(p.vy, p.vx)
        p.s.scale.set(
          (p.size / 32) * (1 + (speed / this.h) * p.stretch),
          p.size / 32,
        )
      } else {
        p.s.rotation += p.spin * dt
      }
    }
  }

  // ------------------------------------------------------------------ спавн

  private spawn(dt: number): void {
    if (this.effect === 'fireworks') {
      this.nextRocket -= dt
      if (this.nextRocket <= 0) {
        this.nextRocket = 0.55 + Math.random() * 0.4
        this.rocket()
      }
      return
    }

    // starfall: кометы + непрерывная золотая морось + блики.
    this.nextComet -= dt
    if (this.nextComet <= 0) {
      this.nextComet = 0.6 + Math.random() * 0.5
      this.comet()
    }

    const rate = 14
    let n = Math.floor(rate * dt) + (Math.random() < ((rate * dt) % 1) ? 1 : 0)
    while (n-- > 0) this.fallingStar()

    this.nextGlint -= dt
    if (this.nextGlint <= 0) {
      this.nextGlint = 0.25 + Math.random() * 0.35
      this.glint()
    }
  }

  /**
   * Аддитив — это свет: над тёмной водой он горит, но поверх БЕЛОЙ карты
   * невидим начисто (белее белого не бывает). Всё, что летает над
   * раскладкой, идёт обычным смешиванием, аддитив — только тому, что
   * живёт в тёмной части кадра.
   */
  private sprite(tex: Texture, color: number, size: number, blend: 'add' | 'normal' = 'add'): Sprite {
    const s = new Sprite(tex)
    s.anchor.set(0.5)
    s.tint = color
    s.blendMode = blend
    s.scale.set(size / 32)
    this.root.addChild(s)
    return s
  }

  private push(p: Particle, x: number, y: number): void {
    p.s.position.set(x, y)
    this.parts.push(p)
  }

  /** Ракета: светящаяся точка летит вверх, сыпля шлейф, и рвётся в небе. */
  private rocket(): void {
    const palette = FIREWORK_PALETTES[(Math.random() * FIREWORK_PALETTES.length) | 0]
    const x = this.w * (0.15 + Math.random() * 0.7)
    const size = Math.max(5, this.h * 0.011)

    this.push({
      kind: 'rocket',
      s: this.sprite(glow(), palette[2], size),
      vx: this.w * (Math.random() * 0.06 - 0.03),
      vy: -this.h * (0.85 + Math.random() * 0.2),
      age: 0,
      ttl: 2.5,
      gravity: this.h * 0.42,
      drag: 0.35,
      size,
      stretch: 5,
      twinkle: 0,
      twinkleSpeed: 0,
      spin: 0,
      trailEvery: 0.016,
      trailIn: 0,
      burstPalette: palette,
      // Рвётся над водой, в тёмной половине кадра: выше начинается
      // раскладка, и аддитивный свет тонет в белых картах.
      burstY: this.h * (0.5 + Math.random() * 0.14),
    }, x, this.h + size)
  }

  /** Разрыв: отсвет на полнеба и шар искр со шлейфами у крупных. */
  private burst(x: number, y: number, palette: number[]): void {
    // Отсвет: огромное мягкое пятно, которое коротко подсвечивает сцену.
    // Именно он продаёт залп: свет случился В МИРЕ, а не поверх него.
    const flashSize = this.h * 0.7
    this.push({
      kind: 'flash',
      s: this.sprite(glow(), palette[0], flashSize),
      vx: 0, vy: 0, age: 0, ttl: 0.55,
      gravity: 0, drag: 0, size: flashSize,
      stretch: 0, twinkle: 0, twinkleSpeed: 0, spin: 0,
      trailEvery: 0, trailIn: 0,
    }, x, y)

    const count = 60 + ((Math.random() * 25) | 0)
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      // Кубический корень — равномерное заполнение шара, а не кольцо.
      const speed = this.h * (0.3 + Math.random() * 0.1) * Math.cbrt(Math.random())
      const big = Math.random() < 0.25
      const size = Math.max(4, this.h * (big ? 0.017 : 0.01))

      this.push({
        kind: 'spark',
        s: this.sprite(glow(), palette[(Math.random() * palette.length) | 0], size),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        ttl: 1.7 + Math.random() * 1.2,
        gravity: this.h * 0.13,
        drag: 1.2,
        size,
        stretch: 6,
        twinkle: Math.random() < 0.5 ? Math.random() * Math.PI * 2 : 0,
        twinkleSpeed: 11 + Math.random() * 8,
        spin: 0,
        trailEvery: big ? 0.03 : 0,
        trailIn: 0,
      }, x, y)
    }
  }

  /** Гаснущий огонёк там, где только что была ракета или крупная искра. */
  private trailDot(parent: Particle): void {
    const size = parent.size * (0.4 + Math.random() * 0.25)
    this.push({
      kind: 'spark',
      s: this.sprite(glow(), parent.s.tint as number, size),
      vx: this.w * (Math.random() * 0.02 - 0.01),
      vy: 0,
      age: 0,
      ttl: 0.35 + Math.random() * 0.3,
      gravity: this.h * 0.03,
      drag: 0,
      size,
      stretch: 0,
      twinkle: 0,
      twinkleSpeed: 0,
      spin: 0,
      trailEvery: 0,
      trailIn: 0,
    }, parent.s.x, parent.s.y)
  }

  /** Комета: пересекает верх кадра по диагонали, оставляя золотой хвост. */
  private comet(): void {
    const fromLeft = Math.random() < 0.5
    const size = Math.max(5, this.h * 0.012)
    const speed = this.w * (0.5 + Math.random() * 0.25)

    this.push({
      kind: 'comet',
      s: this.sprite(glow(), GOLD[0], size, 'normal'),
      vx: fromLeft ? speed : -speed,
      vy: this.h * (0.16 + Math.random() * 0.14),
      age: 0,
      ttl: 1.6,
      gravity: 0,
      drag: 0,
      size,
      stretch: 7,
      twinkle: 0,
      twinkleSpeed: 0,
      spin: 0,
      trailEvery: 0.014,
      trailIn: 0,
    }, fromLeft ? -size * 2 : this.w + size * 2, this.h * (0.04 + Math.random() * 0.3))
  }

  /** Медленно падающая мерцающая звёздочка — фон звездопада. */
  private fallingStar(): void {
    const size = this.h * (0.012 + Math.random() * 0.012)
    const fall = this.h * (0.08 + Math.random() * 0.1)
    this.push({
      kind: 'spark',
      s: this.sprite(star(), GOLD[(Math.random() * GOLD.length) | 0], size, 'normal'),
      vx: this.w * (Math.random() * 0.04 - 0.015),
      vy: fall,
      age: 0,
      ttl: (this.h * (0.5 + Math.random() * 0.25)) / fall,
      gravity: 0,
      drag: 0,
      size,
      stretch: 0,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 5 + Math.random() * 5,
      spin: (Math.random() - 0.5) * 1.4,
    trailEvery: 0,
      trailIn: 0,
    }, this.w * Math.random(), -size)
  }

  /** Блик: звезда вспыхивает на месте и тает — пыльца волшебства. */
  private glint(): void {
    const size = this.h * (0.02 + Math.random() * 0.03)
    this.push({
      kind: 'glint',
      s: this.sprite(star(), GOLD[(Math.random() * GOLD.length) | 0], size, 'normal'),
      vx: 0,
      vy: 0,
      age: 0,
      ttl: 0.7 + Math.random() * 0.7,
      gravity: 0,
      drag: 0,
      size,
      stretch: 0,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 9,
      spin: (Math.random() - 0.5) * 0.8,
      trailEvery: 0,
      trailIn: 0,
    }, this.w * (0.05 + Math.random() * 0.9), this.h * (0.05 + Math.random() * 0.75))
  }
}
