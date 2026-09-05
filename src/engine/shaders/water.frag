// Вода: искажение слоя под ней + бегущий блик от лампы.
//
// Ключевое — НЕ анимировать саму картинку воды, а искажать то, что уже
// нарисовано. Тогда отражения домика и лампы поедут сами собой, потому
// что они физически нарисованы в пикселях слоя.

precision mediump float;

in vec2 vTextureCoord;
in vec2 vLayerUv;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uNormalMapTexture;
uniform sampler2D uMaskTexture;

uniform vec4 uInputClamp;
uniform highp vec4 uInputSize;

uniform float uTime;
uniform float uAmplitude;   // сила искажения, в пикселях
uniform float uTiling;      // сколько раз normal-map укладывается по ширине
uniform vec2  uFlowA;       // скорость первого слоя ряби
uniform vec2  uFlowB;       // второго — намеренно другая, даёт интерференцию
uniform float uSpecular;
uniform vec3  uLightColor;
uniform vec2  uLightPos;    // положение лампы в координатах слоя
uniform float uFlicker;     // общий на всю сцену, см. Ambience.ts

void main(void) {
    float mask = texture(uMaskTexture, vLayerUv).a;

    if (mask <= 0.002) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    // Перспектива. У дальнего берега волны физически мельче и медленнее;
    // без этого вода читается как вертикальная стена, а не как плоскость.
    float persp = mix(0.30, 1.0, clamp(vLayerUv.y, 0.0, 1.0));

    vec2 uv = vLayerUv * uTiling;
    uv.y /= max(persp, 0.05);

    vec3 nA = texture(uNormalMapTexture, uv + uFlowA * uTime).xyz * 2.0 - 1.0;
    vec3 nB = texture(uNormalMapTexture, uv * 1.73 + uFlowB * uTime).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3(nA.xy + nB.xy, 1.0));

    vec2 offset = n.xy * uInputSize.zw * uAmplitude * persp * mask;
    vec2 uvSrc = clamp(vTextureCoord + offset, uInputClamp.xy, uInputClamp.zw);

    vec4 base = texture(uTexture, uvSrc);

    // Блик. Не физкорректный Blinn-Phong, а его дешёвая имитация:
    // важно только, чтобы дорожка от лампы дышала вместе с пламенем.
    vec2 toLight = normalize(uLightPos - vLayerUv + 1e-5);
    float spec = pow(max(dot(n.xy, toLight) * 0.5 + 0.5, 0.0), 14.0);
    float falloff = 1.0 - smoothstep(0.05, 0.95, distance(uLightPos, vLayerUv));

    base.rgb += uLightColor * spec * falloff * uSpecular * uFlicker * mask;

    finalColor = base;
}
