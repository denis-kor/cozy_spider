import { Container, Graphics, Sprite, Texture } from 'pixi.js'

import type { ActorSpec } from '../types'

/**
 * Котик в пруду.
 *
 * Кадров анимации у него нет и не будет. Диффузионная модель не держит
 * персонажа между кадрами: восемь кадров всплытия дали бы восемь слегка
 * разных котов, и подряд это читалось бы особенно скверно.
 *
 * Поэтому картинок ровно две — глаза открыты и глаза закрыты, — а всё
 * движение считается здесь:
 *
 *   моргание   подмена текстуры на 90 мс по таймеру
 *   всплытие   вертикальный сдвиг неподвижного спрайта
 *   обрез      маска по ватерлинии
 *   качка      синус малой амплитуды
 *
 * Всплытие — вообще не анимация персонажа. Это перемещение картинки за
 * линию, ниже которой она обрезана. Ровно так это выглядит и в жизни.
 */

/** Сколько котик сидит под водой и сколько наверху, в секундах. */
const HIDDEN_RANGE: [number, number] = [14, 34]
const SURFACED_RANGE: [number, number] = [9, 20]

const RISE_TIME = 1.6
const SINK_TIME = 1.2
const BLINK_TIME = 0.09

type Phase = 'hidden' | 'rising' | 'surfaced' | 'sinking'

/**
 * Развернуть список пар x,y в обратном порядке.
 *
 * Верхняя фигура обходит кромку справа налево, нижняя — слева направо.
 * Полигон с самопересечением триангулируется в кашу, поэтому направление
 * обхода здесь не стилистика, а условие того, что маска вообще работает.
 */
function flipPairs(pairs: number[]): number[] {
  const out: number[] = []
  for (let i = pairs.length - 2; i >= 0; i -= 2) out.push(pairs[i], pairs[i + 1])
  return out
}

export class CatActor {
  readonly root = new Container()

  private readonly sprite: Sprite
  /** Контактная тень. Пустая, если в манифесте её не просили. */
  private readonly contact = new Graphics()
  private readonly clip = new Graphics()
  /** Отражение и его собственная маска — оно живёт НИЖЕ ватерлинии. */
  private readonly mirror: Sprite
  private readonly mirrorClip = new Graphics()
  private readonly open: Texture
  private readonly blink: Texture
  /** Позы победного финала. Нет в манифесте — финал деградирует в обычный. */
  private readonly watch?: Texture
  private readonly leap?: Texture

  /** 1 — как нарисован, -1 — зеркально. Прыжок нарисован влево, уходит вправо. */
  private facing = 1

  private phase: Phase = 'hidden'
  private phaseTime = 0
  private phaseLength: number

  /** 0 — под водой, 1 — всплыл полностью. */
  private rise = 0
  private time = 0

  private blinkIn: number
  private blinkLeft = 0

  private baseW = 0
  private baseH = 0
  private diveScreen = 0

  // Победное всплытие (только у пруда): котик высовывается из воды выше
  // обычного, подмигивает и ныряет обратно. Пока идёт — обычный цикл выключен,
  // но маска воды и отражение остаются: вид родной, ничего не обрезано лишнего.
  private celebrating = false
  private celebTime = 0
  private celebDone?: () => void
  private celebStartY = 0

  // Победный побег (Камчатка): встал, развернулся к сопке, посмотрел на
  // извержение и ускакал прыжком за правый косяк.
  private running = false
  private runTime = 0
  private runDone?: () => void

  constructor(
    readonly spec: ActorSpec,
    open: Texture,
    blink: Texture,
    private readonly random: () => number = Math.random,
    poses?: { watch?: Texture; leap?: Texture },
  ) {
    this.open = open
    this.blink = blink
    this.watch = poses?.watch
    this.leap = poses?.leap

    this.sprite = new Sprite(open)
    this.sprite.anchor.set(0.5, 0.5)

    // Отражение. Без него котик читается наклейкой поверх пруда: глаз
    // ищет ответ воды на предмет и, не находя, отказывается верить, что
    // предмет в воде.
    //
    // Отражение сплюснуто и приглушено — под таким углом обзора вода
    // возвращает сжатую и потерявшую контраст копию, а не зеркало.
    this.mirror = new Sprite(open)
    this.mirror.anchor.set(0.5, 0.5)
    this.mirror.scale.y = -1
    this.mirror.alpha = 0.24

    this.root.addChild(this.contact, this.mirrorClip, this.mirror, this.clip, this.sprite)

    // Обрез по воде нужен только там, где под котиком вода или кромка.
    // Нет ватерлинии — нет и маски: иначе её волнистый край ползёт вбок
    // по неподвижному котику и читается швом.
    if (spec.waterline !== undefined) {
      this.mirror.mask = this.mirrorClip
      this.sprite.mask = this.clip
    } else {
      this.mirror.visible = false
      this.mirrorClip.visible = false
      this.clip.visible = false
    }

    // Резидент начинает жизнь наверху: ему неоткуда всплывать.
    if (spec.resident) {
      this.phase = 'surfaced'
      this.rise = 1
    }
    this.phaseLength = spec.resident ? Number.POSITIVE_INFINITY : this.pick(HIDDEN_RANGE)
    this.blinkIn = this.pick([2, 7])
  }

