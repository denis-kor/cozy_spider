import { Filter, GlProgram, Texture, UniformGroup } from 'pixi.js'

import vertex from '../shaders/layer.vert'
import fragment from '../shaders/wind.frag'

export interface WindFilterOptions {
  /** Маска жёсткости: белое гнётся, чёрное стоит. Ствол — чёрный, лист — белый. */
  mask: Texture
  amplitude?: number
  scale?: number
}

/** Колышет слой листвы. Амплитуду задаёт Ambience.gust — порыв общий на всю сцену. */
export class WindFilter extends Filter {
  constructor(options: WindFilterOptions) {
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: 'f32' },
      uAmplitude: { value: options.amplitude ?? 5.0, type: 'f32' },
      uScale: { value: options.scale ?? 2.4, type: 'f32' },
      uGust: { value: 0, type: 'f32' },
    })

    super({
      glProgram: GlProgram.from({ vertex, fragment, name: 'cozy-wind' }),
      resources: {
        windUniforms: uniforms,
        uMaskTexture: options.mask.source,
        uMaskSampler: options.mask.source.style,
      },
      padding: 16,
    })
  }

  private get u() {
    return this.resources.windUniforms.uniforms as Record<string, number>
  }

  set time(v: number) { this.u.uTime = v }
  set gust(v: number) { this.u.uGust = v }
  set amplitude(v: number) { this.u.uAmplitude = v }
}
