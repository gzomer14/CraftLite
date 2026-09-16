/**
 * Shaders de terreno. Ficam como template strings para não custar um fetch
 * extra no boot (doc 01 §2).
 *
 * Duas variantes: WebGL2 (GLSL ES 3.00, atributos inteiros descompactados com
 * bit ops) e WebGL1 (GLSL ES 1.00, atributos em float). Sem branch dinâmico no
 * fragment — as variantes saem por `#define` na compilação (doc 01 §5.5).
 */

/** Tabela de tints indexada pelo campo `tint` do vértice. */
const TINT_TABLE = `
const vec3 TINTS[4] = vec3[4](
  vec3(1.0, 1.0, 1.0),
  vec3(0.475, 0.753, 0.353),
  vec3(0.349, 0.682, 0.188),
  vec3(0.247, 0.463, 0.894)
);`;

/** Curva de luz do original: pow(0.8, 15 - light), com piso ambiente. */
const LIGHT_FN = `
float lightCurve(float level) {
  return pow(0.8, 15.0 - level);
}`;

export const TERRAIN_VS_300 = `#version 300 es
precision highp float;

layout(location = 0) in uvec2 aPacked;

uniform mat4 uViewProj;
uniform vec3 uChunkOrigin;
uniform float uDayFactor;      // 0 = noite, 1 = dia
uniform float uMinSkyLight;    // luz ambiente mínima (não deixa a noite ficar preta)

out vec3 vUv;                  // xy = uv em tiles, z = camada do array
out float vLight;
out vec3 vTint;
out float vFogDepth;

${TINT_TABLE}
${LIGHT_FN}

const float AO_LEVELS[4] = float[4](0.55, 0.70, 0.85, 1.0);
// Luz direcional falsa por face — dá volume sem custar nada.
const float FACE_SHADE[6] = float[6](0.80, 0.80, 1.00, 0.55, 0.90, 0.90);

void main() {
  uint w0 = aPacked.x;
  uint w1 = aPacked.y;

  // Posição em dezesseis avos de bloco dentro da section (0..256).
  vec3 local = vec3(
    float(w0 & 511u),
    float((w0 >> 9) & 511u),
    float((w0 >> 18) & 511u)
  ) * 0.0625;

  uint face  = (w0 >> 27) & 7u;

  float layer = float(w1 & 1023u);
  float bl    = float((w1 >> 10) & 15u);
  float sl    = float((w1 >> 14) & 15u);
  uint ao     = (w1 >> 18) & 3u;
  uint tint   = (w1 >> 20) & 3u;
  float u    = float((w1 >> 22) & 31u);
  float v    = float((w1 >> 27) & 31u);

  vec4 world = vec4(uChunkOrigin + local, 1.0);
  gl_Position = uViewProj * world;

  vUv = vec3(u, v, layer);

  float light = max(bl, sl * uDayFactor);
  vLight = max(lightCurve(light), uMinSkyLight) * AO_LEVELS[ao] * FACE_SHADE[face];
  vTint = TINTS[tint];
  vFogDepth = gl_Position.w;
}
`;

export const TERRAIN_FS_300 = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;

in vec3 vUv;
in float vLight;
in vec3 vTint;
in float vFogDepth;

uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogDensity;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uAtlas, vec3(fract(vUv.xy), vUv.z));
#ifdef ALPHA_TEST
  if (texel.a < 0.5) discard;
#endif
  vec3 color = texel.rgb * vLight * vTint;

  float f = vFogDepth * uFogDensity;
  float fog = 1.0 - exp(-f * f);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

  fragColor = vec4(color, texel.a);
}
`;

// ---------------------------------------------------------------------------
// Fallback WebGL1: mesmos cálculos, atributos em float.
// ---------------------------------------------------------------------------

// No GLSL ES 1.00 o default de float é highp no vertex e mediump no fragment.
// Uniforms e varyings compartilhados precisam de qualificador explícito nos dois
// shaders, senão o link falha com "precisions differ".
export const TERRAIN_VS_100 = `
precision highp float;

attribute vec4 aPosFace;   // xyz = posição local em blocos, w = face
attribute vec4 aUvLight;   // xy = uv em tiles, z = camada, w = luz empacotada

uniform mat4 uViewProj;
uniform vec3 uChunkOrigin;
uniform float uDayFactor;
uniform float uMinSkyLight;
uniform highp vec2 uAtlasTiles;  // x = tiles por linha, y = 1/tilesPorLinha

varying highp vec2 vUv;
varying highp vec2 vTileOrigin;
varying mediump float vLight;
varying mediump vec3 vTint;
varying highp float vFogDepth;

${LIGHT_FN}

void main() {
  vec4 world = vec4(uChunkOrigin + aPosFace.xyz, 1.0);
  gl_Position = uViewProj * world;

  // "packed" e palavra reservada no GLSL ES 1.00, dai o nome "bits".
  float bits = aUvLight.w;
  float bl = mod(bits, 16.0);
  float sl = mod(floor(bits / 16.0), 16.0);
  float ao = mod(floor(bits / 256.0), 4.0);
  float tint = mod(floor(bits / 1024.0), 16.0);

  vec3 tintColor = vec3(1.0);
  if (tint > 2.5)      tintColor = vec3(0.247, 0.463, 0.894);
  else if (tint > 1.5) tintColor = vec3(0.349, 0.682, 0.188);
  else if (tint > 0.5) tintColor = vec3(0.475, 0.753, 0.353);

  float aoMul = 0.55 + ao * 0.15;
  float face = aPosFace.w;
  float shade = 0.9;
  if (face < 1.5)      shade = 0.80;
  else if (face < 2.5) shade = 1.00;
  else if (face < 3.5) shade = 0.55;

  float light = max(bl, sl * uDayFactor);
  vLight = max(lightCurve(light), uMinSkyLight) * aoMul * shade;
  vTint = tintColor;

  // Sem texture array: converte a camada em offset dentro do atlas 2D.
  float layer = aUvLight.z;
  vTileOrigin = vec2(mod(layer, uAtlasTiles.x), floor(layer * uAtlasTiles.y));
  vUv = aUvLight.xy;
  vFogDepth = gl_Position.w;
}
`;

export const TERRAIN_FS_100 = `
precision mediump float;

varying highp vec2 vUv;
varying highp vec2 vTileOrigin;
varying mediump float vLight;
varying mediump vec3 vTint;
varying highp float vFogDepth;

uniform sampler2D uAtlas;
uniform highp vec2 uAtlasTiles;
uniform vec3 uFogColor;
uniform float uFogDensity;

void main() {
  // Repete o tile dentro da célula do atlas, com margem contra bleeding.
  highp vec2 inTile = fract(vUv);
  highp vec2 uv = (vTileOrigin + clamp(inTile, 0.002, 0.998)) * uAtlasTiles.y;
  vec4 texel = texture2D(uAtlas, uv);
#ifdef ALPHA_TEST
  if (texel.a < 0.5) discard;
#endif
  vec3 color = texel.rgb * vLight * vTint;

  float f = vFogDepth * uFogDensity;
  float fog = 1.0 - exp(-f * f);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(color, texel.a);
}
`;

/** Insere `#define`s logo depois da diretiva `#version`, se houver. */
export function withDefines(source: string, defines: readonly string[]): string {
  if (defines.length === 0) return source;
  const block = defines.map((d) => `#define ${d}`).join('\n');
  if (source.startsWith('#version')) {
    const nl = source.indexOf('\n');
    return `${source.slice(0, nl + 1)}${block}\n${source.slice(nl + 1)}`;
  }
  return `${block}\n${source}`;
}
