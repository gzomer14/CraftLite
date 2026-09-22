/**
 * Cores de tint do terreno: o multiplicador que o shader aplica sobre a
 * textura (doc 03 §4.3 para grama, folha e água; M13 para os corantes).
 *
 * O vértice guarda só o **índice** (6 bits, `render/vertex.ts`) e o shader lê
 * a cor numa tabela uniforme montada daqui. Os quatro primeiros são os de
 * sempre; do quinto em diante, um por cor de `data/dyes.ts` — é o que deixa a
 * lã e a cama de dezesseis cores saírem de **um** desenho cinza cada.
 */

import { DYES, DYE_BY_NAME, type DyeDef } from './dyes';
import type { BlockDef } from './blocks';

export const TINT_NONE = 0;
export const TINT_GRASS = 1;
export const TINT_FOLIAGE = 2;
export const TINT_WATER = 3;
/** Índice do primeiro corante: `TINT_DYE_BASE + posição em DYES`. */
export const TINT_DYE_BASE = 4;
/** Teto do campo de tint no vértice (6 bits). */
export const MAX_TINTS = 64;
/** Quantas entradas a tabela tem de fato. */
export const TINT_COUNT = TINT_DYE_BASE + DYES.length;

/**
 * Tint de corante sobre o desenho cinza. O branco da lã base é ~233, então a
 * cor alvo dividida por ele devolve a lã daquela cor sem clarear nem escurecer.
 */
const DYE_BASE = 233;

function dyeTint(dye: DyeDef): [number, number, number] {
  return [
    Math.min(1, dye.wool[0] / DYE_BASE),
    Math.min(1, dye.wool[1] / DYE_BASE),
    Math.min(1, dye.wool[2] / DYE_BASE),
  ];
}

/** A tabela, `TINT_COUNT` × RGB em 0..1, pronta para `uniform3fv`. */
export const TINT_COLORS: Float32Array = (() => {
  const out = new Float32Array(TINT_COUNT * 3);
  const fixed: readonly (readonly [number, number, number])[] = [
    [1, 1, 1],
    [0.475, 0.753, 0.353],
    [0.349, 0.682, 0.188],
    [0.247, 0.463, 0.894],
  ];
  fixed.forEach((c, i) => out.set(c, i * 3));
  DYES.forEach((dye, i) => out.set(dyeTint(dye), (TINT_DYE_BASE + i) * 3));
  return out;
})();

if (TINT_COUNT > MAX_TINTS) throw new Error(`Tints demais: ${TINT_COUNT} > ${MAX_TINTS}`);

/** Índice de tint do bloco, para o vértice. */
export function tintIndexOf(def: BlockDef): number {
  if (def.dye !== null) {
    const index = DYES.findIndex((d) => d.name === def.dye);
    return index < 0 ? TINT_NONE : TINT_DYE_BASE + index;
  }
  return def.tint === 'grass' ? TINT_GRASS
    : def.tint === 'foliage' ? TINT_FOLIAGE
      : def.tint === 'water' ? TINT_WATER : TINT_NONE;
}

/** Cor do corante do bloco em 0..255, ou `null` — para quem pinta na CPU. */
export function dyeRgbOf(def: BlockDef): [number, number, number] | null {
  if (def.dye === null) return null;
  const dye = DYE_BY_NAME.get(def.dye);
  if (dye === undefined) return null;
  const t = dyeTint(dye);
  return [Math.round(t[0] * 255), Math.round(t[1] * 255), Math.round(t[2] * 255)];
}
