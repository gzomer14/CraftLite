/**
 * Shaders de entidade (mobs, flechas, sombras).
 *
 * O vértice já chega no espaço do mundo: as matrizes das partes são aplicadas
 * na CPU (ver `mobrender.ts`), o que troca "skinning na GPU" por um batch único
 * — 20 mobs cabem em ~3 mil vértices, e uma draw call para todos vale mais que
 * um vertex shader esperto.
 *
 * O fog usa exatamente a mesma fórmula do terreno; se divergir, o mob distante
 * aparece recortado contra o horizonte.
 */

const LIGHT_FN = `
float lightCurve(float level) {
  return pow(0.8, 15.0 - level);
}`;

export const ENTITY_VS_300 = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aUvLayer;   // xy = uv 0..1 na skin, z = camada
layout(location = 2) in vec3 aShade;     // x = sombreado da face, y = luz 0..15, z = flash

uniform mat4 uViewProj;
uniform float uMinSkyLight;

out vec3 vUv;
out float vLight;
out float vFlash;
out float vFogDepth;

${LIGHT_FN}

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vUv = aUvLayer;
  // A luz já vem resolvida da CPU (max entre luz de bloco e do céu × dayFactor):
  // é uma amostra por mob, não por vértice, e sai de graça no batch.
  vLight = max(lightCurve(aShade.y), uMinSkyLight) * aShade.x;
  vFlash = aShade.z;
  vFogDepth = gl_Position.w;
}
`;

export const ENTITY_FS_300 = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;

in vec3 vUv;
in float vLight;
in float vFlash;
in float vFogDepth;

uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  vec4 texel = texture(uAtlas, vec3(vUv.xy, vUv.z));
#ifdef ALPHA_TEST
  if (texel.a < 0.5) discard;
#endif
  vec3 color = texel.rgb * vLight;
  // Piscada de dano: mistura com vermelho em vez de somar, para não estourar.
  color = mix(color, vec3(1.0, 0.25, 0.2), vFlash * 0.7);

  float f = vFogDepth * uFogDensity;
  float fog = 1.0 - exp(-f * f);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

  fragColor = vec4(color, texel.a * uOpacity);
}
`;

export const ENTITY_VS_100 = `
precision highp float;

attribute vec3 aPosition;
attribute vec3 aUvLayer;
attribute vec3 aShade;

uniform mat4 uViewProj;
uniform float uMinSkyLight;
uniform highp vec2 uAtlasTiles;   // x = tiles por linha, y = 1/tilesPorLinha

varying highp vec2 vUv;
varying highp vec2 vTileOrigin;
varying mediump float vLight;
varying mediump float vFlash;
varying highp float vFogDepth;

${LIGHT_FN}

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vUv = aUvLayer.xy;
  vTileOrigin = vec2(mod(aUvLayer.z, uAtlasTiles.x), floor(aUvLayer.z * uAtlasTiles.y));
  vLight = max(lightCurve(aShade.y), uMinSkyLight) * aShade.x;
  vFlash = aShade.z;
  vFogDepth = gl_Position.w;
}
`;

export const ENTITY_FS_100 = `
precision mediump float;

varying highp vec2 vUv;
varying highp vec2 vTileOrigin;
varying mediump float vLight;
varying mediump float vFlash;
varying highp float vFogDepth;

uniform sampler2D uAtlas;
uniform highp vec2 uAtlasTiles;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uOpacity;

void main() {
  highp vec2 uv = (vTileOrigin + clamp(vUv, 0.001, 0.999)) * uAtlasTiles.y;
  vec4 texel = texture2D(uAtlas, uv);
#ifdef ALPHA_TEST
  if (texel.a < 0.5) discard;
#endif
  vec3 color = texel.rgb * vLight;
  color = mix(color, vec3(1.0, 0.25, 0.2), vFlash * 0.7);

  float f = vFogDepth * uFogDensity;
  float fog = 1.0 - exp(-f * f);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(color, texel.a * uOpacity);
}
`;
