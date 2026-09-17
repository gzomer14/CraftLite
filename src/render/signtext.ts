/**
 * Texto das placas, desenhado no mundo (doc 14 — M8).
 *
 * **Por que não entra no mesh do chunk.** O texto é por *instância*: duas
 * placas do mesmo bloco, no mesmo estado, escrevem coisas diferentes. Colocá-lo
 * no mesh obrigaria a remesar a section a cada letra digitada e a carregar o
 * texto até o worker. Aqui ele é um passe próprio, com um quad por glifo, em um
 * buffer dinâmico — o mesmo arranjo que `mobrender.ts` usa e pela mesma razão.
 *
 * **Por que `discard` e não blend.** O glifo fica 2 milésimos de bloco à frente
 * da tábua da própria placa. Com mistura, seria preciso ordenar de trás para
 * frente glifo a glifo; com descarte por alfa, a profundidade resolve sozinha.
 *
 * Nada aqui aloca por quadro: os vértices vão para um `Float32Array`
 * pré-alocado e o que passa do teto simplesmente não é desenhado.
 */

import { CELL_H, CELL_W, FONT_COLUMNS, FONT_SIZE, glyphCell } from '../data/font';
import { SIGN_COLUMNS, SIGN_LINES } from '../game/signs';
import { createProgram, uniformLocations, type GlContext } from './gl';
import { buildFontSheet } from './fontgen';
import {
  SIGN_FS_100, SIGN_FS_300, SIGN_VS_100, SIGN_VS_300,
} from './shaders/signtext.glsl';
import type { Mat4 } from '../core/math';

/** Espessura da tábua, igual à de `world/mesh/shapes.ts`. */
const PANE = 1 / 16;
/** Folga do texto sobre a tábua: o bastante para não brigar no Z. */
const LIFT = 0.002;

/** A tábua escrita, em fração de bloco. */
const BOARD_BOTTOM = 0.5;
const BOARD_TOP = 1;
const BOARD_MIN = 1 / 8;
const BOARD_MAX = 7 / 8;
/** Margem interna: o texto não encosta na borda da tábua. */
const PADDING = 1 / 32;

const AREA_LEFT = BOARD_MIN + PADDING;
const AREA_RIGHT = BOARD_MAX - PADDING;
const AREA_BOTTOM = BOARD_BOTTOM + PADDING;
const AREA_TOP = BOARD_TOP - PADDING;

/** Largura de uma coluna de texto e altura de uma linha, em fração de bloco. */
const ADVANCE = (AREA_RIGHT - AREA_LEFT) / SIGN_COLUMNS;
const ROW_HEIGHT = (AREA_TOP - AREA_BOTTOM) / SIGN_LINES;
/** A altura do glifo sai da largura, para a letra não sair esticada. */
const GLYPH_HEIGHT = ADVANCE * (CELL_H / CELL_W);

/** Floats por vértice (posição + uv) e vértices por glifo. */
const STRIDE = 5;
const VERTS_PER_GLYPH = 6;

/**
 * Teto de glifos desenhados num quadro: ~17 placas cheias. Placa cheia é rara;
 * quem construir um mural além disso vê as últimas placas em branco, que é
 * melhor do que o passe crescer sem limite.
 */
const MAX_GLYPHS = 1024;

/** Além disto o texto não é legível e só custa preenchimento. */
export const SIGN_TEXT_DISTANCE = 32;

/**
 * Cor da tinta: o marrom bem escuro que se lê sobre madeira clara.
 *
 * Exportada porque o teste mede o contraste dela contra a tábua da placa — foi
 * esse par que falhou em campo, e é ele que a régua tem de vigiar.
 */
export const SIGN_INK: readonly [number, number, number] = [0.13, 0.09, 0.05];

/**
 * Eixo horizontal do texto para cada `facing` da placa, e de que lado da tábua
 * ele fica.
 *
 * `facing` é a direção para onde o jogador olhava ao colocar (`facingFromYaw`),
 * então a face escrita é a **oposta**: ela olha de volta para quem plantou a
 * placa. Cada entrada é `[rightX, rightZ, normalX, normalZ]`.
 */
const FACING_AXES: readonly (readonly number[])[] = [
  [0, 1, -1, 0], // 0: jogador olhava +X — face para −X, texto corre para +Z
  [0, -1, 1, 0], // 1: jogador olhava −X — face para +X, texto corre para −Z
  [-1, 0, 0, -1], // 2: jogador olhava +Z — face para −Z, texto corre para −X
  [1, 0, 0, 1], // 3: jogador olhava −Z — face para +Z, texto corre para +X
];

/**
 * Escreve os quads de uma placa em `out`, a partir do float `at`.
 * Devolve o novo índice de escrita. Função pura: é ela que os testes medem.
 */