  private pick(range: [number, number]): number {
    return range[0] + this.random() * (range[1] - range[0])
  }

  /**
   * Разместить в экранных координатах.
   *
   * `x`, `y` — куда попала точка привязки холста; `waterScreenY` — где на
   * экране оказалась ватерлиния. Маска рисуется до неё, а не до края
   * спрайта: обрезать надо по воде, иначе котик всплывает «сквозь стекло».
   */
  place(x: number, y: number, waterScreenY: number, scale: number): void {
    this.root.position.set(x, y)

    this.baseW = this.spec.size[0] * scale
    this.baseH = this.spec.size[1] * scale
    this.diveScreen = (this.spec.diveDepth ?? this.spec.size[1] * 0.55) * scale

    this.sprite.width = this.baseW
    this.sprite.height = this.baseH

    this.drawContact()

    // Без ватерлинии масок нет — строить полигоны не из чего и незачем.
    if (this.spec.waterline === undefined) {
      this.localWater = this.baseH
      return
    }

    this.mirror.width = this.baseW
    this.mirror.height = this.baseH * 0.55
    // Порядок важен: сеттер height пересчитывает scale.y из размера
    // текстуры и стирает знак, поставленный в конструкторе. Отражение
    // молча перестало бы быть отражением.
    this.mirror.scale.y = -Math.abs(this.mirror.scale.y)

    // Маски в локальных координатах контейнера, поэтому ватерлиния
    // пересчитывается относительно точки привязки.
    const localWater = waterScreenY - y
    const pad = this.baseW
    const tall = this.baseH * 2 + this.diveScreen

    // Кромка воды волнистая, а не прямая.
    //
    // Идеально горизонтальный обрез читается как картонка, вставленная в
    // прорезь. Волна нужна маленькая — пары процентов высоты головы
    // хватает, чтобы линия перестала быть чертёжной.
    //
    // Строится ОДИН раз на ресайз и втрое шире нужного, а анимируется
    // сдвигом маски вбок. Перестраивать полигон каждый кадр значило бы
    // аллоцировать в игровом цикле ради эффекта, который и так не виден.
    const amp = this.baseH * 0.022
    const span = pad * 3
    const step = this.baseW * 0.06

    const edge: number[] = []
    for (let x = -span; x <= span; x += step) {
      const w = Math.sin(x / (this.baseW * 0.28)) * amp
                + Math.sin(x / (this.baseW * 0.11) + 1.7) * amp * 0.45
      edge.push(x, localWater + w)
    }

    this.clip
      .clear()
      .poly([-span, -tall, span, -tall, ...flipPairs(edge)], true)
      .fill({ color: 0xffffff })

    this.mirrorClip
      .clear()
      .poly([...edge, span, localWater + tall, -span, localWater + tall], true)
      .fill({ color: 0xffffff })

    this.localWater = localWater
  }

  private localWater = 0

  /**
   * Контактная тень: три вложенных эллипса вместо размытия.
   *
   * Блюр потребовал бы отдельного прохода фильтра каждый кадр ради пятна,
   * на которое никто не смотрит прямо, — а замечают его только когда его
   * нет. Тень неподвижна: она принадлежит доске, а не котику, и не обязана
   * повторять его качку.
   */
  private drawContact(): void {
    const s = this.spec.shadow
    this.contact.clear()
    if (!s) return
    const cy = this.baseH * (s.y ?? 0.44)
    for (const [k, mul] of [[1.0, 0.3], [0.72, 0.34], [0.44, 0.36]] as const) {
      this.contact
        .ellipse(0, cy, this.baseW * s.w * 0.5 * k, this.baseH * s.w * 0.16 * k)
        .fill({ color: 0x130a05, alpha: s.a * mul })
    }
  }

