import { Container, Rectangle, Sprite, Texture } from 'pixi.js'

import type { ActorSpec } from '../types'

/**
 * Пламя лампы.
 *
 * Единственное место во всей сцене, где кадровая анимация оправдана: язычок
 * огня меняет форму нелинейно, и никакая математика не даст того же за
 * сравнимые деньги. Шестнадцать кадров весят 240 КБ — дешевле, чем шейдер,
 * который пытался бы это подделать.
 *
 * Складывается АДДИТИВНО: это свет, а не наклейка. При обычном смешивании
 * огонь выглядел бы вырезанным из бумаги и наклеенным поверх лампы.
 *
 * Яркость берётся из общего `flicker`, а не из собственного таймера — тем
 * же значением дышат гало вокруг лампы, блик на воде и экспозиция кадра
 * (§15.3). Огонь один на всю сцену.
 */
export class FlameActor {
  readonly root = new Container()

  private readonly sprite: Sprite
  private readonly frames: Texture[] = []
  private readonly fps: number

  private time = 0

  constructor(
    readonly spec: ActorSpec,
    sheet: Texture,
  ) {
    const [cols, rows] = spec.grid ?? [4, 4]
    const fw = sheet.frame.width / cols
    const fh = sheet.frame.height / rows

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.frames.push(
          new Texture({
            source: sheet.source,
            frame: new Rectangle(sheet.frame.x + c * fw, sheet.frame.y + r * fh, fw, fh),
          }),
        )
      }
    }

    this.fps = spec.fps ?? 12

    this.sprite = new Sprite(this.frames[0])
    // Привязка по низу: в манифесте указан кончик фитиля, а не центр
    // пламени. От фитиля огонь и растёт вверх.
    this.sprite.anchor.set(0.5, 1)
    this.sprite.blendMode = 'add'

    this.root.addChild(this.sprite)
  }

  /** Базовый размер в пикселях экрана. Хранится, чтобы мерцание не копилось. */
  private baseW = 0
  private baseH = 0

  /** Разместить в экранных координатах с заданным масштабом холста. */
  place(x: number, y: number, scale: number): void {
    this.root.position.set(x, y)
    this.baseW = this.spec.size[0] * scale
    this.baseH = this.spec.size[1] * scale
    this.sprite.width = this.baseW
    this.sprite.height = this.baseH
  }

  update(dt: number, flicker: number): void {
    this.time += dt
    const index = Math.floor(this.time * this.fps) % this.frames.length
    this.sprite.texture = this.frames[index]

    // Мерцание бьёт по яркости сильнее, чем по размеру: настоящий язычок
    // меняет светимость заметно, а высоту — едва. Размер считается от
    // базового, а не от текущего: иначе множитель копится кадр за кадром
    // и огонь либо схлопывается, либо разрастается на весь экран.
    this.sprite.alpha = 0.55 + 0.45 * flicker
    this.sprite.width = this.baseW
    this.sprite.height = this.baseH * (0.93 + 0.07 * flicker)
  }
}