export function writeSignQuads(
  out: Float32Array, at: number, x: number, y: number, z: number,
  facing: number, lines: readonly string[],
): number {
  const axes = FACING_AXES[facing & 3];
  const rightX = axes[0];
  const rightZ = axes[1];
  const normalX = axes[2];
  const normalZ = axes[3];

  // O plano do texto: a face da tábua, deslocada para fora pela folga.
  const planeOffset = 0.5 + (PANE + LIFT) * (normalX !== 0 ? normalX : normalZ);
  let write = at;

  for (let line = 0; line < SIGN_LINES && line < lines.length; line++) {
    const text = lines[line];
    if (text.length === 0) continue;
    const columns = Math.min(text.length, SIGN_COLUMNS);
    // Centrado: placa com uma palavra curta não fica encostada na esquerda.
    const center = (AREA_LEFT + AREA_RIGHT) / 2;
    const start = center - (columns * ADVANCE) / 2;
    const rowCenter = AREA_TOP - ROW_HEIGHT * (line + 0.5);
    const y0 = y + rowCenter - GLYPH_HEIGHT / 2;
    const y1 = y0 + GLYPH_HEIGHT;

    for (let col = 0; col < columns; col++) {
      const cell = glyphCell(text[col]);
      if (cell <= 0) continue; // célula 0 é o espaço: nada a desenhar
      if (write + STRIDE * VERTS_PER_GLYPH > out.length) return write;

      const a0 = start + col * ADVANCE;
      const a1 = a0 + ADVANCE;
      const u0 = ((cell % FONT_COLUMNS) * CELL_W) / FONT_SIZE;
      const u1 = u0 + CELL_W / FONT_SIZE;
      const v0 = (Math.floor(cell / FONT_COLUMNS) * CELL_H) / FONT_SIZE;
      const v1 = v0 + CELL_H / FONT_SIZE;

      // A coordenada fixa é a do plano da tábua; a outra corre sobre o eixo
      // `right` da face, invertida quando ele aponta para o negativo.
      const forward = rightX > 0 || rightZ > 0;
      const h0 = forward ? a0 : 1 - a0;
      const h1 = forward ? a1 : 1 - a1;
      const alongX = rightX !== 0;
      const x0 = alongX ? x + h0 : x + planeOffset;
      const x1 = alongX ? x + h1 : x + planeOffset;
      const z0 = alongX ? z + planeOffset : z + h0;
      const z1 = alongX ? z + planeOffset : z + h1;

      write = vertex(out, write, x0, y1, z0, u0, v0);
      write = vertex(out, write, x0, y0, z0, u0, v1);
      write = vertex(out, write, x1, y0, z1, u1, v1);
      write = vertex(out, write, x0, y1, z0, u0, v0);
      write = vertex(out, write, x1, y0, z1, u1, v1);
      write = vertex(out, write, x1, y1, z1, u1, v0);
    }
  }
  return write;
}

function vertex(
  out: Float32Array, at: number, x: number, y: number, z: number, u: number, v: number,
): number {
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
  out[at + 3] = u;
  out[at + 4] = v;
  return at + STRIDE;
}

const UNIFORMS = ['uViewProj', 'uFont', 'uColor'] as const;

/** Passe do texto das placas. */
export class SignTextPass {
  private readonly ctx: GlContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly buffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly vertices = new Float32Array(MAX_GLYPHS * VERTS_PER_GLYPH * STRIDE);

  private write = 0;

  constructor(ctx: GlContext) {
    this.ctx = ctx;
    const gl = ctx.gl;
    const use300 = ctx.gl2 !== null;
    this.program = createProgram(
      gl, use300 ? SIGN_VS_300 : SIGN_VS_100, use300 ? SIGN_FS_300 : SIGN_FS_100, 'signtext',
    );
    this.uniforms = uniformLocations(gl, this.program, UNIFORMS);

    const buffer = gl.createBuffer();
    if (buffer === null) throw new Error('sem buffer para o texto de placa');
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);

    const texture = gl.createTexture();
    if (texture === null) throw new Error('sem textura de fonte');
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, FONT_SIZE, FONT_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      buildFontSheet(),
    );
    // Sem mipmap e sem filtro: o glifo é desenho de pixel, borrar é perdê-lo.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Começa um quadro: descarta o que foi montado no anterior. */
  begin(): void {
    this.write = 0;
  }

  /** Enfileira uma placa. Silenciosamente ignorada depois do teto de glifos. */
  add(x: number, y: number, z: number, facing: number, lines: readonly string[]): void {
    this.write = writeSignQuads(this.vertices, this.write, x, y, z, facing, lines);
  }

  /** Sobe o que foi enfileirado e desenha. Devolve as draw calls gastas. */
  flush(viewProj: Mat4): number {
    if (this.write === 0) return 0;
    const gl = this.ctx.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, this.write));

    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    const bytes = STRIDE * 4;
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, bytes, 12);

    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    gl.uniform3f(this.uniforms.uColor, SIGN_INK[0], SIGN_INK[1], SIGN_INK[2]);
    gl.uniform1i(this.uniforms.uFont, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // Dos dois lados: a placa já esconde o verso, e sem isso a face escrita
    // depende da ordem dos triângulos, que muda com o `facing`.
    const hadCull = gl.isEnabled(gl.CULL_FACE);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, this.write / STRIDE);
    if (hadCull) gl.enable(gl.CULL_FACE);

    gl.disableVertexAttribArray(1);
    return 1;
  }
}
