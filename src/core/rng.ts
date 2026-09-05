/**
 * Детерминированный ГСЧ.
 *
 * Math.random() здесь не годится: от сида зависят расклад дня, шеринг
 * «сыграй мой расклад», воспроизведение багов и тесты. Один и тот же сид
 * обязан давать один и тот же расклад на любой машине и в любой версии.
 *
 * mulberry32 — 32-битный, быстрый, с достаточным для карт качеством.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Перемешивание Фишера–Йетса на месте. */
export function shuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
  return items
}

/** Сид расклада дня. Одинаков для всех игроков в пределах суток UTC. */
export function dailySeed(date: Date): number {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  return (y * 10000 + m * 100 + d) >>> 0
}
