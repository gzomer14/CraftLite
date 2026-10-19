/**
 * Geometria dos blocos de casa do M26: fogueira, caldeirão, lanterna, vaso e
 * moldura de item. Fica fora de `shapes.ts` pelo tamanho daquele módulo, como
 * as máquinas da oficina em `machineshape.ts`.
 *
 * As caixas daqui alimentam o desenho **e** a colisão, como todas as outras.
 * O que não é caixa — a chama da fogueira, a planta do vaso e a água do
 * caldeirão — é desenhado por `mesh/complex.ts`, com as medidas exportadas
 * aqui para as duas pontas não divergirem.
 */

import { one } from './box';
import { MOUNT_CEILING } from './machineshape';

const S = 1 / 16;

/**
 * Fogueira: duas toras ao longo de X embaixo, duas ao longo de Z por cima, e
 * a cama de brasa no meio. A tora de cima apoia na de baixo (3/16), que é o
 * que faz a pilha parecer empilhada e não quatro caixas encostadas.
 */
export function campfire(out: Float32Array): number {
  let count = one(out, 0, 0, 0, 1 * S, 1, 4 * S, 5 * S);
  count = one(out, count, 0, 0, 11 * S, 1, 4 * S, 15 * S);
  count = one(out, count, 1 * S, 3 * S, 0, 5 * S, 7 * S, 1);
  count = one(out, count, 11 * S, 3 * S, 0, 15 * S, 7 * S, 1);
  return one(out, count, 5 * S, 0, 5 * S, 11 * S, 1 * S, 11 * S);
}

/** Onde a chama da fogueira começa e quanto ela recua das bordas. */
export const CAMPFIRE_FLAME_Y = 1 * S;
export const CAMPFIRE_FLAME_INSET = 2 * S;

/**
 * Caldeirão: o fundo e as quatro paredes de 2/16. As paredes descem até o
 * chão — a perna do gênero não cabe nas cinco caixas, e de pé ninguém vê o
 * vão debaixo do fundo.
 */
export function cauldron(out: Float32Array): number {
  let count = one(out, 0, 2 * S, 3 * S, 2 * S, 14 * S, 4 * S, 14 * S);
  count = one(out, count, 0, 0, 0, 2 * S, 1, 1);
  count = one(out, count, 14 * S, 0, 0, 1, 1, 1);
  count = one(out, count, 2 * S, 0, 0, 14 * S, 1, 2 * S);
  return one(out, count, 2 * S, 0, 14 * S, 14 * S, 1, 1);
}

/** Altura da água por nível (0 = seco), e a borda de dentro das paredes. */
export const CAULDRON_WATER_Y: readonly number[] = [0, 9 * S, 12 * S, 15 * S];
export const CAULDRON_INNER = 2 * S;

/** Nível de água do caldeirão, nos bits 0..1 do estado. */
export function cauldronLevel(bits: number): number {
  return bits & 3;
}

/**
 * Lanterna: corpo, tampa e alça — no chão — ou corpo, tampa e a corrente até
 * o teto, pendurada (`MOUNT_CEILING` nos bits 0..2).
 */
export function lantern(state: number, out: Float32Array): number {
  if ((state & 7) === MOUNT_CEILING) {
    let count = one(out, 0, 5 * S, 1 * S, 5 * S, 11 * S, 8 * S, 11 * S);
    count = one(out, count, 6 * S, 8 * S, 6 * S, 10 * S, 10 * S, 10 * S);
    return one(out, count, 7 * S, 10 * S, 7 * S, 9 * S, 1, 9 * S);
  }
  let count = one(out, 0, 5 * S, 0, 5 * S, 11 * S, 7 * S, 11 * S);
  count = one(out, count, 6 * S, 7 * S, 6 * S, 10 * S, 9 * S, 10 * S);
  return one(out, count, 7 * S, 9 * S, 7 * S, 9 * S, 11 * S, 9 * S);
}

/** Vaso: um cilindro de barro que, em caixa, é um cubo baixo de 6/16. */
export function flowerPot(out: Float32Array): number {
  return one(out, 0, 5 * S, 0, 5 * S, 11 * S, POT_TOP, 11 * S);
}

/** Boca do vaso: a planta nasce daqui, um pouco afundada na terra. */
export const POT_TOP = 6 * S;
export const POT_PLANT_Y = 4 * S;
export const POT_PLANT_INSET = 3 * S;

/**
 * Moldura de item: uma chapa de 1/16 colada na parede dos bits 0..1, 12/16
 * de lado. O item que ela segura é desenhado pelo passe dos itens do chão
 * (`render/scenefeed.ts`), na frente da chapa.
 */
export function itemFrame(state: number, out: Float32Array): number {
  const a = 2 * S;
  const b = 14 * S;
  switch (state & 3) {
    case 0: return one(out, 0, 1 - FRAME_DEPTH, a, a, 1, b, b);
    case 1: return one(out, 0, 0, a, a, FRAME_DEPTH, b, b);
    case 2: return one(out, 0, a, a, 1 - FRAME_DEPTH, b, b, 1);
    default: return one(out, 0, a, a, 0, b, b, FRAME_DEPTH);
  }
}

/** Espessura da moldura: o item fica logo à frente dela. */
export const FRAME_DEPTH = 1 * S;
