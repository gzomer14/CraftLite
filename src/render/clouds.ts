/**
 * Passe de nuvens (doc 08 §3.11, linha "Nuvens": Off / Rápido / Bonito).
 *
 * Um plano horizontal a 192 de altura, centrado no jogador, com a forma feita
 * no shader (`shaders/clouds.glsl.ts`). **Uma draw call, dois triângulos, zero
 * bytes de textura** — é o único desenho que o orçamento de T0 aceitaria se um
 * dia as nuvens forem ligadas lá.
 *
 * Desenha **depois do terreno opaco**, com teste de profundidade ligado e sem
 * escrever profundidade: assim a montanha que passa na frente da nuvem a
 * esconde, e quem voa acima delas vê o chão sumir por baixo.
 *
 * As nuvens não existem em dimensão sem céu: quem decide é o `Renderer`, que
 * já sabe a dimensão.
 */

import { createProgram, uniformLocations, type GlContext } from './gl';
import {
  CLOUDS_FS_100, CLOUDS_FS_300, CLOUDS_VS_100, CLOUDS_VS_300,
} from './shaders/clouds.glsl';
import type { Mat4 } from '../core/math';

const UNIFORMS = [
  'uViewProj', 'uCenter', 'uRadius', 'uScroll', 'uScale', 'uOctaves', 'uCover', 'uTint',
] as const;

/** Altura do teto de nuvens, em blocos. Acima do topo de construção. */
export const CLOUD_HEIGHT = 192;
/** Lado de uma célula de ruído, em blocos. */
const CLOUD_SCALE = 220;
/** Blocos por segundo que o teto anda. Devagar: nuvem correndo distrai. */
const CLOUD_SPEED = 0.6;
/**
 * Raio do plano, em blocos. Fixo e generoso: ele não acompanha a distância de
 * render porque a nuvem está acima da névoa, e encolher o plano junto com ela
 * mostraria a borda.
 */
const CLOUD_RADIUS = 1400;

export type CloudsMode = 'off' | 'fast' | 'fancy';

export class CloudsPass {
  private readonly ctx: GlContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly quad: WebGLBuffer;
  private readonly center = new Float32Array(3);
  private readonly tint = new Float32Array(3);
  private readonly scroll = new Float32Array(2);

  /** `off` não desenha nada — e é o padrão de T0. */
  mode: CloudsMode = 'off';

  constructor(ctx: GlContext) {
    this.ctx = ctx;
    const use300 = ctx.gl2 !== null;
    this.program = createProgram(
      ctx.gl,
      use300 ? CLOUDS_VS_300 : CLOUDS_VS_100,
      use300 ? CLOUDS_FS_300 : CLOUDS_FS_100,
      'clouds',
    );
    this.uniforms = uniformLocations(ctx.gl, this.program, UNIFORMS);

    const quad = ctx.gl.createBuffer();
    if (quad === null) throw new Error('Falha ao criar o plano de nuvens.');
    this.quad = quad;
    ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, quad);
    ctx.gl.bufferData(
      ctx.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
      ctx.gl.STATIC_DRAW,
    );
  }

  /**
   * Desenha o teto. Devolve quantas draw calls gastou (0 ou 1).
   *
   * `dayTime` em ticks do dia move o teto; `dayFactor` escurece a nuvem à
   * noite, junto com o céu.
   */
  render(viewProj: Mat4, camX: number, camZ: number, dayTime: number, dayFactor: number): number {
    if (this.mode === 'off') return 0;
    const gl = this.ctx.gl;

    this.center[0] = camX;
    this.center[1] = CLOUD_HEIGHT;
    this.center[2] = camZ;
    // O teto anda no eixo X, como no gênero. O tick é a fonte do tempo: assim
    // duas máquinas com o mesmo mundo veem a nuvem no mesmo lugar.
    this.scroll[0] = (dayTime / 20) * CLOUD_SPEED;
    this.scroll[1] = 0;
    // Branco de dia, azul-chumbo à noite: nuvem branca no céu preto é adesivo.
    const shade = 0.22 + dayFactor * 0.78;
    this.tint[0] = shade;
    this.tint[1] = shade;
    this.tint[2] = Math.min(1, shade * 1.04);

    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    // O plano é visto por baixo na maior parte do tempo, e por cima quando se
    // voa: desligar o culling evita ter que orientar o quad pela câmera.
    gl.disable(gl.CULL_FACE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    gl.uniform3fv(this.uniforms.uCenter, this.center);
    gl.uniform1f(this.uniforms.uRadius, CLOUD_RADIUS);
    gl.uniform2fv(this.uniforms.uScroll, this.scroll);
    gl.uniform1f(this.uniforms.uScale, CLOUD_SCALE);
    gl.uniform1f(this.uniforms.uOctaves, this.mode === 'fancy' ? 2 : 1);
    // Bonito cobre um pouco mais de céu; rápido deixa o azul aparecer.
    gl.uniform1f(this.uniforms.uCover, this.mode === 'fancy' ? 0.52 : 0.58);
    gl.uniform3fv(this.uniforms.uTint, this.tint);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return 1;
  }

  dispose(): void {
    this.ctx.gl.deleteBuffer(this.quad);
    this.ctx.gl.deleteProgram(this.program);
  }
}
