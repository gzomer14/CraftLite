/**
 * A caixa, unidade de geometria das formas de bloco (doc 04 §3), e o jeito de
 * escrevê-la. Saiu de `mesh/shapes.ts` no M24 para a escada (`stairshape.ts`)
 * usar sem importar o módulo que a importa.
 */

/** Uma caixa por 6 números: x0, y0, z0, x1, y1, z1, em fração de bloco. */
export const BOX_STRIDE = 6;
/** Nenhuma forma passa de 5 caixas (a cerca com os 4 braços). */
export const MAX_BOXES = 5;

/** Formas com geometria de caixa, na ordem em que `blockinfo.ts` as indexa. */

/** Escreve uma caixa em `out[i]` e devolve `i + 1` como contagem. */
export function one(
  out: Float32Array, index: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): number {
  const o = index * BOX_STRIDE;
  out[o] = x0; out[o + 1] = y0; out[o + 2] = z0;
  out[o + 3] = x1; out[o + 4] = y1; out[o + 5] = z1;
  return index + 1;
}
