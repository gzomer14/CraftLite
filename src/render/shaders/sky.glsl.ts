/**
 * Céu: um quad de tela cheia com gradiente por hora do dia, mais um disco de
 * sol/lua e estrelas à noite. Sem depth write (doc 01 §5.3, passe 1).
 *
 * O gradiente é calculado a partir da direção do raio de cada pixel, então o
 * horizonte fica onde deve mesmo quando a câmera olha para cima ou para baixo.
 */

export const SKY_VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform mat4 uInvViewProj;
out vec3 vRay;
void main() {
  gl_Position = vec4(aPos, 1.0, 1.0);
  // Reconstrói a direção do raio a partir do NDC.
  vec4 near = uInvViewProj * vec4(aPos, -1.0, 1.0);
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vRay = normalize(far.xyz / far.w - near.xyz / near.w);
}
`;

export const SKY_FS_300 = `#version 300 es
precision mediump float;
in vec3 vRay;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uDayFactor;
out vec4 fragColor;

void main() {
  vec3 ray = normalize(vRay);
  // Mistura zênite/horizonte pela altura do raio, com uma curva que aperta a
  // faixa perto do horizonte (é onde o olho espera ver a transição).
  float h = clamp(ray.y, -1.0, 1.0);
  float t = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 0.55);
  vec3 color = mix(uHorizon, uZenith, t);

  // Sol/lua: disco com halo suave.
  float sun = dot(ray, uSunDir);
  color += vec3(1.0, 0.95, 0.85) * pow(max(sun, 0.0), 900.0) * 1.4;
  color += vec3(1.0, 0.8, 0.55) * pow(max(sun, 0.0), 12.0) * 0.10 * uDayFactor;
  float moon = dot(ray, -uSunDir);
  color += vec3(0.85, 0.88, 1.0) * pow(max(moon, 0.0), 1400.0) * (1.0 - uDayFactor);

  // Estrelas: ruído de alta frequência, só à noite e acima do horizonte.
  if (uDayFactor < 0.6 && ray.y > 0.0) {
    vec3 s = floor(ray * 220.0);
    float n = fract(sin(dot(s, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float star = smoothstep(0.9975, 1.0, n) * (1.0 - uDayFactor / 0.6) * ray.y;
    color += vec3(star);
  }

  fragColor = vec4(color, 1.0);
}
`;

export const SKY_VS_100 = `
precision highp float;
attribute vec2 aPos;
uniform mat4 uInvViewProj;
varying vec3 vRay;
void main() {
  gl_Position = vec4(aPos, 1.0, 1.0);
  vec4 near = uInvViewProj * vec4(aPos, -1.0, 1.0);
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vRay = normalize(far.xyz / far.w - near.xyz / near.w);
}
`;

export const SKY_FS_100 = `
precision mediump float;
varying vec3 vRay;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uDayFactor;

void main() {
  vec3 ray = normalize(vRay);
  float t = pow(clamp(ray.y * 0.5 + 0.5, 0.0, 1.0), 0.55);
  vec3 color = mix(uHorizon, uZenith, t);
  float sun = dot(ray, uSunDir);
  color += vec3(1.0, 0.95, 0.85) * pow(max(sun, 0.0), 900.0) * 1.4;
  color += vec3(1.0, 0.8, 0.55) * pow(max(sun, 0.0), 12.0) * 0.10 * uDayFactor;
  gl_FragColor = vec4(color, 1.0);
}
`;
