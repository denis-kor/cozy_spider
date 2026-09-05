import { Filter, GlProgram, Texture, UniformGroup } from 'pixi.js'

import vertex from '../shaders/layer.vert'
import fragment from '../shaders/water.frag'

export interface WaterFilterOptions {
  /** Тайлящаяся normal-map. Генерится кодом: tools/gen_procedural_assets.py */
  normalMap: Texture
  /** Альфа-маска водной поверхности. В боевой сцене — альфа слоя воды. */
  mask: Texture
  amplitude?: number
  tiling?: number
  specular?: number
}

/**
 * Искажает то, что нарисовано ПОД ним. Никакой «текстуры воды» не рисует.
 *
 * Поэтому отражения домика, лампы и карт едут сами: они уже есть в пикселях
 * нижнего слоя, шейдер только сдвигает выборку. Рисовать воду отдельно —
 * значит потерять всю бесплатную взаимосвязь со сценой.
 */
export class WaterFilter extends Filter {
  constructor(options: WaterFilterOptions) {
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uAmplitude: { value: options.amplitude ?? 7.0, type: 'f32' },
      uTiling: { value: options.tiling ?? 3.0, type: 'f32' },
      uFlowA: { value: new Float32Array([0.006, -0.020]), type: 'vec2<f32>' },
      uFlowB: { value: new Float32Array([-0.011, -0.033]), type: 'vec2<f32>' },
      uSpecular: { value: options.specular ?? 0.55, type: 'f32' },
      uLightColor: { value: new Float32Array([1.0, 0.74, 0.42]), type: 'vec3<f32>' },
      uLightPos: { value: new Float32Array([0.94, 0.73]), type: 'vec2<f32>' },
      uFlicker: { value: 1, type: 'f32' },
    })

    super({
      glProgram: GlProgram.from({ vertex, fragment, name: 'cozy-water' }),
      resources: {
        waterUniforms: uniforms,
        uNormalMapTexture: options.normalMap.source,
        uNormalMapSampler: options.normalMap.source.style,
        uMaskTexture: options.mask.source,
        uMaskSampler: options.mask.source.style,
      },
      // Смещение выборки уходит за границы спрайта — без паддинга по краям
      // кадра появляется растянутый последний пиксель.
      padding: 12,
    })
  }

  private get u() {
    return this.resources.waterUniforms.uniforms as Record<string, number | Float32Array>
  }

  set time(v: number) { this.u.uTime = v }
  set flicker(v: number) { this.u.uFlicker = v }
  set amplitude(v: number) { this.u.uAmplitude = v }

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