  update(dt: number): void {
    if (this.running) {
      this.updateRun(dt)
      return
    }
    if (this.celebrating) {
      this.updateCelebration(dt)
      return
    }

    this.time += dt
    this.phaseTime += dt

    switch (this.phase) {
      case 'hidden':
        this.rise = 0
        if (this.phaseTime >= this.phaseLength) this.enter('rising', RISE_TIME)
        break

      case 'rising':
        this.rise = Math.min(1, this.phaseTime / RISE_TIME)
        if (this.phaseTime >= RISE_TIME) this.enter('surfaced', this.pick(SURFACED_RANGE))
        break

      case 'surfaced':
        this.rise = 1
        if (this.phaseTime >= this.phaseLength) this.enter('sinking', SINK_TIME)
        break

      case 'sinking':
        this.rise = Math.max(0, 1 - this.phaseTime / SINK_TIME)
        if (this.phaseTime >= SINK_TIME) this.enter('hidden', this.pick(HIDDEN_RANGE))
        break
    }

    // Всплытие с лёгким перелётом: голова чуть выныривает выше, чем
    // осядет. Без него подъём читается как лифт.
    const eased = this.rise < 1
      ? 1 - Math.pow(1 - this.rise, 3)
      : 1
    const overshoot = this.phase === 'rising' ? Math.sin(this.rise * Math.PI) * 0.08 : 0

    // Резидент лежит на доске: качка ему нужна только чтобы не быть
    // наклейкой, и она втрое тише, чем у плывущего.
    const amp = this.spec.resident ? 0.004 : 0.012
    const bob = Math.sin(this.time * 1.1) * this.baseH * amp * this.rise
    this.sprite.y = (1 - eased - overshoot) * this.diveScreen + bob

    // Отражение зеркалит спрайт относительно ватерлинии и дышит своей
    // фазой: настоящее отражение на ряби никогда не повторяет предмет
    // точно, оно чуть отстаёт и дрожит.
    const above = this.localWater - this.sprite.y
    this.mirror.y = this.localWater + above * 0.55 + Math.sin(this.time * 1.7) * this.baseH * 0.008
    this.mirror.alpha = this.spec.mirror === false ? 0 : 0.24 * this.rise

    // Волна ползёт вбок — маска шире кадра, поэтому сдвиг не открывает
    // краёв. Обе маски идут вместе, иначе кромка и отражение разъедутся.
    if (this.spec.waterline !== undefined) {
      const drift = Math.sin(this.time * 0.23) * this.baseW * 0.5
      this.clip.x = drift
      this.mirrorClip.x = drift
    }

    this.sprite.scale.x = Math.abs(this.sprite.scale.x) * this.facing

    // Моргать имеет смысл только когда глаза видно.
    if (this.rise > 0.8) {
      this.blinkLeft -= dt
      this.blinkIn -= dt
      if (this.blinkIn <= 0) {
        this.blinkLeft = BLINK_TIME
        this.blinkIn = this.pick([2.2, 6.5])
      }
      this.sprite.texture = this.blinkLeft > 0 ? this.blink : this.open
    } else {
      this.sprite.texture = this.open
    }
  }

  private enter(phase: Phase, length: number): void {
    this.phase = phase
    this.phaseTime = 0
    this.phaseLength = length
  }

  /** Для отладки и тестов: мгновенно всплыть. */
  surfaceNow(): void {
    this.enter('surfaced', this.pick(SURFACED_RANGE))
    this.rise = 1
  }

  /** Умеет ли эта сцена победный прыжок (флаг в данных сцены). */
  get canCelebrate(): boolean {
    return this.spec.winJump === true
  }

  /** Умеет ли котик победный побег: встал, посмотрел, ускакал. */
  get canRun(): boolean {
    return this.spec.winRun === true && !!this.watch && !!this.leap
  }

  /**
   * Финал победы: котик высовывается из воды выше обычного, мягко подмигивает
   * и ныряет обратно. `onDone` — когда нырнул (по нему показывается плашка
   * «Поздравляем»).
   */
  celebrate(onDone?: () => void): void {
    if (this.celebrating) return
    this.celebrating = true
    this.celebTime = 0
    this.celebDone = onDone
    // Всплываем плавно с текущей высоты — без рывка. Маска воды и отражение
    // остаются на месте: котик высовывается в родной воде, ничего не режется.
    this.celebStartY = this.sprite.y
    this.sprite.texture = this.open
  }

  private updateCelebration(dt: number): void {
    this.celebTime += dt
    this.time += dt
    const t = this.celebTime

    const RISE = 0.9 // всплыл выше обычного
    const HOLD = 2.1 // замер и подмигнул
    const SINK = 3.0 // нырнул обратно

    // Пик: выше обычного всплытия (у полного всплытия y ≈ 0). Не больше ~0.39
    // высоты головы — иначе нижняя кромка спрайта выйдет из-под воды.
    const peakY = -this.baseH * 0.3

    let target: number
    if (t < RISE) {
      const e = 1 - Math.pow(1 - t / RISE, 3) // плавно вверх
      target = this.celebStartY + (peakY - this.celebStartY) * e
      this.sprite.texture = this.open
    } else if (t < HOLD) {
      const h = t - RISE
      target = peakY
      // мягкое подмигивание в середине паузы
      this.sprite.texture = h > 0.5 && h < 0.9 ? this.blink : this.open
    } else if (t < SINK) {
      const k = (t - HOLD) / (SINK - HOLD)
      target = peakY + (this.diveScreen - peakY) * (k * k) // плавно вниз, под воду
      this.sprite.texture = this.open
    } else {
      this.endCelebration()
      return
    }

    const bob = Math.sin(this.time * 1.1) * this.baseH * 0.012
    this.sprite.y = target + bob

    // Отражение и волнистая кромка — как в обычном режиме: вид родной.
    const above = this.localWater - this.sprite.y
    this.mirror.y = this.localWater + above * 0.55 + Math.sin(this.time * 1.7) * this.baseH * 0.008
    this.mirror.alpha = this.spec.mirror === false ? 0 : 0.24
    const drift = Math.sin(this.time * 0.23) * this.baseW * 0.5
    this.clip.x = drift
    this.mirrorClip.x = drift
  }

