import { Container, Graphics, Sprite, type Texture } from 'pixi.js'

import type { Card } from '../../core/types'
import { Tweener, easing } from '../anim'
import type { DeckAtlas } from './deckAtlas'

/**
 * Одна карта на столе: тень + лицо.
 *
 * Тень лежит в том же контейнере, что и карта, и это осознанно. При
 * подъёме она должна отъезжать и размываться синхронно с карточкой; если
 * держать её в отдельном слое, придётся дублировать всю анимацию.
 */
export class CardView {
  readonly root = new Container()
  private readonly shadow: Sprite
  private readonly face: Sprite

  /** Куда карта хочет вернуться. Драг двигает root, home не трогает. */
  homeX = 0
  homeY = 0

  private lift = 0
  private destroyed = false
  private flashG: Graphics | null = null

  constructor(
    readonly card: Card,
    private readonly atlas: DeckAtlas,
    shadowTexture: Texture,
  ) {
    this.shadow = new Sprite(shadowTexture)
    this.shadow.anchor.set(0.5)
    this.shadow.alpha = 0.34

    this.face = new Sprite(atlas.back)
    this.face.anchor.set(0.5)

    this.root.addChild(this.shadow, this.face)
    this.setLift(0)
    this.refresh()
  }

  /** Обновить лицо/рубашку под текущее состояние карты. */
  refresh(): void {
    this.face.texture = this.card.faceUp
      ? this.atlas.face(this.card.suit, this.card.rank)
      : this.atlas.back
  }

  resize(width: number, height: number): void {
    this.face.width = width
    this.face.height = height
    this.setLift(this.lift)
  }

  get width(): number {
    return this.face.width
  }

  get height(): number {
    return this.face.height
  }

  /**
   * Высота над столом, 0..1.
   *
   * Тень растёт, размывается и отъезжает по вектору от лампы — это и есть
   * весь «объём» без единой честной тени (§5). Карта одновременно чуть
   * увеличивается: подъём к глазу читается как приближение.
   */
  setLift(value: number): void {
    this.lift = value

    const spread = 1 + value * 0.55
    this.shadow.width = this.face.width * 1.18 * spread
    this.shadow.height = this.face.height * 1.18 * spread
    this.shadow.alpha = 0.30 + value * 0.16
    this.shadow.position.set(-value * this.face.width * 0.13, value * this.face.height * 0.14)

    // Масштаб подъёма живёт на root, а не на face: face.width задаёт
    // размер карты в раскладке, и смешивать его с подъёмом нельзя.
    this.root.scale.set(1 + value * 0.06)
  }

  /**
   * Пульс подсказки: тёплая рамка вспыхивает дважды и убирает себя сама.
   *
   * Подсказка обязана показывать ОБЕ стороны хода прямо на столе — тост
   * «колонка 3 → 7» тестеры не понимали. Цвет — от лампы (LED_ON семьи),
   * чтобы вспышка читалась как блик света, а не чужой UI.
   */
  flash(tweener: Tweener, delay = 0): void {
    this.clearFlash(tweener)
    const w = this.face.width
    const h = this.face.height
    const g = new Graphics()
    g.roundRect(-w / 2, -h / 2, w, h, w * 0.075)
      .fill({ color: 0xffd68c, alpha: 0.3 })
      .stroke({ color: 0xffe0a0, width: Math.max(3, w * 0.07), alpha: 1 })
    g.blendMode = 'add'
    g.alpha = 0
    this.root.addChild(g)
    this.flashG = g

    const pulse = (left: number): void => {
      tweener.to(g, { alpha: 1 }, {
        duration: 0.22,
        delay: left === 2 ? delay : 0,
        ease: easing.outCubic,
        onDone: () =>
          tweener.to(g, { alpha: 0 }, {
            duration: 0.38,
            ease: easing.outCubic,
            onDone: () => (left > 1 ? pulse(left - 1) : this.clearFlash(tweener)),
          }),
      })
    }
    pulse(2)
  }

  private clearFlash(tweener: Tweener): void {
    if (!this.flashG) return
    tweener.kill(this.flashG)
    if (!this.flashG.destroyed) this.flashG.destroy()
    this.flashG = null
  }

  /** Наклон по вектору скорости — карта «сопротивляется» рывку. */
  setTilt(vx: number, vy: number): void {
    this.root.rotation = Math.max(-0.13, Math.min(0.13, vx * 0.0016))
    this.face.skew.y = Math.max(-0.06, Math.min(0.06, -vy * 0.0006))
  }

  resetTilt(tweener: Tweener): void {
    tweener.to(this.root, { rotation: 0 }, { duration: 0.34, ease: easing.outBack })
    tweener.to(this.face.skew, { y: 0 }, { duration: 0.34, ease: easing.outBack })
  }

  moveHome(tweener: Tweener, options: { duration?: number; delay?: number; spring?: boolean } = {}): void {
    tweener.to(
      this.root,
      { x: this.homeX, y: this.homeY },
      {
        duration: options.duration ?? 0.3,
        delay: options.delay ?? 0,
        ease: options.spring ? easing.outBack : easing.outCubic,
      },
    )
  }

  snapHome(): void {
    this.root.position.set(this.homeX, this.homeY)
  }

  /**
   * Снять твины этой карты.
   *
   * Твины навешиваются на два разных объекта — root и face.skew, — поэтому
   * убрать их снаружи одним `kill(view.root)` нельзя. Метод обязан
   * вызываться перед destroy: иначе следующий кадр пишет в уничтоженный
   * Transform и валит цикл.
   */
  kill(tweener: Tweener): void {
    tweener.kill(this.root)
    tweener.kill(this.face.skew)
    this.clearFlash(tweener)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.root.destroy({ children: true })
  }

  get isDestroyed(): boolean {
    return this.destroyed
  }
}
