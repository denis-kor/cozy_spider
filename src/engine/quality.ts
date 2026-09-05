/**
 * Определение тира качества.
 *
 * §5 дока: мерить медиану времени кадра, а не разбирать строку рендерера.
 * Строку маскируют, врут про неё браузеры и расширения; фактическая
 * производительность — единственный честный сигнал.
 */

export type QualityTier = 'ultra' | 'high' | 'medium' | 'low'

export interface TierSettings {
  /**
   * Разрешение пост-прохода относительно нативного (умножается на
   * resolution рендерера в Stage). Пост висит на всём world, включая
   * карты: всё ниже 1.0 мылит ВЕСЬ кадр, а не только эффекты. Поэтому
   * резкость не деградируем ни на одном тире — экономим на самих
   * эффектах (rain/dust/aberration/water/wind), не на разрешении.
   */
  postResolution: number
  rain: number
  dust: number
  grain: number
  aberration: number
  water: boolean
  wind: boolean
  /** Целевой FPS фоновой атмосферы. Пасьянс статичен, 60 тут не нужен. */
  ambientFps: number
}

export const TIERS: Record<QualityTier, TierSettings> = {
  ultra:  { postResolution: 1.0, rain: 1.0, dust: 1.0, grain: 0.035, aberration: 2.5, water: true,  wind: true,  ambientFps: 60 },
  high:   { postResolution: 1.0, rain: 1.0, dust: 0.7, grain: 0.030, aberration: 1.8, water: true,  wind: true,  ambientFps: 60 },
  medium: { postResolution: 1.0, rain: 0.7, dust: 0.0, grain: 0.025, aberration: 0.0, water: true,  wind: false, ambientFps: 30 },
  low:    { postResolution: 1.0, rain: 0.0, dust: 0.0, grain: 0.020, aberration: 0.0, water: false, wind: false, ambientFps: 30 },
}

export class TierProbe {
  private samples: number[] = []
  private done = false
  private tier: QualityTier = 'high'

  constructor(private readonly durationMs = 2000) {}

  /** Скармливать deltaMS каждый кадр. Возвращает тир, когда замер закончен. */
  sample(deltaMs: number): QualityTier | null {
    if (this.done) return this.tier

    // Первые кадры выбрасываем: там компиляция шейдеров и загрузка текстур.
    if (this.samples.length === 0 && deltaMs > 100) return null

    this.samples.push(deltaMs)

    const total = this.samples.reduce((a, b) => a + b, 0)
    if (total < this.durationMs) return null

    const sorted = [...this.samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    this.tier =
      median < 13 ? 'ultra' :
      median < 20 ? 'high' :
      median < 34 ? 'medium' : 'low'

    this.done = true
    return this.tier
  }

  get median(): number {
    if (!this.samples.length) return 0
    const sorted = [...this.samples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
}
