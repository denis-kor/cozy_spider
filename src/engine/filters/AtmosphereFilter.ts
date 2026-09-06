import { Filter, GlProgram, UniformGroup, type Texture } from 'pixi.js'

import vertex from '../shaders/layer.vert'
import fragment from '../shaders/atmosphere.frag'

export interface AtmosphereOptions {
  /** Разрешение прохода. 0.5 = в четверть по площади — см. §5 «пост в ¼». */
  resolution?: number
  /**
   * Силуэт карт в экранных координатах: где альфа — там свет лампы не
   * рисуется. Карты лежат на столе ПОД слоем воздуха с гало, и без маски
   * свет просвечивал бы сквозь бумагу.
   */
  occlusion: Texture
}

/**
 * Весь пост одним проходом: гало лампы, дождь, пылинки, хроматика,
 * виньетка, зерно.
 *
 * Дождь и пыль здесь — не спрайты, а математика в фрагментном шейдере.
 * Тысяча капель стоит ровно столько же, сколько одна: CPU не участвует,
 * geometry не растёт, аллокаций в кадре ноль.
 */
export class AtmosphereFilter extends Filter {
  constructor(options: AtmosphereOptions) {
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uAspect: { value: 1.6, type: 'f32' },
      uLightPos: { value: new Float32Array([0.94, 0.73]), type: 'vec2<f32>' },
      uLightColor: { value: new Float32Array([1.0, 0.74, 0.42]), type: 'vec3<f32>' },
      uLightIntensity: { value: 0.32, type: 'f32' },
      uFlicker: { value: 1, type: 'f32' },
      uRain: { value: 0.85, type: 'f32' },
      uDust: { value: 0.2, type: 'f32' },
      uVignette: { value: 0.42, type: 'f32' },
      uGrain: { value: 0.035, type: 'f32' },
      // 0 — см. комментарий у TIERS: сдвиг каналов красил края карт.
      uAberration: { value: 0, type: 'f32' },
      uExposure: { value: 1.0, type: 'f32' },
    })

    super({
      glProgram: GlProgram.from({ vertex, fragment, name: 'cozy-atmosphere' }),
      resources: {
        atmoUniforms: uniforms,
        uOcclusionTexture: options.occlusion.source,
        uOcclusionSampler: options.occlusion.source.style,
      },
      resolution: options.resolution ?? 1,
    })
  }

  private get u() {
    return this.resources.atmoUniforms.uniforms as Record<string, number | Float32Array>
  }

  set time(v: number) { this.u.uTime = v }
  set aspect(v: number) { this.u.uAspect = v }
  set flicker(v: number) { this.u.uFlicker = v }
  set rain(v: number) { this.u.uRain = v }
  set dust(v: number) { this.u.uDust = v }
  set vignette(v: number) { this.u.uVignette = v }
  set grain(v: number) { this.u.uGrain = v }
  set aberration(v: number) { this.u.uAberration = v }
  set exposure(v: number) { this.u.uExposure = v }
  set lightIntensity(v: number) { this.u.uLightIntensity = v }

  setLight(x: number, y: number, color: readonly [number, number, number]): void {
    const p = this.u.uLightPos as Float32Array
    p[0] = x
    p[1] = y
    const c = this.u.uLightColor as Float32Array
    c[0] = color[0]
    c[1] = color[1]
    c[2] = color[2]
  }
}
