/**
 * Минимальный твинер, работающий от тикера сцены.
 *
 * Готовые библиотеки крутят собственный requestAnimationFrame. Здесь это
 * мешает: анимации должны замирать вместе с игровым циклом при уходе
 * вкладки в фон (§7) и подчиняться тирам качества, а ещё — идти в
 * headless-проверке, где кадры прогоняются вручную.
 */

export type Easing = (t: number) => number

export const easing = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),

  /**
   * Проскок цели с мягким возвратом (§12: «пружина, не линейный твин»).
   * Карта на секунду уходит чуть дальше, чем нужно, и оседает — именно
   * этот перелёт читается как вес предмета.
   */
  outBack: (t: number) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
  },

  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t
    const c4 = (2 * Math.PI) / 3
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  },
}

interface Tween {
  target: Record<string, number>
  from: Record<string, number>
  to: Record<string, number>
  keys: string[]
  duration: number
  delay: number
  elapsed: number
  ease: Easing
  onDone?: () => void
  killed: boolean
}

export interface TweenOptions {
  duration?: number
  delay?: number
  ease?: Easing
  onDone?: () => void
}

export class Tweener {
  private tweens: Tween[] = []

  /**
   * Анимировать числовые поля объекта. Повторный вызов на тот же объект
   * снимает предыдущие твины по тем же полям — иначе два твина дерутся
   * за одно свойство и получается дрожь.
   */
  to(target: object, props: Record<string, number>, options: TweenOptions = {}): void {
    const t = target as Record<string, number>
    const keys = Object.keys(props)

    for (const tween of this.tweens) {
      if (tween.target === t) {
        for (const key of keys) {
          const i = tween.keys.indexOf(key)
          if (i >= 0) tween.keys.splice(i, 1)
        }
        if (tween.keys.length === 0) tween.killed = true
      }
    }

    const from: Record<string, number> = {}
    for (const key of keys) from[key] = t[key]

    this.tweens.push({
      target: t,
      from,
      to: { ...props },
      keys,
      duration: Math.max(options.duration ?? 0.3, 1e-4),
      delay: options.delay ?? 0,
      elapsed: 0,
      ease: options.ease ?? easing.outCubic,
      onDone: options.onDone,
      killed: false,
    })
  }

  /** Снять все твины объекта, оставив его там, где он сейчас. */
  kill(target: object): void {
    for (const tween of this.tweens) {
      if (tween.target === (target as Record<string, number>)) tween.killed = true
    }
  }

  /**
   * Снять вообще всё.
   *
   * Нужно при пересборке сцены: твин, переживший уничтожение своей цели,
   * на следующем кадре пишет в мёртвый объект и роняет весь игровой цикл.
   */
  killAll(): void {
    this.tweens.length = 0
  }

  get busy(): boolean {
    return this.tweens.length > 0
  }

  update(dt: number): void {
    if (this.tweens.length === 0) return

    let write = 0
    for (let i = 0; i < this.tweens.length; i++) {
      const tween = this.tweens[i]
      if (tween.killed) continue

      if (tween.delay > 0) {
        tween.delay -= dt
        this.tweens[write++] = tween
        continue
      }

      tween.elapsed += dt
      const p = Math.min(1, tween.elapsed / tween.duration)
      const k = tween.ease(p)

      for (const key of tween.keys) {
        tween.target[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * k
      }

      if (p >= 1) {
        tween.onDone?.()
      } else {
        this.tweens[write++] = tween
      }
    }
    this.tweens.length = write
  }
}
