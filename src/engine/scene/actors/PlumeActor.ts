import { Container, Sprite, Texture } from 'pixi.js'

import type { ActorSpec } from '../types'

/**
 * Столб пепла над кратером.
 *
 * Картинка одна и неподвижная — всё извержение считается здесь. Это то же
 * решение, что у котика: диффузионная модель не держит форму между
 * кадрами, и двенадцать кадров дыма подряд читались бы как мельтешение,
 * а не как один растущий столб.
 *
 * Поэтому столб не анимирован, а РАСТЁТ: спрайт привязан за ножку —
 * низ картинки, и по горизонтали не центр, а точка выхода дыма из горы —
 * и масштабируется от нуля вверх. Ровно так это и выглядит: столб не
 * меняет форму, он поднимается и раздувается.
 *
 * До победы актор существует, но невидим. Грузится вместе со сценой —
 * весит двести килобайт, ленивая догрузка тут не окупается.
 */

/**
 * Столб растёт НЕ равномерно: сначала вверх, потом вширь.
 *
 * Равномерный масштаб давал куст: картинка широкая, и на малом масштабе
 * из кратера вылезала маленькая шапка, лежащая на снегу. Настоящий выброс
 * сначала бьёт струёй, и только потом верх распускается.
 */
const RISE_H = 2.4
// Ширина догоняет к тому моменту, когда котик уже смотрит на сопку:
// шапка обязана распуститься ДО его прыжка, иначе главный кадр финала
// приходится на недораспустившийся столб.
const RISE_W = 3.4
/** Проявление — быстрее роста: дым виден раньше, чем достигнет неба. */
const FADE_IN = 1.1
/** С чего начинается высота и с чего ширина. Ноль нельзя: будет точка. */
const START_H = 0.12
const START_W = 0.05

export class PlumeActor {
  readonly root = new Container()

  private readonly sprite: Sprite
  private time = 0
  /** Отрицательное — извержения ещё не было. */
  private erupted = -1
  private baseW = 0
  private baseH = 0

  constructor(readonly spec: ActorSpec, texture: Texture) {
    this.sprite = new Sprite(texture)
    // Привязка за ножку: по горизонтали — где дым выходит из кратера,
    // по вертикали — низ картинки. Масштабирование от этой точки и даёт
    // рост вверх, а не раздувание во все стороны.
    this.sprite.anchor.set(spec.stem ?? 0.5, 1)
    this.sprite.alpha = 0
    this.sprite.visible = false
    this.root.addChild(this.sprite)
  }

  place(x: number, y: number, scale: number): void {
    this.root.position.set(x, y)
    this.baseW = this.spec.size[0] * scale
    this.baseH = this.spec.size[1] * scale
  }

  /**
   * Жерло в экранных координатах: откуда сыплются угли.
   *
   * Celebration не знает ни про сцену, ни про параллакс, ни про фокус —
   * поэтому точку ему даёт тот, кто её и так считает каждый кадр. Иначе
   * угли приходится ставить в долях экрана, и на другом вьюпорте они
   * оказываются на склоне.
   */
  get ventX(): number {
    return this.root.x + this.baseW * 0.02
  }

  get ventY(): number {
    return this.root.y - this.baseH * 0.14
  }

  /** Рвануло. Идемпотентно: повторный вызов ничего не сбрасывает. */
  erupt(): void {
    if (this.erupted >= 0) return
    this.erupted = 0
    this.sprite.visible = true
  }

  /** Вернуть в спокойное состояние — новая партия. */
  reset(): void {
    this.erupted = -1
    this.sprite.visible = false
    this.sprite.alpha = 0
  }

  update(dt: number): void {
    this.time += dt
    if (this.erupted < 0) return
    this.erupted += dt

    const t = this.erupted
    // Обе огибающие с торможением: выстреливает и осаживается. Линейный
    // рост читается как лифт.
    const gh = 1 - Math.pow(1 - Math.min(1, t / RISE_H), 2.6)
    const gw = 1 - Math.pow(1 - Math.min(1, t / RISE_W), 1.7)
    const kh = START_H + (1 - START_H) * gh
    const kw = START_W + (1 - START_W) * gw

    // Дыхание: столб продолжает жить и после выхода на высоту, иначе
    // кадр застывает ровно в тот момент, когда игрок на него смотрит.
    const breathe = 1 + Math.sin(this.time * 0.6) * 0.02 * gw

    this.sprite.width = this.baseW * kw * breathe
    this.sprite.height = this.baseH * kh
    // Снос вбок: ветер уносит верхушку. Считается от роста, а не от
    // времени — молодой столб ещё некуда сносить.
    this.sprite.x = this.baseW * 0.05 * gw + Math.sin(this.time * 0.35) * this.baseW * 0.012
    this.sprite.alpha = Math.min(1, t / FADE_IN)
  }
}
