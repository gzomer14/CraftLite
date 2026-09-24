/**
 * Céu: um quad de tela cheia com gradiente por hora do dia, mais um disco de
 * sol, lua com fases e estrelas à noite. Sem depth write (doc 01 §5.3, passe 1).
 *
 * O gradiente é calculado a partir da direção do raio de cada pixel, então o
 * horizonte fica onde deve mesmo quando a câmera olha para cima ou para baixo.
 */

/*
 * Lua com fases (M14, doc 03 §8). O disco é uma esfera vista de frente: o
 * ponto (u, v) do disco tem normal (u, v, √(1−u²−v²)), e a fase é a direção
 * da luz do sol nesse mesmo referencial — uMoonPhase = (sen θ, cos θ), com
 * θ = fase · 45°. Cheia (θ = 0) acende o disco todo; nova (θ = 180°) apaga.
 * v corre ao longo da órbita, que é por onde o sol está.
 */
const MOON_FN = `
const float MOON_RADIUS = 0.045;
vec3 moonColor(vec3 ray, vec3 sunDir, vec2 phase, float night) {
  vec3 moonDir = -sunDir;
  float facing = dot(ray, moonDir);
  if (facing <= 0.0) return vec3(0.0);
  vec3 along = vec3(0.0, sunDir.z, -sunDir.y);
  float u = ray.x / MOON_RADIUS;
  float v = dot(ray, along) / MOON_RADIUS;
  float r2 = u * u + v * v;
  if (r2 >= 1.0) return vec3(0.0);
  float z = sqrt(1.0 - r2);
  float lit = smoothstep(-0.06, 0.06, v * phase.x + z * phase.y);
  // Borda macia de um pixel e manchas (os mares) fixas no disco.
  float edge = smoothstep(1.0, 0.86, r2);
  float mare = 0.82 + 0.18 * step(0.35, fract(sin(floor(u * 3.0) * 7.1 + floor(v * 3.0) * 13.7) * 91.3));
  return vec3(0.85, 0.88, 1.0) * (0.035 + lit * mare) * edge * night;
}
`;

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
uniform vec2 uMoonPhase;
out vec4 fragColor;
${MOON_FN}
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
  color += moonColor(ray, uSunDir, uMoonPhase, 1.0 - uDayFactor);

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
uniform vec2 uMoonPhase;
${MOON_FN}
void main() {
  vec3 ray = normalize(vRay);
  float t = pow(clamp(ray.y * 0.5 + 0.5, 0.0, 1.0), 0.55);
  vec3 color = mix(uHorizon, uZenith, t);
  float sun = dot(ray, uSunDir);
  color += vec3(1.0, 0.95, 0.85) * pow(max(sun, 0.0), 900.0) * 1.4;
  color += vec3(1.0, 0.8, 0.55) * pow(max(sun, 0.0), 12.0) * 0.10 * uDayFactor;
  color += moonColor(ray, uSunDir, uMoonPhase, 1.0 - uDayFactor);
  gl_FragColor = vec4(color, 1.0);
}
`;
