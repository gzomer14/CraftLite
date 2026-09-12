/**
 * Contorno do bloco mirado e overlay de rachadura (doc 06 §4 e §5).
 *
 * Os dois desenham sobre o bloco já renderizado, então precisam de
 * `polygonOffset` e `depthFunc(LEQUAL)` — sem isso o Z-fighting faz o contorno
 * piscar conforme o ângulo da câmera.
 */

import { createProgram, uniformLocations, type GlContext } from './gl';
import {
  CRACK_FS_100, CRACK_FS_300, CRACK_VS_100, CRACK_VS_300,
  LINE_FS_100, LINE_FS_300, LINE_VS_100, LINE_VS_300,
} from './shaders/overlay.glsl';
import type { Atlas } from './atlas';
import type { Mat4 } from '../core/math';

/** 12 arestas do cubo unitário, como pares de vértices. */
const EDGES = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
  0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0,
  0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1,
]);

/** Cubo com UV por face, para a rachadura. 6 faces × 2 triângulos. */
function buildCrackCube(): Float32Array {
  const out: number[] = [];
  // Cada face: origem + dois vetores de aresta, com UV 0..1.
  const faces: readonly number[][] = [
    [1, 0, 0, 0, 0, 1, 0, 1, 0], // +X
    [0, 0, 1, 0, 0, -1, 0, 1, 0], // -X
    [0, 1, 1, 1, 0, 0, 0, 0, -1], // +Y
    [0, 0, 0, 1, 0, 0, 0, 0, 1], // -Y
    [1, 0, 1, -1, 0, 0, 0, 1, 0], // +Z
    [0, 0, 0, 1, 0, 0, 0, 1, 0], // -Z
  ];
  for (const f of faces) {
    const [ox, oy, oz, e1x, e1y, e1z, e2x, e2y, e2z] = f;
    const corner = (u: number, v: number): void => {
      out.push(ox + e1x * u + e2x * v, oy + e1y * u + e2y * v, oz + e1z * u + e2z * v, u, v);
    };
    corner(0, 0); corner(1, 0); corner(1, 1);
    corner(0, 0); corner(1, 1); corner(0, 1);
  }
  return new Float32Array(out);
}

const LINE_UNIFORMS = ['uViewProj', 'uOrigin', 'uScale', 'uColor'] as const;
/** Abaixo deste brilho médio a rachadura é desenhada clara, não escura. */
const CRACK_DARK_THRESHOLD = 0.45;

/**
 * Tom e opacidade da fissura para um bloco de brilho `brightness` (0..1).
 *
 * O corte em 0,45 é o meio da faixa de brilho das texturas do jogo. A fissura
 * clara é menos opaca porque branco sobre escuro salta muito mais que preto
 * sobre claro — com a mesma opacidade ela virava um borrão.
 */
export function crackToneFor(brightness: number): { tone: number; alpha: number } {
  return brightness < CRACK_DARK_THRESHOLD
    ? { tone: 1, alpha: 0.55 }
    : { tone: 0, alpha: 0.75 };
}

const CRACK_UNIFORMS = ['uViewProj', 'uOrigin', 'uAtlas', 'uAtlasTiles', 'uLayer', 'uCrackColor'] as const;

export class SelectionPass {
  private readonly ctx: GlContext;
  private readonly atlas: Atlas;

  private readonly lineProgram: WebGLProgram;
  private readonly lineUniforms: Record<(typeof LINE_UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly lineBuffer: WebGLBuffer;

  private readonly crackProgram: WebGLProgram;
  private readonly crackUniforms: Record<(typeof CRACK_UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly crackBuffer: WebGLBuffer;
  private readonly crackVertexCount: number;

  /** Camadas dos 10 estágios, resolvidas uma vez no boot. */
  private readonly stageLayers = new Float32Array(10);

  constructor(ctx: GlContext, atlas: Atlas) {
    this.ctx = ctx;
    this.atlas = atlas;
    const gl = ctx.gl;
    const use300 = ctx.gl2 !== null;

    this.lineProgram = createProgram(
      gl, use300 ? LINE_VS_300 : LINE_VS_100, use300 ? LINE_FS_300 : LINE_FS_100, 'selection',
    );
    this.lineUniforms = uniformLocations(gl, this.lineProgram, LINE_UNIFORMS);
    this.lineBuffer = createBuffer(gl, EDGES);

    this.crackProgram = createProgram(
      gl, use300 ? CRACK_VS_300 : CRACK_VS_100, use300 ? CRACK_FS_300 : CRACK_FS_100, 'crack',
    );
    this.crackUniforms = uniformLocations(gl, this.crackProgram, CRACK_UNIFORMS);
    const crackData = buildCrackCube();
    this.crackBuffer = createBuffer(gl, crackData);
    this.crackVertexCount = crackData.length / 5;

    for (let i = 0; i < 10; i++) {
      this.stageLayers[i] = atlas.layerOf(`block/destroy_stage_${i}`);
    }
  }

  /** Contorno wireframe do bloco mirado (doc 06 §5: preto, alpha 0.4). */
  drawOutline(viewProj: Mat4, x: number, y: number, z: number): void {
    const gl = this.ctx.gl;
    gl.useProgram(this.lineProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(this.lineUniforms.uViewProj, false, viewProj);
    // Um fio de folga para o contorno não afundar na face do bloco.
    gl.uniform3f(this.lineUniforms.uOrigin, x - 0.002, y - 0.002, z - 0.002);
    gl.uniform3f(this.lineUniforms.uScale, 1.004, 1.004, 1.004);
    gl.uniform4f(this.lineUniforms.uColor, 0, 0, 0, 0.4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, EDGES.length / 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(0);
  }

  /**
   * Rachadura do bloco sendo quebrado.
   *
   * `brightness` é o brilho médio da textura do bloco (0..1). A fissura era
   * sempre escura, em blend de multiplicação, e em bloco escuro — tronco,
   * obsidiana, pedra profunda — ela simplesmente não aparecia: não dava para
   * ver se a batida estava pegando. Agora a cor acompanha o bloco, clara no
   * escuro e escura no claro, que é o que garante contraste nos dois extremos.
   */
  drawCrack(
    viewProj: Mat4, x: number, y: number, z: number, stage: number, brightness = 1,
  ): void {
    if (stage < 0 || stage > 9) return;
    const gl = this.ctx.gl;

    gl.useProgram(this.crackProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.crackBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    this.atlas.bind(0);
    gl.uniform1i(this.crackUniforms.uAtlas, 0);
    if (!this.atlas.isArray) {
      gl.uniform2f(this.crackUniforms.uAtlasTiles, this.atlas.tilesPerRow, 1 / this.atlas.tilesPerRow);
    }
    gl.uniformMatrix4fv(this.crackUniforms.uViewProj, false, viewProj);
    gl.uniform3f(this.crackUniforms.uOrigin, x, y, z);
    gl.uniform1f(this.crackUniforms.uLayer, this.stageLayers[stage]);
    const { tone, alpha } = crackToneFor(brightness);
    gl.uniform4f(this.crackUniforms.uCrackColor, tone, tone, tone, alpha);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, this.crackVertexCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(0);
  }

  dispose(): void {
    const gl = this.ctx.gl;
    gl.deleteBuffer(this.lineBuffer);
    gl.deleteBuffer(this.crackBuffer);
    gl.deleteProgram(this.lineProgram);
    gl.deleteProgram(this.crackProgram);
  }
}

function createBuffer(gl: WebGLRenderingContext | WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error('Falha ao criar buffer de overlay.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}
