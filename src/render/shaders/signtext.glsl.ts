/**
 * Shader do texto da placa.
 *
 * Quad por glifo, amostrando a folha de fonte de `render/fontgen.ts`. O
 * descarte por alfa em vez de blend é de propósito: texto de placa fica sobre a
 * tábua da própria placa, e misturar exigiria ordenar de trás para frente por
 * glifo. Com `discard` a profundidade continua correta e a ordem não importa.
 */

export const SIGN_VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
uniform mat4 uViewProj;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const SIGN_FS_300 = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uFont;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  if (texture(uFont, vUv).a < 0.5) discard;
  fragColor = vec4(uColor, 1.0);
}
`;

export const SIGN_VS_100 = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const SIGN_FS_100 = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFont;
uniform vec3 uColor;
void main() {
  if (texture2D(uFont, vUv).a < 0.5) discard;
  gl_FragColor = vec4(uColor, 1.0);
}
`;
