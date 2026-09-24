/**
 * Единый источник правды по «настроению» сцены.
 *
 * Правило, ради которого этот класс вообще существует: всё, что мигает,
 * колышется и меняет цвет, читает значения ОТСЮДА. Ни один эффект не
 * заводит собственный таймер.
 *
 * Иначе получается набор независимо анимированных картинок. Уют возникает
 * ровно в тот момент, когда пламя, гало вокруг лампы, блик на воде и
 * подсветка поднятой карты дышат синхронно — потому что это физически
 * один и тот же огонь.
 */

/** Пресет станции. Станция = настроение = SKU (§7 дока). */
export interface Mood {
  id: string
  /** Цвет ключевого света, линейный RGB 0..1. */
  lightColor: [number, number, number]
  lightIntensity: number
  rain: number
  dust: number
  wind: number
  exposure: number
  vignette: number
}

export const MOODS: Record<string, Mood> = {
  rainyEvening: {
    id: 'rainyEvening',
    lightColor: [1.0, 0.74, 0.42],
    lightIntensity: 0.32,
    rain: 0.85,
    dust: 0.18,
    wind: 0.55,
    exposure: 1.18,
    vignette: 0.16,
  },
  candles: {
    id: 'candles',
    lightColor: [1.0, 0.66, 0.30],
    lightIntensity: 0.5,
    rain: 0.0,
    dust: 0.55,
    wind: 0.18,
    exposure: 0.94,
    vignette: 0.30,
  },
  /** Камчатка: ясный вечер, тёплая лампа внутри, ветер с сопки снаружи. */
  kamchatkaEvening: {
    id: 'kamchatkaEvening',
    lightColor: [1.0, 0.72, 0.38],
    lightIntensity: 0.4,
    rain: 0.0,
    dust: 0.22,
    wind: 0.45,
    exposure: 1.02,
    vignette: 0.2,
  },
  /**
   * Камчатка на время извержения. Второй источник света на сцене —
   * исключение, и оно проведено через муд намеренно: пусть кадр краснеет
   * одним значением на всех, а не отдельным таймером у каждого эффекта.
   */
  erupting: {
    id: 'erupting',
    lightColor: [1.0, 0.5, 0.26],
    lightIntensity: 0.62,
    rain: 0.0,
    dust: 0.6,
    wind: 0.8,
    exposure: 1.12,
    vignette: 0.26,
  },
  winterMorning: {
    id: 'winterMorning',
    lightColor: [0.78, 0.88, 1.0],
    lightIntensity: 0.16,
    rain: 0.0,
    dust: 0.30,
    wind: 0.75,
    exposure: 1.08,
    vignette: 0.16,
  },
}

/** Одномерный value-noise. На CPU считается один раз за кадр — это ничто. */
function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453123
  return s - Math.floor(s)
}

function noise1(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash1(i) * (1 - u) + hash1(i + 1) * u
}

export class Ambience {
  /** Секунды с запуска. Не performance.now() — этот идёт через ticker и умеет паузу. */
  time = 0

  /** 0..1, где 1 — вспышка. Множитель яркости для всего, что светится. */
  flicker = 1

  /** 0..1, общий порыв ветра. Огибающая, а не шум: порывы приходят волнами. */
  gust = 0

  mood: Mood = MOODS.rainyEvening

  /** Плавно интерполируемые значения — при смене станции они едут 2 сек (§7). */
  readonly current = {
    lightColor: [...MOODS.rainyEvening.lightColor] as [number, number, number],
    lightIntensity: MOODS.rainyEvening.lightIntensity,
    rain: MOODS.rainyEvening.rain,
    dust: MOODS.rainyEvening.dust,
    wind: MOODS.rainyEvening.wind,
    exposure: MOODS.rainyEvening.exposure,
    vignette: MOODS.rainyEvening.vignette,
  }

  /** Снимок значений на момент переключения — от него ведём интерполяцию. */
  private moodFrom = { ...MOODS.rainyEvening, lightColor: [...MOODS.rainyEvening.lightColor] as [number, number, number] }
  private moodBlend = 1

  setMood(id: string): void {
    const next = MOODS[id]
    if (!next || next === this.mood) return

    const c = this.current
    this.moodFrom = {
      ...this.mood,
      lightColor: [...c.lightColor] as [number, number, number],
      lightIntensity: c.lightIntensity,
      rain: c.rain,
      dust: c.dust,
      wind: c.wind,
      exposure: c.exposure,
      vignette: c.vignette,
    }
    this.mood = next
    this.moodBlend = 0
  }

  update(dtSeconds: number): void {
    this.time += dtSeconds

    // Пламя. Три компоненты, потому что настоящий фитиль ведёт себя так:
    //   медленное дыхание — конвекция вокруг лампы
    //   средняя дрожь     — собственно колебание язычка
    //   редкие провалы    — сквозняк; именно они не дают эффекту стать «пульсацией»
    const breathe = noise1(this.time * 0.6)
    const tremble = noise1(this.time * 4.3 + 17.0)
    const dipNoise = noise1(this.time * 1.7 + 91.0)
    const dip = Math.max(0, dipNoise - 0.72) / 0.28

    let f = 0.72 + 0.18 * breathe + 0.14 * tremble - 0.30 * dip * dip
    this.flicker = Math.min(1, Math.max(0.25, f))

    // Ветер: медленная огибающая, поверх неё мелкая дрожь.
    const envelope = Math.max(0, noise1(this.time * 0.17 + 3.0) - 0.35) / 0.65
    const chatter = noise1(this.time * 1.9 + 55.0) - 0.5
    this.gust = Math.min(1, Math.max(0, envelope * (0.85 + 0.3 * chatter))) * this.current.wind

    // Переход между станциями: 2 сек, синхронно с кроссфейдом звука (§7).
    // Интерполяция именно от снимка к цели, а не «догоняем цель на долю за
    // кадр»: у догоняющей схемы остаётся вечный недобег, и станция никогда
    // не приходит в своё точное значение.
    if (this.moodBlend < 1) {
      this.moodBlend = Math.min(1, this.moodBlend + dtSeconds / 2.0)
      const t = this.moodBlend * this.moodBlend * (3 - 2 * this.moodBlend)
      const c = this.current
      const a = this.moodFrom
      const b = this.mood
      for (let i = 0; i < 3; i++) {
        c.lightColor[i] = a.lightColor[i] + (b.lightColor[i] - a.lightColor[i]) * t
      }
      c.lightIntensity = a.lightIntensity + (b.lightIntensity - a.lightIntensity) * t
      c.rain = a.rain + (b.rain - a.rain) * t
      c.dust = a.dust + (b.dust - a.dust) * t
      c.wind = a.wind + (b.wind - a.wind) * t
      c.exposure = a.exposure + (b.exposure - a.exposure) * t
      c.vignette = a.vignette + (b.vignette - a.vignette) * t
    }
  }
}
