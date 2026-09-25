/**
 * Passe de céu e as cores derivadas dele.
 *
 * A cor do fog **é** a cor do céu no horizonte — se as duas divergem, o terreno
 * distante aparece recortado contra o céu, que é o artefato mais óbvio de um
 * renderer de voxels mal calibrado.
 *
 * Paleta do doc 03 §8: dia `#78A7FF` → pôr do sol `#FC9A54` → noite `#0A0A18`.
 */

import { createProgram, uniformLocations, type GlContext } from './gl';
import { SKY_FS_100, SKY_FS_300, SKY_VS_100, SKY_VS_300 } from './shaders/sky.glsl';
import { TICKS_PER_DAY } from '../game/daynight';
import { createMat4, invert, multiply, type Mat4 } from '../core/math';

const UNIFORMS = [
  'uInvViewProj', 'uZenith', 'uHorizon', 'uSunDir', 'uDayFactor', 'uMoonPhase', 'uCelestial',
] as const;

/** Marcos de cor: [fração do dia, zênite, horizonte]. */
const KEYS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  //  t     zênite R,G,B           horizonte R,G,B
  [0.00, 0.22, 0.44, 0.90, 0.47, 0.65, 1.00], // amanhecer pleno
  [0.48, 0.25, 0.47, 0.92, 0.55, 0.72, 1.00], // meio-dia
  [0.52, 0.30, 0.36, 0.68, 0.99, 0.60, 0.33], // pôr do sol
  [0.58, 0.06, 0.08, 0.22, 0.35, 0.20, 0.28], // crepúsculo
  [0.72, 0.04, 0.04, 0.09, 0.05, 0.05, 0.12], // noite
  [0.92, 0.04, 0.04, 0.09, 0.05, 0.05, 0.12], // noite
  [0.97, 0.18, 0.24, 0.55, 0.92, 0.55, 0.40], // aurora
  [1.00, 0.22, 0.44, 0.90, 0.47, 0.65, 1.00],
];

/** Fases da lua (doc 03 §8); a contagem mora em `game/weather.ts`. */
const MOON_PHASES = 8;

/**
 * Direção da luz do sol no referencial do disco da lua, `(sen θ, cos θ)`, com
 * θ = fase · 45° (M14). Fase 0 é a cheia (cos = 1, disco todo aceso), 4 é a
 * nova (cos = −1, disco apagado), 2 e 6 são as metades, de lados opostos.
 */
export function moonPhaseVector(phase: number, out: Float32Array): Float32Array {
  const theta = (((phase % MOON_PHASES) + MOON_PHASES) % MOON_PHASES) * (Math.PI * 2 / MOON_PHASES);
  out[0] = Math.sin(theta);
  out[1] = Math.cos(theta);
  return out;
}

/**
 * Direção do sol no tick do dia, orbitando o eixo X do mundo: nasce no
 * horizonte em 0, a pino ao meio-dia (6000), se põe em 12000 e passa por
 * baixo à meia-noite — que é quando a lua, do lado oposto, está a pino.
 *
 * **Correção do M14:** o Y saía com o sinal trocado desde o M1 — o disco do
 * sol ficava debaixo do chão ao meio-dia e a pino à meia-noite, e a lua, sempre
 * oposta, nunca subia à noite. Ninguém via a fase porque não se via a lua.
 */
export function sunDirection(dayTime: number, out: Float32Array): Float32Array {
  const t = (dayTime / TICKS_PER_DAY) % 1;
  const angle = (t - 0.25) * Math.PI * 2;
  out[0] = 0;
  out[1] = Math.cos(angle);
  out[2] = Math.sin(angle);
  return out;
}

/** Cinza-chumbo para onde o céu e o fog puxam na chuva (doc 03 §8). */
const RAIN_COLOR: readonly [number, number, number] = [0.28, 0.30, 0.34];

export class SkyPass {
  private readonly ctx: GlContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly quad: WebGLBuffer;
  private readonly invViewProj: Mat4 = createMat4();

