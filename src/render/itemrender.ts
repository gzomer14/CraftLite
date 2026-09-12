/**
 * Desenha os itens dropados no chão.
 *
 * São billboards texturizados com instancing: uma draw call para todos os
 * itens da tela, independente de quantos tipos diferentes existem — o mesmo
 * argumento do texture array no terreno.
 *
 * A textura é a **folha de sprites de item** (`itemsprites.ts`), a mesma que a
 * interface usa: assim o machado no chão é o mesmo desenho do machado no slot,
 * e blocos aparecem em isométrica em vez de um quadrado chapado.
 *
 * Flutuam e giram devagar, o que é o que faz um item no chão ser notado sem
 * precisar de contorno nem de brilho.
 */

import { createProgram, uniformLocations, type GlContext } from './gl';
import type { ItemSheet } from './itemsprites';
import type { Mat4 } from '../core/math';

const VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aCenterTile;   // xyz = centro, w = índice do tile
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
uniform vec2 uSheet;                        // colunas, linhas
out vec2 vUv;
void main() {
  vec2 local = aCorner + 0.5;
  float tile = aCenterTile.w;
  vec2 cell = vec2(mod(tile, uSheet.x), floor(tile / uSheet.x));
  // V invertido: a folha nasce com y para baixo, a tela com y para cima.
  vUv = (cell + vec2(local.x, 1.0 - local.y)) / uSheet;
  vec3 world = aCenterTile.xyz + (uRight * aCorner.x + uUp * aCorner.y) * uSize;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const FS_300 = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uSprites;
out vec4 fragColor;
void main() {
  vec4 texel = texture(uSprites, vUv);
  if (texel.a < 0.5) discard;
  fragColor = texel;
}
`;

const VS_100 = `
precision highp float;
attribute vec2 aCorner;
attribute vec4 aCenterTile;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
uniform vec2 uSheet;
varying vec2 vUv;
void main() {
  vec2 local = aCorner + 0.5;
  float tile = aCenterTile.w;
  vec2 cell = vec2(mod(tile, uSheet.x), floor(tile / uSheet.x));
  vUv = (cell + vec2(local.x, 1.0 - local.y)) / uSheet;
  vec3 world = aCenterTile.xyz + (uRight * aCorner.x + uUp * aCorner.y) * uSize;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

const FS_100 = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSprites;
void main() {
  vec4 texel = texture2D(uSprites, vUv);
  if (texel.a < 0.5) discard;
  gl_FragColor = texel;
}
`;

const UNIFORMS = ['uViewProj', 'uRight', 'uUp', 'uSize', 'uSprites', 'uSheet'] as const;

const CORNERS = new Float32Array([
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
]);

/** Tamanho do sprite no mundo, em blocos. */
const ITEM_SIZE = 0.35;
/** Amplitude e velocidade do flutuar. */
const BOB_HEIGHT = 0.07;
const BOB_SPEED = 0.06;

export class ItemRenderer {
  private readonly ctx: GlContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly cornerBuffer: WebGLBuffer;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly data: Float32Array;
  private readonly capacity: number;
  private readonly columns: number;
  private readonly rows: number;
  /** itemId → tile na folha. */
  private readonly tiles: Map<number, number>;
  private count = 0;

  constructor(ctx: GlContext, sheet: ItemSheet, capacity = 512) {
    this.ctx = ctx;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 4);
    this.columns = sheet.columns;
    this.rows = sheet.rows;
    this.tiles = sheet.index;

    const gl = ctx.gl;
    const use300 = ctx.gl2 !== null;
    this.program = createProgram(gl, use300 ? VS_300 : VS_100, use300 ? FS_300 : FS_100, 'items');
    this.uniforms = uniformLocations(gl, this.program, UNIFORMS);

    const corner = gl.createBuffer();
    const instance = gl.createBuffer();
    const texture = gl.createTexture();
    if (corner === null || instance === null || texture === null) {
      throw new Error('Falha ao criar buffers de item.');
    }
    this.cornerBuffer = corner;
    this.instanceBuffer = instance;
    this.texture = texture;

    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, instance);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, sheet.width, sheet.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(sheet.pixels.buffer),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Zera a lista do frame. */
  begin(): void {
    this.count = 0;
  }

  /** Acrescenta um item; `age` dá o flutuar. Ignora item sem sprite. */
  add(x: number, y: number, z: number, item: number, age: number): void {
    if (this.count >= this.capacity) return;
    const tile = this.tiles.get(item);
    if (tile === undefined) return;
    const o = this.count++ * 4;
    this.data[o] = x;
    this.data[o + 1] = y + ITEM_SIZE * 0.5 + Math.sin(age * BOB_SPEED) * BOB_HEIGHT;
    this.data[o + 2] = z;
    this.data[o + 3] = tile;
  }

  get pending(): number {
    return this.count;
  }

  /** Desenha tudo numa chamada. Devolve o número de draw calls (0 ou 1). */
  render(viewProj: Mat4, view: Mat4): number {
    if (this.count === 0) return 0;
    const gl = this.ctx.gl;
    const gl2 = this.ctx.gl2;

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.uSprites, 0);
    gl.uniform2f(this.uniforms.uSheet, this.columns, this.rows);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    // Linhas 0 e 1 da view são os eixos direita/cima da câmera.
    gl.uniform3f(this.uniforms.uRight, view[0], view[4], view[8]);
    gl.uniform3f(this.uniforms.uUp, view[1], view[5], view[9]);
    gl.uniform1f(this.uniforms.uSize, ITEM_SIZE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * 4));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);

    if (gl2 !== null) {
      gl2.vertexAttribDivisor(1, 1);
      gl2.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
      gl2.vertexAttribDivisor(1, 0);
    } else if (this.ctx.extInstanced !== null) {
      const ext = this.ctx.extInstanced;
      ext.vertexAttribDivisorANGLE(1, 1);
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, this.count);
      ext.vertexAttribDivisorANGLE(1, 0);
    }

    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(0);
    return 1;
  }

  dispose(): void {
    const gl = this.ctx.gl;
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
  }
}
