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
  private readonly clip = new Graphics()
  /** Отражение и его собственная маска — оно живёт НИЖЕ ватерлинии. */
  private readonly mirror: Sprite
  private readonly mirrorClip = new Graphics()
  private readonly open: Texture
  private readonly blink: Texture

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

  constructor(
    readonly spec: ActorSpec,
    open: Texture,
    blink: Texture,
    private readonly random: () => number = Math.random,
  ) {
    this.open = open
    this.blink = blink

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

    this.root.addChild(this.mirrorClip, this.mirror, this.clip, this.sprite)
    this.mirror.mask = this.mirrorClip
    this.sprite.mask = this.clip

    this.phaseLength = this.pick(HIDDEN_RANGE)
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

  update(dt: number): void {
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

    const bob = Math.sin(this.time * 1.1) * this.baseH * 0.012 * this.rise
    this.sprite.y = (1 - eased - overshoot) * this.diveScreen + bob

    // Отражение зеркалит спрайт относительно ватерлинии и дышит своей
    // фазой: настоящее отражение на ряби никогда не повторяет предмет
    // точно, оно чуть отстаёт и дрожит.
    const above = this.localWater - this.sprite.y
    this.mirror.y = this.localWater + above * 0.55 + Math.sin(this.time * 1.7) * this.baseH * 0.008
    this.mirror.alpha = this.spec.mirror === false ? 0 : 0.24 * this.rise

    // Волна ползёт вбок — маска шире кадра, поэтому сдвиг не открывает
    // краёв. Обе маски идут вместе, иначе кромка и отражение разъедутся.
    const drift = Math.sin(this.time * 0.23) * this.baseW * 0.5
    this.clip.x = drift
    this.mirrorClip.x = drift

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

  get state(): { phase: Phase; rise: number } {
    return { phase: this.phase, rise: this.rise }
  }
}
