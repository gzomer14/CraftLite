/**
 * Nuvens: um plano horizontal acima do mundo, com a forma gerada no shader.
 *
 * **Sem textura de propósito.** Uma camada de nuvem de 256×256 custaria 256 KB
 * de memória de GPU e um upload no boot; o ruído de valor de uma oitava custa
 * ~20 ALU por pixel e não ocupa nada. Em T0 as nuvens nascem desligadas (doc 02
 * §1), então esse ALU nem chega a ser cobrado no aparelho que sofreria.
 *
 * `uOctaves` é o que separa Rápido de Bonito: uma oitava dá a mancha chapada
 * do modo rápido, duas dão a borda esgarçada do bonito. É um `if` uniforme —
 * constante para todo o draw call, então não diverge entre pixels.
 */

/** Corpo compartilhado: ruído de valor e a forma da nuvem. */
const NOISE = `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Curva de Hermite: sem ela o ruído mostra a grade dos cantos.
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloudShape(vec2 p, float octaves) {
  float n = valueNoise(p);
  if (octaves > 1.5) n = n * 0.68 + valueNoise(p * 2.7) * 0.32;
  return n;
}
`;

export const CLOUDS_VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform float uRadius;
out vec2 vWorld;
out float vEdge;
void main() {
  vec3 world = vec3(uCenter.x + aPos.x * uRadius, uCenter.y, uCenter.z + aPos.y * uRadius);
  vWorld = world.xz;
  // Distância normalizada até o centro do plano, para apagar a borda do quad.
  vEdge = length(aPos);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const CLOUDS_FS_300 = `#version 300 es
precision mediump float;
in vec2 vWorld;
in float vEdge;
uniform vec2 uScroll;
uniform float uScale;
uniform float uOctaves;
uniform float uCover;
uniform vec3 uTint;
out vec4 fragColor;
${NOISE}
void main() {
  float n = cloudShape((vWorld + uScroll) / uScale, uOctaves);
  // uCover é o corte: acima dele é nuvem, abaixo é céu.
  float alpha = smoothstep(uCover, uCover + 0.16, n);
  // A borda do plano some antes de o jogador ver o quadrado.
  alpha *= 1.0 - smoothstep(0.55, 1.0, vEdge);
  if (alpha <= 0.004) discard;
  // O miolo é mais opaco que a franja: é o que dá corpo sem uma segunda camada.
  fragColor = vec4(uTint, alpha * 0.86);
}
`;

export const CLOUDS_VS_100 = `
precision highp float;
attribute vec2 aPos;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform float uRadius;
varying vec2 vWorld;
varying float vEdge;
void main() {
  vec3 world = vec3(uCenter.x + aPos.x * uRadius, uCenter.y, uCenter.z + aPos.y * uRadius);
  vWorld = world.xz;
  vEdge = length(aPos);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const CLOUDS_FS_100 = `
precision mediump float;
varying vec2 vWorld;
varying float vEdge;
uniform vec2 uScroll;
uniform float uScale;
uniform float uOctaves;
uniform float uCover;
uniform vec3 uTint;
${NOISE}
void main() {
  float n = cloudShape((vWorld + uScroll) / uScale, uOctaves);
  float alpha = smoothstep(uCover, uCover + 0.16, n);
  alpha *= 1.0 - smoothstep(0.55, 1.0, vEdge);
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(uTint, alpha * 0.86);
}
`;