  private endCelebration(): void {
    this.celebrating = false
    // Вернуться к обычному циклу — если игрок останется в сцене.
    this.enter('hidden', this.pick(HIDDEN_RANGE))
    this.rise = 0
    const done = this.celebDone
    this.celebDone = undefined
    done?.()
  }

  /**
   * Финал победы на Камчатке: встал, посмотрел на извержение, ускакал.
   *
   * `onDone` — когда скрылся за косяком. Прыжок нарисован влево, поэтому
   * спрайт зеркалится: уходит он вправо, туда, где стоит косяк окна.
   * Маска для ухода не нужна — косяк это слой ПОВЕРХ котика, он закроет
   * его сам.
   */
  runAway(onDone?: () => void): void {
    if (this.running || !this.canRun) return
    this.running = true
    this.runTime = 0
    this.runDone = onDone
    this.celebrating = false
  }

  private updateRun(dt: number): void {
    this.runTime += dt
    this.time += dt
    const t = this.runTime

    const STARTLE = 0.45 // вскинулся и развернулся
    const WATCH = 3.6    // стоит и смотрит
    const CROUCH = 3.85  // присел перед прыжком
    const LEAP = 4.9     // ушёл за косяк

    let x = 0
    let y = 0

    if (t < WATCH) {
      this.sprite.texture = this.watch!
      this.facing = 1
      // Подскок в момент, когда заметил: короткий, затухающий.
      const s = Math.max(0, 1 - t / STARTLE)
      y = -this.baseH * 0.05 * Math.sin(Math.min(1, t / STARTLE) * Math.PI) - s * 0
      // Дыхание, пока смотрит: иначе поза читается как наклейка.
      y += Math.sin(this.time * 1.4) * this.baseH * 0.006
    } else if (t < CROUCH) {
      this.sprite.texture = this.watch!
      this.facing = 1
      y = this.baseH * 0.035 * ((t - WATCH) / (CROUCH - WATCH))
    } else if (t < LEAP) {
      this.sprite.texture = this.leap!
      this.facing = -1
      const k = (t - CROUCH) / (LEAP - CROUCH)
      // Разгон: прыжок не равномерный, он выстреливает.
      const e = k * k * (3 - 2 * k)
      x = this.baseW * 1.25 * e
      // Дуга: вверх и вниз за один пролёт.
      y = -this.baseH * 0.3 * Math.sin(k * Math.PI)
    } else {
      this.endRun()
      return
    }

    this.sprite.x = x
    this.sprite.y = y
    this.sprite.scale.x = Math.abs(this.sprite.scale.x) * this.facing
    this.mirror.alpha = 0
    // Тень уезжает вместе с котиком: он в прыжке, под ним уже не доска.
    this.contact.x = x
    this.contact.alpha = Math.max(0, 1 - Math.abs(x) / (this.baseW * 0.7))
  }

  private endRun(): void {
    this.running = false
    this.contact.x = 0
    this.contact.alpha = 1
    // Котик ушёл. Пока сцена не перезагружена, он не возвращается:
    // «убежал и через секунду снова лежит» рушит всю сцену финала.
    this.sprite.visible = false
    const done = this.runDone
    this.runDone = undefined
    done?.()
  }

  /** Новая партия: вернуть на место и в обычный вид. */
  resetPose(): void {
    this.running = false
    this.contact.x = 0
    this.contact.alpha = 1
    this.celebrating = false
    this.facing = 1
    this.sprite.visible = true
    this.sprite.texture = this.open
    this.sprite.x = 0
    this.sprite.y = 0
    if (this.spec.resident) {
      this.phase = 'surfaced'
      this.rise = 1
      this.phaseTime = 0
      this.phaseLength = Number.POSITIVE_INFINITY
    } else {
      this.enter('hidden', this.pick(HIDDEN_RANGE))
      this.rise = 0
    }
  }

  get state(): { phase: Phase; rise: number } {
    return { phase: this.phase, rise: this.rise }
  }
}
