/**
 * Construção e upload de malhas.
 *
 * `MeshBuilder` escreve em `TypedArray`s que crescem por dobra — o mesmo objeto
 * é reusado entre chunks, então o caminho quente não aloca (doc 02 §5.5).
 * `GpuMesh` cuida do VBO/IBO/VAO e descarta o buffer da CPU logo após o upload
 * (doc 02 §3), já que manter os dois dobra o custo de memória.
 */

import type { GlContext } from './gl';
import {
  BYTES_PER_VERTEX_FLOAT, BYTES_PER_VERTEX_PACKED, POSITION_SCALE,
  packWord0, packWord1, writeFloatVertex,
} from './vertex';

/**
 * Cantos de cada face: `[ox,oy,oz, e1x,e1y,e1z, e2x,e2y,e2z]`, com `e1 × e2`
 * apontando para fora. Os multiplicadores de origem e de aresta são escalados
 * pela extensão do eixo tangente correspondente.
 */
const FACE_CORNERS: readonly (readonly number[])[] = [
  [0, 0, 1, /* e1 */ 0, 0, -1, /* e2 */ 0, 1, 0], // +X
  [0, 0, 0, /* e1 */ 0, 0, 1, /* e2 */ 0, 1, 0], // -X
  [0, 0, 1, /* e1 */ 1, 0, 0, /* e2 */ 0, 0, -1], // +Y
  [0, 0, 0, /* e1 */ 1, 0, 0, /* e2 */ 0, 0, 1], // -Y
  [0, 0, 0, /* e1 */ 1, 0, 0, /* e2 */ 0, 1, 0], // +Z
  [1, 0, 0, /* e1 */ -1, 0, 0, /* e2 */ 0, 1, 0], // -Z
];

/**
 * Deslocamento ao longo da normal. O chamador passa sempre a coordenada do
 * **bloco**; a face de uma direção positiva fica no lado oposto dele, a um
 * bloco de distância.
 */
const FACE_OFFSET: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 0, 0],
];

/** Em qual eixo cada aresta do quad se estende (0=X,1=Y,2=Z). */
const FACE_AXES: readonly (readonly [number, number])[] = [
  [2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1],
];

/**
 * true nas quatro faces laterais (±X, ±Z) — as que ficam **de pé**.
 *
 * **Correção de 2026-09-23.** O ladrilho é desenhado com a linha 0 **em cima**
 * (`texgen.ts`, `pattern`, a franja da grama, a brasa da tocha, a boca da
 * fornalha no terço inferior), e o WebGL entrega a linha 0 do upload em `v = 0`.
 * Os quads de pé punham `v = 0` na **base**: todo desenho lateral saía de ponta-
 * cabeça. Em textura simétrica (pedra, terra, tronco) isso não aparece; em flor,
 * muda, grama alta e plantação aparece de cara — relato do jogador em
 * 2026-09-23: *"ao colocar no chão fica invertido"*. O inventário não tinha o
 * erro porque o sprite lê o ladrilho de cima para baixo, como o canvas.
 *
 * Faces de cima e de baixo não mudam: a orientação delas (trilho, cama,
 * repetidor) já foi acertada à mão contra o `v` atual.
 */
export function isUprightFace(face: number): boolean {
  return face !== 2 && face !== 3;
}

export interface MeshData {
  /** `Uint32Array` (2/vértice) em WebGL2 ou `Float32Array` (8/vértice) em WebGL1. */
  vertices: ArrayBuffer;
  indices: ArrayBuffer;
  vertexCount: number;
  indexCount: number;
  /** true = índices `UNSIGNED_INT`. */
  wideIndices: boolean;
  packed: boolean;
  /**
   * Onde cada face começa no buffer de índices (M12): as 6 faces greedy, na
   * ordem `FACE_*`, e depois o resto (geometria de forma livre, que não tem
   * face única). `null` quando o mesh não foi montado face a face. Ver
   * `FaceBands` em `render/chunkrenderer.ts`.
   */
  faceStarts: Uint32Array | null;
}

export class MeshBuilder {
  private words: Uint32Array;
  private floats: Float32Array;
  private idx: Uint32Array;
  private vertexCount = 0;
  private indexCount = 0;
  readonly packed: boolean;

