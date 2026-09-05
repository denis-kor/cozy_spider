// Общая вершинка для всех фильтров сцены.
//
// Отличие от дефолтной пиксёвой: наружу уходит ещё и vLayerUv —
// координата 0..1 РОВНО по области фильтра, без учёта паддинга.
// Именно она нужна, чтобы сэмплить маски и считать позицию источника
// света: vTextureCoord для этого не годится, он гуляет вместе с
// паддингом фильтра.

in vec2 aPosition;

out vec2 vTextureCoord;
out vec2 vLayerUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vLayerUv = aPosition;
}
