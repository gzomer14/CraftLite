/**
 * Folha de glifos da fonte do mundo, gerada por código (doc 13 §1).
 *
 * Saída: RGBA de 128×128, branco opaco onde há tinta e alfa zero no resto. A
 * cor sai do shader, não daqui — a mesma folha serve para o texto escuro de uma
 * placa de carvalho e para um texto claro sobre madeira escura, e guardar duas
 * versões seria guardar a mesma informação duas vezes.
 *
 * 64 KB de textura, construída uma vez no boot.
 */

import {
  CELL_H, CELL_W, FONT_CHARS, FONT_COLUMNS, FONT_SIZE, GLYPH_H, GLYPH_W, GLYPH_X, GLYPH_Y,
  MARK_BOTTOM_Y, MARK_TOP_Y, glyphOf,
} from '../data/font';

/** Desenha a folha inteira. */
export function buildFontSheet(): Uint8Array {
  const data = new Uint8Array(FONT_SIZE * FONT_SIZE * 4);
  for (let cell = 0; cell < FONT_CHARS.length; cell++) {
    const cx = (cell % FONT_COLUMNS) * CELL_W;
    const cy = Math.floor(cell / FONT_COLUMNS) * CELL_H;
    const glyph = glyphOf(FONT_CHARS[cell]);
    blit(data, cx + GLYPH_X, cy + GLYPH_Y, glyph.rows, GLYPH_H);
    if (glyph.mark !== null) {
      blit(data, cx + GLYPH_X, cy + (glyph.markBelow ? MARK_BOTTOM_Y : MARK_TOP_Y), glyph.mark, 2);
    }
  }
  return data;
}

/** Escreve `rows` (cinco bits por linha, bit 4 à esquerda) na folha. */
function blit(
  data: Uint8Array, x0: number, y0: number, rows: readonly number[], count: number,
): void {
  for (let row = 0; row < count; row++) {
    const bits = rows[row];
    if (bits === 0) continue;
    for (let col = 0; col < GLYPH_W; col++) {
      if ((bits & (1 << (GLYPH_W - 1 - col))) === 0) continue;
      const o = ((y0 + row) * FONT_SIZE + x0 + col) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = 255;
    }
  }
}