  constructor(packed: boolean, initialVerts = 4096) {
    this.packed = packed;
    this.words = new Uint32Array(initialVerts * 2);
    this.floats = packed ? new Float32Array(0) : new Float32Array(initialVerts * 8);
    this.idx = new Uint32Array(initialVerts * 3);
  }

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  get vertices(): number { return this.vertexCount; }
  get indices(): number { return this.indexCount; }
  get isEmpty(): boolean { return this.indexCount === 0; }

  /**
   * Emite um quad greedy. `(bx,by,bz)` é o canto mínimo em blocos; `w`/`h` são
   * o comprimento da corrida ao longo dos dois eixos tangentes da face.
   * `ao` traz os 4 níveis (0..3) na ordem dos cantos do quad.
   */
  addQuad(
    bx: number, by: number, bz: number, face: number,
    w: number, h: number, texLayer: number,
    blockLight: number, skyLight: number,
    ao: Uint8Array | number[], tint: number,
  ): void {
    this.ensure(4, 6);

    const c = FACE_CORNERS[face];
    const [axisU, axisV] = FACE_AXES[face];
    const ext = TMP_EXT;
    ext[0] = 0; ext[1] = 0; ext[2] = 0;
    ext[axisU] = w;
    ext[axisV] = h;

    const off = FACE_OFFSET[face];
    const ox = bx + c[0] * ext[0] + off[0];
    const oy = by + c[1] * ext[1] + off[1];
    const oz = bz + c[2] * ext[2] + off[2];

    // Uma componente não-nula de e1/e2 está sempre em um eixo tangente da face,
    // então multiplicar pela extensão daquele eixo dá o vetor de aresta certo.
    const e1x = c[3] * ext[0], e1y = c[4] * ext[1], e1z = c[5] * ext[2];
    const e2x = c[6] * ext[0], e2y = c[7] * ext[1], e2z = c[8] * ext[2];

    // Cantos na ordem 0,1,2,3 (CCW visto de fora) e suas UVs em tiles. Nas
    // faces de pé `e2` sobe, e o `v` desce: linha 0 do desenho no alto.
    const upright = isUprightFace(face);
    const v0 = upright ? h : 0;
    const v1 = upright ? 0 : h;
    const base = this.vertexCount;
    this.vertex(ox, oy, oz, face, 0, v0, texLayer, blockLight, skyLight, ao[0], tint);
    this.vertex(ox + e1x, oy + e1y, oz + e1z, face, w, v0, texLayer, blockLight, skyLight, ao[1], tint);
    this.vertex(ox + e1x + e2x, oy + e1y + e2y, oz + e1z + e2z, face, w, v1, texLayer, blockLight, skyLight, ao[2], tint);
    this.vertex(ox + e2x, oy + e2y, oz + e2z, face, 0, v1, texLayer, blockLight, skyLight, ao[3], tint);

    // Flip do quad quando a diagonal errada criaria artefato de AO (doc 02 §5.2).
    const i = this.idx;
    let o = this.indexCount;
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      i[o++] = base + 1; i[o++] = base + 2; i[o++] = base + 3;
      i[o++] = base + 1; i[o++] = base + 3; i[o++] = base;
    } else {
      i[o++] = base; i[o++] = base + 1; i[o++] = base + 2;
      i[o++] = base; i[o++] = base + 2; i[o++] = base + 3;
    }
    this.indexCount = o;
  }

  /**
   * Emite um quad de cantos livres — o que blocos não-cubo precisam (cruz de
   * planta, laje, tocha). `corners` traz 4 cantos × 3 eixos em **blocos**, em
   * ordem anti-horária vista de fora; `doubleSided` reaproveita os mesmos 4
   * vértices com a ordem invertida, que é como a planta fica visível dos dois
   * lados sem desligar o culling do passe inteiro.
   *
   * Não participa do greedy nem carrega AO: são poucos quads e o custo de
   * calcular oclusão neles não se paga.
   *
   * `upright` diz que o quad está de pé, com os cantos 0 e 1 embaixo: aí o `v`
   * desce, como em `addQuad` (ver `isUprightFace`). O padrão sai da face; a
   * cruz de planta passa `true` explícito porque está de pé mas usa a face +Y
   * para ter a sombra de quem recebe o sol de cima.
   */
  addPolyQuad(
    corners: ArrayLike<number>, face: number, texLayer: number,
    blockLight: number, skyLight: number, tint: number, doubleSided: boolean,
    upright = isUprightFace(face),
  ): void {
    this.ensure(4, doubleSided ? 12 : 6);
    const v0 = upright ? 1 : 0;
    const v1 = 1 - v0;
    const base = this.vertexCount;
    this.vertex(corners[0], corners[1], corners[2], face, 0, v0, texLayer, blockLight, skyLight, 3, tint);
    this.vertex(corners[3], corners[4], corners[5], face, 1, v0, texLayer, blockLight, skyLight, 3, tint);
    this.vertex(corners[6], corners[7], corners[8], face, 1, v1, texLayer, blockLight, skyLight, 3, tint);
    this.vertex(corners[9], corners[10], corners[11], face, 0, v1, texLayer, blockLight, skyLight, 3, tint);

    const i = this.idx;
    let o = this.indexCount;
    i[o++] = base; i[o++] = base + 1; i[o++] = base + 2;
    i[o++] = base; i[o++] = base + 2; i[o++] = base + 3;
    if (doubleSided) {
      i[o++] = base + 2; i[o++] = base + 1; i[o++] = base;
      i[o++] = base + 3; i[o++] = base + 2; i[o++] = base;
    }
    this.indexCount = o;
  }

  private vertex(
    x: number, y: number, z: number, face: number, u: number, v: number,
    texLayer: number, bl: number, sl: number, ao: number, tint: number,
  ): void {
    const n = this.vertexCount;
    // Dezesseis avos: é a grade em que toda forma do jogo é descrita (laje,
    // poste de cerca, tocha, porta), então arredondar aqui é exato.
    const x16 = Math.round(x * POSITION_SCALE);
    const y16 = Math.round(y * POSITION_SCALE);
    const z16 = Math.round(z * POSITION_SCALE);
    if (this.packed) {
      const o = n * 2;
      this.words[o] = packWord0(x16, y16, z16, face, tint);
      this.words[o + 1] = packWord1(texLayer, bl, sl, ao, tint, u, v);
    } else {
      writeFloatVertex(
        this.floats, n * 8, x16, y16, z16, face, u, v, texLayer, bl, sl, ao, tint,
      );
    }
    this.vertexCount = n + 1;
  }

  private ensure(verts: number, indices: number): void {
    if (this.packed) {
      if ((this.vertexCount + verts) * 2 > this.words.length) {
        const next = new Uint32Array(Math.max(this.words.length * 2, (this.vertexCount + verts) * 2));
        next.set(this.words);
        this.words = next;
      }
    } else if ((this.vertexCount + verts) * 8 > this.floats.length) {
      const next = new Float32Array(Math.max(this.floats.length * 2, (this.vertexCount + verts) * 8));
      next.set(this.floats);
      this.floats = next;
    }
    if (this.indexCount + indices > this.idx.length) {
      const next = new Uint32Array(Math.max(this.idx.length * 2, this.indexCount + indices));
      next.set(this.idx);
      this.idx = next;
    }
  }

  /** Copia o resultado para buffers do tamanho exato, prontos para transferir. */
  build(): MeshData {
    const wide = this.vertexCount > 65535;
    const indices = wide
      ? this.idx.slice(0, this.indexCount)
      : Uint16Array.from(this.idx.subarray(0, this.indexCount));
    const vertices = this.packed
      ? this.words.slice(0, this.vertexCount * 2)
      : this.floats.slice(0, this.vertexCount * 8);
    return {
      vertices: vertices.buffer,
      indices: indices.buffer,
      vertexCount: this.vertexCount,
      indexCount: this.indexCount,
      wideIndices: wide,
      packed: this.packed,
      faceStarts: null,
    };
  }
}

