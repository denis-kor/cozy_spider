// Атмосферный пост-проход. Один draw call на всё:
// гало лампы -> дождь -> пылинки -> хроматика -> виньетка -> зерно.
//
// Всё, что мигает, берёт множитель из одного uFlicker. Это не экономия
// строк, а требование: если пламя, гало, блик на воде и экспозиция кадра
// мигают независимо, сцена рассыпается на несвязанные эффекты.

precision mediump float;

#include "./lib/hash.glsl"

in vec2 vTextureCoord;
in vec2 vLayerUv;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uOcclusionTexture;

uniform vec4 uInputClamp;
uniform highp vec4 uInputSize;

uniform float uTime;
uniform float uAspect;

uniform vec2  uLightPos;
uniform vec3  uLightColor;
uniform float uLightIntensity;
uniform float uFlicker;

uniform float uRain;        // 0..1 интенсивность
uniform float uDust;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;  // в пикселях на краю кадра
uniform float uExposure;

// --- дождь ----------------------------------------------------------------
// Струи режем на вертикальные колонки; в каждой своя фаза и своя скорость.
// Наклон делаем сдвигом x по y — дождь под ветром никогда не строго вертикален.
float rainLayer(vec2 uv, float cols, float speed, float slant, float thick, float seed) {
    uv.x += uv.y * slant;

    float gx = uv.x * cols;
    float col = floor(gx);
    float r = hash11(col + seed);

    float fx = fract(gx) - 0.5;
    float y = fract(uv.y * 1.15 + uTime * speed * (0.75 + 0.5 * r) + r * 7.31);

    float streak = smoothstep(thick, 0.0, abs(fx));
    float body = smoothstep(0.0, 0.05, y) * smoothstep(0.42, 0.06, y);

    return streak * body * (0.35 + 0.65 * r);
}

// --- пылинки --------------------------------------------------------------
float dustMotes(vec2 uv) {
    float acc = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 p = uv * (4.0 + fi * 2.5);
        p.y -= uTime * (0.015 + fi * 0.008);
        p.x += sin(uTime * 0.21 + fi * 2.1) * 0.12;

        vec2 c = floor(p);
        vec2 f = fract(p) - 0.5;
        float h = hash21(c + fi * 37.0);

        if (h > 0.88) {
            vec2 j = vec2(hash21(c + 5.0), hash21(c + 11.0)) - 0.5;
            float d = length(f - j * 0.7);
            acc += smoothstep(0.075, 0.0, d) * (0.35 + 0.65 * fract(h * 17.0));
        }
    }
    return acc;
}

void main(void) {
    vec2 uv = vLayerUv;
    vec2 centered = (uv - 0.5) * vec2(uAspect, 1.0);
    float r2 = dot(centered, centered);

    // Силуэт карт: атмосферная «грязь» — дождь, двоение каналов, зерно —
    // на бумаге читается не как погода, а как мыло. Карты ближе всего к
    // камере, и струи с пылью летают ЗА ними; свет, виньетка и экспозиция
    // остаются общими, иначе карты выпадут из сцены.
    float card = smoothstep(0.45, 0.85, texture(uOcclusionTexture, vLayerUv).a);

    // Хроматика: только к краям, доли пикселя, и НЕ по картам. Заметная
    // аберрация читается как дефект, а не как атмосфера.
    vec2 caDir = centered * uAberration * uInputSize.zw * r2 * (1.0 - card);
    vec4 base;
    base.r = texture(uTexture, clamp(vTextureCoord + caDir, uInputClamp.xy, uInputClamp.zw)).r;
    base.g = texture(uTexture, vTextureCoord).g;
    base.b = texture(uTexture, clamp(vTextureCoord - caDir, uInputClamp.xy, uInputClamp.zw)).b;
    base.a = texture(uTexture, vTextureCoord).a;

    // --- гало лампы -------------------------------------------------------
    vec2 toLight = (uv - uLightPos) * vec2(uAspect, 1.0);
    float ld = length(toLight);

    float core  = exp(-ld * ld / (2.0 * 0.045 * 0.045));
    float spill = pow(max(1.0 - ld * 1.35, 0.0), 2.6);
    float haze  = exp(-ld * ld / (2.0 * 0.34 * 0.34)) * 0.30;

    // Пламя не просто меняет яркость — оно меняет форму пятна.
    // Поэтому flicker подмешан в веса каналов, а не наложен сверху.
    float glow = core * (0.55 + 0.45 * uFlicker)
               + spill * (0.30 + 0.70 * uFlicker)
               + haze * (0.80 + 0.20 * uFlicker);

    // Карта непрозрачна для лампы: гало — свет в воздухе ЗА картами, и
    // просвечивать сквозь бумагу он не должен. Маска — силуэт стола,
    // отрендеренный кадром раньше. Порог отсекает полупрозрачные тени
    // карт: они не должны гасить свет вокруг себя.
    float lit = 1.0 - card;

    // Свет добавляется только туда, где ему есть куда добавляться.
    // Чистая аддитивная засветка выжигала белые лица карт у лампы в
    // сплошное пятно. Бумага рядом с огнём должна теплеть, а не гореть:
    // тёмным пикселям — прибавка яркости, светлым — тёплый оттенок
    // (умножение на цвет лампы гасит синий и зелёный, не поднимая белый).
    float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
    float head = 1.0 - smoothstep(0.30, 0.95, lum);
    base.rgb += uLightColor * glow * uLightIntensity * head * lit;
    base.rgb *= mix(vec3(1.0), uLightColor, glow * uLightIntensity * (1.0 - head) * 0.35 * lit);

    // --- дождь ------------------------------------------------------------
    if (uRain > 0.001) {
        vec2 ruv = vec2(uv.x * uAspect, uv.y);
        float rain = rainLayer(ruv, 70.0, 0.85, 0.16, 0.085, 0.0) * 0.55
                   + rainLayer(ruv, 44.0, 0.55, 0.20, 0.130, 9.0) * 0.35
                   + rainLayer(ruv, 26.0, 0.34, 0.24, 0.190, 21.0) * 0.22;

        // Ближе к лампе капли ловят свет — иначе дождь висит отдельным слоем.
        vec3 rainTint = mix(vec3(0.62, 0.74, 0.78), uLightColor, spill * 0.6);
        base.rgb += rainTint * rain * uRain * 0.16 * (1.0 - card * 0.85);
    }

    // --- пылинки ----------------------------------------------------------
    if (uDust > 0.001) {
        float motes = dustMotes(vec2(uv.x * uAspect, uv.y));
        base.rgb += mix(vec3(0.85, 0.90, 0.86), uLightColor, spill) * motes * uDust * 0.5 * (1.0 - card * 0.85);
    }

    // --- экспозиция, виньетка, зерно --------------------------------------
    base.rgb *= uExposure * (0.97 + 0.03 * uFlicker);

    float vig = 1.0 - uVignette * smoothstep(0.10, 0.95, r2);
    base.rgb *= mix(vec3(vig), vec3(vig) * vec3(1.04, 1.0, 0.95), 0.5);

    float g = hash21(uv * uInputSize.xy + fract(uTime) * 137.0) - 0.5;
    base.rgb += g * uGrain * (1.0 - card * 0.6);

    finalColor = base;
}
