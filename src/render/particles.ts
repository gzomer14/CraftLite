/**
 * Partículas: quads billboard desenhados com instancing (doc 01 §5.3, passe 5).
 *
 * O pool é fixo e pré-alocado. Partícula é o sistema que mais tenta gerar lixo
 * num jogo de voxels — 4 por tick quebrando um bloco, 8 ao quebrar — então
 * nada aqui aloca: partícula morta vira slot livre, não objeto novo.
 */

import { createProgram, uniformLocations, type GlContext } from './gl';
import type { Mat4 } from '../core/math';
import type { Preset } from '../core/tier';

const VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aCenter;
layout(location = 2) in vec4 aColorSize;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
out vec3 vColor;
void main() {
  vColor = aColorSize.rgb;
  vec3 world = aCenter + (uRight * aCorner.x + uUp * aCorner.y) * aColorSize.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const FS_300 = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }
`;

const VS_100 = `
precision highp float;
attribute vec2 aCorner;
attribute vec3 aCenter;
attribute vec4 aColorSize;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec3 vColor;
void main() {
  vColor = aColorSize.rgb;
  vec3 world = aCenter + (uRight * aCorner.x + uUp * aCorner.y) * aColorSize.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const FS_100 = `
precision mediump float;
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); }
`;

const UNIFORMS = ['uViewProj', 'uRight', 'uUp'] as const;

/** Quad unitário centrado na origem. */
const CORNERS = new Float32Array([
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
]);

const GRAVITY = -0.04;
const DRAG = 0.94;

export class Particles {
  private readonly ctx: GlContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly cornerBuffer: WebGLBuffer;
  private readonly instanceBuffer: WebGLBuffer;

  /** Estado por partícula, em arrays paralelas (nada de objetos). */
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Int16Array;
  /** Dados enviados à GPU: cx, cy, cz, r, g, b, size. */
  private readonly instanceData: Float32Array;

  private readonly capacity: number;
  private count = 0;

  /**
   * Teto vivo de partículas, do controle "Partículas" do doc 08 §3.11.
   *
   * Os arrays são alocados **sempre no máximo** (1024 posições, ~36 KB de
   * `TypedArray` somando tudo) e o modo mexe só neste número. Dimensionar o
   * array pelo preset economizaria 30 KB num aparelho de 2 GB e, em troca,
   * faria o jogador de T0 que escolhe "Todas" não ver diferença nenhuma — o
   * controle mentiria. Trinta quilobytes não valem uma opção que não funciona.
   */
  limit: number;

  constructor(ctx: GlContext, preset: Preset) {
    this.ctx = ctx;
    this.capacity = MAX_PARTICLES;
    this.limit = limitFor(preset.particles);

    this.px = new Float32Array(this.capacity);
    this.py = new Float32Array(this.capacity);
    this.pz = new Float32Array(this.capacity);
    this.vx = new Float32Array(this.capacity);
    this.vy = new Float32Array(this.capacity);
    this.vz = new Float32Array(this.capacity);
    this.life = new Int16Array(this.capacity);
    this.instanceData = new Float32Array(this.capacity * 7);

    const gl = ctx.gl;
    const use300 = ctx.gl2 !== null;
    this.program = createProgram(gl, use300 ? VS_300 : VS_100, use300 ? FS_300 : FS_100, 'particles');
    this.uniforms = uniformLocations(gl, this.program, UNIFORMS);

    const corner = gl.createBuffer();
    const instance = gl.createBuffer();
    if (corner === null || instance === null) throw new Error('Falha ao criar buffers de partícula.');
    this.cornerBuffer = corner;
    this.instanceBuffer = instance;
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, instance);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  get active(): number {
    return this.count;
  }

  /** Aplica o modo escolhido nas opções. */
  setMode(mode: 'min' | 'reduced' | 'all'): void {
    this.limit = limitFor(mode);
    if (this.count > this.limit) this.count = this.limit;
  }

  /**
   * Emite `n` partículas saindo de um bloco, com a cor média da textura dele
   * (doc 06 §4). A cor vem pronta do chamador para não ler textura no tick.
   */
  emitBlockBreak(
    x: number, y: number, z: number, n: number, r: number, g: number, b: number,
  ): void {
    for (let i = 0; i < n; i++) {
      if (this.count >= this.limit) return;
      const s = this.count++;
      this.px[s] = x + Math.random();
      this.py[s] = y + Math.random();
      this.pz[s] = z + Math.random();
      this.vx[s] = (Math.random() - 0.5) * 0.15;
      this.vy[s] = Math.random() * 0.2;
      this.vz[s] = (Math.random() - 0.5) * 0.15;
      this.life[s] = 12 + ((Math.random() * 10) | 0);
      const o = s * 7;
      this.instanceData[o + 3] = r;
      this.instanceData[o + 4] = g;
      this.instanceData[o + 5] = b;
      this.instanceData[o + 6] = 0.12;
    }
  }

  /**
   * Um brilho parado, de vida curta — é o que desenha o orbe de XP.
   *
   * Emitir uma partícula por orbe por frame sai **muito** mais barato que um
   * passe de render próprio: reusa a mesma draw call instanciada e some sozinho
   * se o pool encher, que é exatamente o comportamento desejado em T0.
   */
  emitGlow(x: number, y: number, z: number, r: number, g: number, b: number, size = 0.22): void {
    if (this.count >= this.limit) return;
    const s = this.count++;
    this.px[s] = x;
    this.py[s] = y;
    this.pz[s] = z;
    this.vx[s] = 0;
    this.vy[s] = 0;
    this.vz[s] = 0;
    // Duas vidas: some antes de a gravidade puxar o brilho para longe do orbe.
    this.life[s] = 2;
    const o = s * 7;
    this.instanceData[o + 3] = r;
    this.instanceData[o + 4] = g;
    this.instanceData[o + 5] = b;
    this.instanceData[o + 6] = size;
  }

  /**
   * Fagulha de tocha: sobe devagar, apaga rápido (M8).
   *
   * É o que faz a tocha **acesa** parecer acesa. A geometria dela virou um
   * poste com a brasa no topo, e um poste parado não pisca; a fagulha é o
   * movimento que o olho procura.
   *
   * Sobe porque a velocidade inicial vence a gravidade nos primeiros ticks e
   * o arrasto come a diferença — a mesma física das outras, sem exceção.
   */
  emitFlame(x: number, y: number, z: number): void {
    if (this.count >= this.limit) return;
    const s = this.count++;
    this.px[s] = x + (Math.random() - 0.5) * 0.12;
    this.py[s] = y;
    this.pz[s] = z + (Math.random() - 0.5) * 0.12;
    this.vx[s] = 0;
    this.vy[s] = 0.055;
    this.vz[s] = 0;
    this.life[s] = 6 + Math.floor(Math.random() * 5);
    const o = s * 7;
    // Da brasa ao amarelo claro: duas fagulhas seguidas não saem iguais.
    const heat = 0.7 + Math.random() * 0.3;
    this.instanceData[o + 3] = 1;
    this.instanceData[o + 4] = 0.55 * heat + 0.2;
    this.instanceData[o + 5] = 0.16 * heat;
    this.instanceData[o + 6] = 0.045;
  }

  /**
   * Gotas de chuva caindo em volta do jogador (doc 03 §8).
   *
   * Reusa o mesmo pool e a mesma draw call: chuva não merece um passe próprio
   * em T0. `budget` limita quantas gotas entram por frame, e o pool cheio
   * simplesmente para de aceitar — a chuva rareia em vez de derrubar o frame.
   */
  emitRain(x: number, y: number, z: number, radius: number, budget: number): void {
    for (let i = 0; i < budget; i++) {
      if (this.count >= this.limit) return;
      const s = this.count++;
      this.px[s] = x + (Math.random() - 0.5) * radius * 2;
      this.py[s] = y + 6 + Math.random() * 4;
      this.pz[s] = z + (Math.random() - 0.5) * radius * 2;
      this.vx[s] = 0;
      this.vy[s] = -0.55;
      this.vz[s] = 0;
      this.life[s] = 14;
      const o = s * 7;
      this.instanceData[o + 3] = 0.55;
      this.instanceData[o + 4] = 0.62;
      this.instanceData[o + 5] = 0.78;
      this.instanceData[o + 6] = 0.05;
    }
  }

  /** Um tick de simulação. Partícula morta é trocada pela última do pool. */
  tick(): void {
    for (let i = 0; i < this.count; i++) {
      this.life[i]--;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        i--;
        continue;
      }
      this.vy[i] += GRAVITY;
      this.vx[i] *= DRAG;
      this.vy[i] *= DRAG;
      this.vz[i] *= DRAG;
      this.px[i] += this.vx[i];
      this.py[i] += this.vy[i];
      this.pz[i] += this.vz[i];
    }
  }

  /** Troca com a última: remover do meio sem realocar nem embaralhar. */
  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.px[i] = this.px[last];
    this.py[i] = this.py[last];
    this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.vz[i] = this.vz[last];
    this.life[i] = this.life[last];
    const to = i * 7;
    const from = last * 7;
    for (let k = 3; k < 7; k++) this.instanceData[to + k] = this.instanceData[from + k];
  }

  /**
   * Desenha todas as partículas em uma chamada. `right` e `up` vêm da matriz de
   * vista — é o que faz o quad ficar sempre de frente para a câmera.
   */
  render(viewProj: Mat4, view: Mat4, alpha: number): void {
    if (this.count === 0) return;
    const gl = this.ctx.gl;
    const gl2 = this.ctx.gl2;

    // Interpola a posição para o render, como o resto do jogo.
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      this.instanceData[o] = this.px[i] + this.vx[i] * alpha;
      this.instanceData[o + 1] = this.py[i] + this.vy[i] * alpha;
      this.instanceData[o + 2] = this.pz[i] + this.vz[i] * alpha;
    }

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    // Linhas 0 e 1 da matriz de vista são os eixos "direita" e "cima" da câmera.
    gl.uniform3f(this.uniforms.uRight, view[0], view[4], view[8]);
    gl.uniform3f(this.uniforms.uUp, view[1], view[5], view[9]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, this.count * 7));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 28, 12);

    if (gl2 !== null) {
      gl2.vertexAttribDivisor(1, 1);
      gl2.vertexAttribDivisor(2, 1);
      gl2.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
      gl2.vertexAttribDivisor(1, 0);
      gl2.vertexAttribDivisor(2, 0);
    } else if (this.ctx.extInstanced !== null) {
      const ext = this.ctx.extInstanced;
      ext.vertexAttribDivisorANGLE(1, 1);
      ext.vertexAttribDivisorANGLE(2, 1);
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, this.count);
      ext.vertexAttribDivisorANGLE(1, 0);
      ext.vertexAttribDivisorANGLE(2, 0);
    }

    gl.disableVertexAttribArray(2);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(0);
  }

  dispose(): void {
    const gl = this.ctx.gl;
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteProgram(this.program);
  }
}

/** Teto absoluto de partículas vivas — o tamanho dos arrays. */
const MAX_PARTICLES = 1024;

/** Quantas partículas cada modo do doc 08 §3.11 deixa viver. */
function limitFor(mode: 'min' | 'reduced' | 'all'): number {
  return mode === 'min' ? 128 : mode === 'reduced' ? 384 : MAX_PARTICLES;
}