const TMP_EXT = new Int32Array(3);

/** Malha residente na GPU. Um VBO + um IBO + um VAO por section. */
export class GpuMesh {
  private readonly ctx: GlContext;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private vao: WebGLVertexArrayObject | null = null;
  private vboCapacity = 0;
  private iboCapacity = 0;

  indexCount = 0;
  vertexCount = 0;
  indexType = 0;
  /** Faixas de face do último upload (`MeshData.faceStarts`). */
  faceStarts: Uint32Array | null = null;

  constructor(ctx: GlContext) {
    this.ctx = ctx;
    const gl = ctx.gl;
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (vbo === null || ibo === null) throw new Error('Falha ao criar buffers de malha.');
    this.vbo = vbo;
    this.ibo = ibo;
  }

  /**
   * Sobe os dados. Reusa a alocação de GPU quando o novo mesh cabe no buffer
   * existente, evitando realocação (doc 02 §5.6).
   */
  upload(data: MeshData): void {
    const { gl, gl2 } = this.ctx;
    const vertexBytes = new Uint8Array(data.vertices);
    const indexBytes = new Uint8Array(data.indices);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (vertexBytes.byteLength > this.vboCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, vertexBytes, gl.DYNAMIC_DRAW);
      this.vboCapacity = vertexBytes.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexBytes);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    if (indexBytes.byteLength > this.iboCapacity) {
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexBytes, gl.DYNAMIC_DRAW);
      this.iboCapacity = indexBytes.byteLength;
    } else {
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indexBytes);
    }

    this.indexCount = data.indexCount;
    this.vertexCount = data.vertexCount;
    this.faceStarts = data.faceStarts;
    this.indexType = data.wideIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    if (this.vao === null) this.vao = this.createVao(data.packed);
    void gl2;
  }

  private createVao(packed: boolean): WebGLVertexArrayObject | null {
    const { gl, gl2, extVao } = this.ctx;
    const vao = gl2 ? gl2.createVertexArray() : extVao ? extVao.createVertexArrayOES() : null;
    if (vao !== null) this.bindVao(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

    if (packed && gl2 !== null) {
      gl2.enableVertexAttribArray(0);
      gl2.vertexAttribIPointer(0, 2, gl2.UNSIGNED_INT, BYTES_PER_VERTEX_PACKED, 0);
    } else {
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, BYTES_PER_VERTEX_FLOAT, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_VERTEX_FLOAT, 16);
    }

    if (vao !== null) this.bindVao(null);
    return vao;
  }

  private bindVao(vao: WebGLVertexArrayObject | null): void {
    const { gl2, extVao } = this.ctx;
    if (gl2 !== null) gl2.bindVertexArray(vao);
    else if (extVao !== null) extVao.bindVertexArrayOES(vao);
  }

  draw(): void {
    if (this.indexCount === 0) return;
    const gl = this.ctx.gl;
    this.bindVao(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
    this.bindVao(null);
  }

  /**
   * Desenha só as faces de `faces` (bit por `FACE_*`), mais a faixa final de
   * geometria livre (M12, culling por direção de face). Faixas vizinhas que
   * ficam acesas saem numa chamada só; devolve quantas chamadas fez.
   */
  drawFaces(faces: number): number {
    if (this.indexCount === 0) return 0;
    const starts = this.faceStarts;
    if (starts === null || (faces & 0x3f) === 0x3f) {
      this.draw();
      return 1;
    }
    const gl = this.ctx.gl;
    const bytes = this.indexType === gl.UNSIGNED_INT ? 4 : 2;
    this.bindVao(this.vao);
    let calls = 0;
    let run = -1;
    for (let band = 0; band <= 6; band++) {
      const first = starts[band];
      const end = band < 6 ? starts[band + 1] : this.indexCount;
      // Faixa vazia não abre nem fecha corrida.
      if (end === first) continue;
      if (band === 6 || (faces & (1 << band)) !== 0) {
        if (run < 0) run = first;
      } else if (run >= 0) {
        gl.drawElements(gl.TRIANGLES, first - run, this.indexType, run * bytes);
        calls++;
        run = -1;
      }
    }
    if (run >= 0) {
      gl.drawElements(gl.TRIANGLES, this.indexCount - run, this.indexType, run * bytes);
      calls++;
    }
    this.bindVao(null);
    return calls;
  }

  dispose(): void {
    const { gl, gl2, extVao } = this.ctx;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    if (this.vao !== null) {
      if (gl2 !== null) gl2.deleteVertexArray(this.vao);
      else if (extVao !== null) extVao.deleteVertexArrayOES(this.vao);
    }
  }
}

/** Quantos bytes uma malha ocupa na GPU — usado pelo overlay de debug. */
export function meshBytes(data: MeshData): number {
  return data.vertices.byteLength + data.indices.byteLength;
}
