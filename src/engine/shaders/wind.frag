// Ветер по листве.
//
// Честный способ — гнуть меш в вершинном шейдере (§5 дока). Но для слоёв
// фона UV-варп даёт 90% того же ощущения при нулевой геометрии: листва
// на плоском слое всё равно не должна перекрывать саму себя.
//
// Когда дойдёт до карт и до переднего плана — там уже сетка 8x12 и
// настоящий изгиб в вершинке.

precision mediump float;

#include "./lib/hash.glsl"

in vec2 vTextureCoord;
in vec2 vLayerUv;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMaskTexture;   // белое = гнётся сильно, чёрное = жёстко

uniform vec4 uInputClamp;
uniform highp vec4 uInputSize;

uniform float uTime;
uniform float uAmplitude;     // в пикселях
uniform float uScale;         // размер порыва относительно кадра
uniform float uGust;          // 0..1, приходит из Ambience — общий порыв

void main(void) {
    float stiff = texture(uMaskTexture, vLayerUv).a;

    if (stiff <= 0.002) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    // Две волны с несоизмеримыми периодами: рисунок не повторяется на глаз.
    float t = uTime * 0.35;
    float w1 = fbm3(vLayerUv * uScale + vec2(t, t * 0.31));
    float w2 = fbm3(vLayerUv * uScale * 2.31 - vec2(t * 0.73, t * 0.11));

    vec2 sway = vec2(w1 - 0.5, (w2 - 0.5) * 0.35);

    // Порыв усиливает амплитуду и слегка кренит всё в одну сторону —
    // без этого получается ровное «дыхание», а не ветер.
    sway.x += uGust * 0.45;

    vec2 offset = sway * uInputSize.zw * uAmplitude * stiff * (0.55 + uGust);

    finalColor = texture(uTexture, clamp(vTextureCoord + offset, uInputClamp.xy, uInputClamp.zw));
}