  /** Cores do frame, lidas pelo passe de terreno para casar o fog. */
  readonly zenith = new Float32Array(3);
  readonly horizon = new Float32Array(3);
  readonly sunDir = new Float32Array(3);
  /** Fase da lua do quadro, já como vetor de luz (`moonPhaseVector`). */
  readonly moonPhase = new Float32Array([0, 1]);

  constructor(ctx: GlContext) {
    this.ctx = ctx;
    const use300 = ctx.gl2 !== null;
    this.program = createProgram(
      ctx.gl, use300 ? SKY_VS_300 : SKY_VS_100, use300 ? SKY_FS_300 : SKY_FS_100, 'sky',
    );
    this.uniforms = uniformLocations(ctx.gl, this.program, UNIFORMS);

    const quad = ctx.gl.createBuffer();
    if (quad === null) throw new Error('Falha ao criar o quad de céu.');
    this.quad = quad;
    ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, quad);
    ctx.gl.bufferData(
      ctx.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), // triângulo que cobre a tela
      ctx.gl.STATIC_DRAW,
    );
  }

  /** Atualiza as cores para o tick do dia atual e a fase da lua (0..7). */
  /** 1 = desenha sol e lua; 0 nas dimensões sem céu (`override`). */
  private celestial = 1;

  update(dayTime: number, moonPhase = 0): void {
    this.celestial = 1;
    moonPhaseVector(moonPhase, this.moonPhase);
    const t = (dayTime / TICKS_PER_DAY) % 1;
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1][0] < t) i++;
    const a = KEYS[i];
    const b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const span = b[0] - a[0];
    const f = span <= 0 ? 0 : (t - a[0]) / span;

    for (let c = 0; c < 3; c++) {
      this.zenith[c] = a[1 + c] + (b[1 + c] - a[1 + c]) * f;
      this.horizon[c] = a[4 + c] + (b[4 + c] - a[4 + c]) * f;
    }

    sunDirection(dayTime, this.sunDir);
  }

  /**
   * Puxa céu e horizonte para o cinza da chuva (doc 03 §8).
   *
   * Chamado **depois** de `update`, sobre as cores do ciclo: assim a
   * tempestade ao pôr do sol continua alaranjada, só que apagada.
   */
  /**
   * Pinta céu e horizonte com uma cor fixa (M7: o Nether não tem ciclo de dia).
   * O zênite sai mais escuro que o horizonte, como num teto de rocha.
   */
  override(color: readonly [number, number, number]): void {
    // Dimensão sem céu: sem sol nem lua. Até o M19 o End mostrava o disco do
    // sol no vazio (o Nether o escondia atrás da névoa).
    this.celestial = 0;
    for (let c = 0; c < 3; c++) {
      this.horizon[c] = color[c];
      this.zenith[c] = color[c] * 0.45;
    }
  }

  applyRain(amount: number): void {
    if (amount <= 0) return;
    const t = Math.min(1, amount);
    for (let c = 0; c < 3; c++) {
      this.zenith[c] += (RAIN_COLOR[c] - this.zenith[c]) * t;
      this.horizon[c] += (RAIN_COLOR[c] - this.horizon[c]) * t;
    }
  }

  /** Desenha o céu. Precisa da inversa da view-projection para o raio por pixel. */
  render(viewProj: Mat4, dayFactor: number): void {
    const gl = this.ctx.gl;
    if (!invert(this.invViewProj, viewProj)) return;

    gl.useProgram(this.program);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(this.uniforms.uInvViewProj, false, this.invViewProj);
    gl.uniform3fv(this.uniforms.uZenith, this.zenith);
    gl.uniform3fv(this.uniforms.uHorizon, this.horizon);
    gl.uniform3fv(this.uniforms.uSunDir, this.sunDir);
    gl.uniform1f(this.uniforms.uDayFactor, dayFactor);
    gl.uniform2fv(this.uniforms.uMoonPhase, this.moonPhase);
    gl.uniform1f(this.uniforms.uCelestial, this.celestial);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  dispose(): void {
    this.ctx.gl.deleteBuffer(this.quad);
    this.ctx.gl.deleteProgram(this.program);
  }
}

/** Multiplicação exposta para testes de reconstrução do raio. */
export { multiply as multiplyMat4 };
