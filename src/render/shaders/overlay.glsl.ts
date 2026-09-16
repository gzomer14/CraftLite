/**
 * Shaders de overlay: contorno de seleção (linhas) e rachadura do bloco sendo
 * quebrado (quad texturizado com blend de multiplicação).
 *
 * Os dois usam `polygonOffset`/`depthFunc` frouxos para não brigar com o Z do
 * terreno — sem isso o contorno pisca conforme o ângulo da câmera.
 */

export const LINE_VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform vec3 uScale;
void main() {
  gl_Position = uViewProj * vec4(uOrigin + aPos * uScale, 1.0);
}
`;

export const LINE_FS_300 = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }
`;

export const LINE_VS_100 = `
precision highp float;
attribute vec3 aPos;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform vec3 uScale;
void main() {
  gl_Position = uViewProj * vec4(uOrigin + aPos * uScale, 1.0);
}
`;

export const LINE_FS_100 = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }
`;

// --- rachadura -------------------------------------------------------------

export const CRACK_VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform vec3 uScale;
out vec2 vUv;
void main() {
  vUv = aUv;
  // Infla levemente a caixa para a rachadura ficar por fora da face do bloco.
  gl_Position = uViewProj * vec4(uOrigin + ((aPos - 0.5) * 1.002 + 0.5) * uScale, 1.0);
}
`;

export const CRACK_FS_300 = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
in vec2 vUv;
uniform sampler2DArray uAtlas;
uniform float uLayer;
uniform vec4 uCrackColor;
out vec4 fragColor;
void main() {
  vec4 texel = texture(uAtlas, vec3(vUv, uLayer));
  // A textura é branca com a fissura em preto: o canal vermelho vira máscara.
  // A cor vem de fora porque ela depende do brilho do bloco — fissura preta
  // some em tronco de carvalho escuro, e fissura clara some em areia.
  float mask = 1.0 - texel.r;
  fragColor = vec4(uCrackColor.rgb, mask * uCrackColor.a);
}
`;

export const CRACK_VS_100 = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform vec3 uScale;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uViewProj * vec4(uOrigin + ((aPos - 0.5) * 1.002 + 0.5) * uScale, 1.0);
}
`;

export const CRACK_FS_100 = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uAtlas;
uniform vec2 uAtlasTiles;
uniform float uLayer;
uniform vec4 uCrackColor;
void main() {
  vec2 tile = vec2(mod(uLayer, uAtlasTiles.x), floor(uLayer * uAtlasTiles.y));
  vec2 uv = (tile + clamp(vUv, 0.002, 0.998)) * uAtlasTiles.y;
  float mask = 1.0 - texture2D(uAtlas, uv).r;
  gl_FragColor = vec4(uCrackColor.rgb, mask * uCrackColor.a);
}
`;
