/**
 * Geometria e cantos da escada (doc 04 §3).
 *
 * Saiu de `mesh/shapes.ts` no M24, com a correção de canto e a quina de três
 * do M23. `shapes.ts` re-exporta o que é público daqui.
 */

import { one } from './box';

/** Meia altura: o degrau. */
const HALF = 0.5;

/**
 * Escada, com as variantes de canto (doc 04 §3).
 *
 * bits 0–1 = para onde a **subida** aponta, bit 2 = de cabeça para baixo. O
 * **lado alto** — a metade em que fica o degrau — é `bits ^ 1` nos índices de
 * `FACING_STEP`, e é em torno dele que toda a geometria é descrita.
 *
 * `corner` vem de `stairCornerFrom` e **não ocupa bit nenhum do save**: ele é
 * derivado dos vizinhos na hora, como a conexão de cerca (doc 04 §2.5). Um save
 * feito antes dos cantos abre mostrando os cantos, sem migração.
 *
 * Três formas:
 * - **reta**: base de meia altura + meia caixa no lado alto;
 * - **canto externo**: a meia caixa vira um **quarto** — a interseção do lado
 *   alto com o lado alto do vizinho perpendicular;
 * - **canto interno**: a meia caixa mais o quarto que falta para fechar o L.
 */
export function stairs(state: number, corner: number, out: Float32Array): number {
  const top = (state & 4) !== 0;
  const baseY0 = top ? HALF : 0;
  let count = one(out, 0, 0, baseY0, 0, 1, baseY0 + HALF, 1);

  const y0 = top ? 0 : HALF;
  const y1 = y0 + HALF;
  const tall = (state & 3) ^ 1;
  const kind = corner & 3;

  if (kind === CORNER_NONE) {
    count = halfBox(out, count, tall, y0, y1);
    return count;
  }

  const quarter = (corner >>> 2) & 3;
  if (kind === CORNER_OUTER) {
    // Só a interseção das duas metades altas sobrevive.
    return quarterBox(out, count, tall, quarter, y0, y1);
  }
  // Interno: a metade alta inteira mais o quarto que fecha a curva.
  count = halfBox(out, count, tall, y0, y1);
  return quarterBox(out, count, tall ^ 1, quarter, y0, y1);
}

/** Meia caixa no lado `dir` de `FACING_STEP`, entre `y0` e `y1`. */
function halfBox(out: Float32Array, index: number, dir: number, y0: number, y1: number): number {
  if (dir === 0) return one(out, index, HALF, y0, 0, 1, y1, 1);
  if (dir === 1) return one(out, index, 0, y0, 0, HALF, y1, 1);
  if (dir === 2) return one(out, index, 0, y0, HALF, 1, y1, 1);
  return one(out, index, 0, y0, 0, 1, y1, HALF);
}

/** Um quarto: a interseção das metades `a` e `b`, que são de eixos diferentes. */
function quarterBox(
  out: Float32Array, index: number, a: number, b: number, y0: number, y1: number,
): number {
  // `a` é sempre do eixo X e `b` do eixo Z, ou o contrário; normaliza.
  const xDir = a < 2 ? a : b;
  const zDir = a < 2 ? b : a;
  const x0 = xDir === 0 ? HALF : 0;
  const x1 = xDir === 0 ? 1 : HALF;
  const z0 = zDir === 2 ? HALF : 0;
  const z1 = zDir === 2 ? 1 : HALF;
  return one(out, index, x0, y0, z0, x1, y1, z1);
}

/** Formas de canto, nos bits 0–1 de `corner`. */
export const CORNER_NONE = 0;
export const CORNER_OUTER = 1;
export const CORNER_INNER = 2;

/** Vizinho que não é escada, para `stairCornerFrom`. */
export const NOT_STAIRS = -1;

/**
 * Forma de canto de uma escada, a partir dos bits dos quatro vizinhos.
 *
 * Cada `nb*` é o estado da escada vizinha naquele lado, ou `NOT_STAIRS`. A
 * regra sai de uma exigência só, geométrica e verificável: **a superfície alta
 * das duas escadas tem que ser contínua pela face que elas dividem** — dos dois
 * lados da face, a parte alta cobre a mesma faixa.
 *
 *  - vizinho perpendicular **do lado alto** → canto **externo**: a metade alta
 *    encolhe para o quarto que encosta na faixa alta dele;
 *  - vizinho perpendicular **do lado aberto** → canto **interno**: a escada
 *    ganha, no lado aberto, o quarto que encosta na faixa alta dele.
 *
 * Nos dois casos quem escolhe o quarto é o **lado alto do vizinho**. O externo
 * vem primeiro e vence, como no gênero.
 *
 * **M23 — a regra estava trocada** desde o acabamento pós-M7: o vizinho do lado
 * alto fazia canto interno, e o teste só olhava o nosso lado da face. Num
 * telhado em pirâmide, as quinas saíam com o degrau cheio em vez do quarto. E
 * faltava a **quina de três**: a escada não vira canto se, do lado para onde a
 * curva iria, há outra escada igual a ela — ela continua a fila reta, em vez de
 * quebrá-la (o `canTakeShape` do gênero).
 *
 * Vizinho com o bit de "de cabeça para baixo" diferente não faz canto: as duas
 * metades altas estão em alturas diferentes e não há superfície para ligar.
 * Sem alocação: roda por escada no mesher.
 */
export function stairCornerFrom(
  bits: number, nbPlusX: number, nbMinusX: number, nbPlusZ: number, nbMinusZ: number,
): number {
  const tall = (bits & 3) ^ 1;
  const open = tall ^ 1;
  const top = bits & 4;

  const back = neighborAt(tall, nbPlusX, nbMinusX, nbPlusZ, nbMinusZ);
  if (isPerpendicularStair(back, tall, top)) {
    const backTall = (back & 3) ^ 1;
    // A curva sai para o lado baixo do vizinho; lá não pode haver uma igual a nós.
    const side = neighborAt(backTall ^ 1, nbPlusX, nbMinusX, nbPlusZ, nbMinusZ);
    if (!isSameStair(side, bits)) return CORNER_OUTER | (backTall << 2);
  }
  const front = neighborAt(open, nbPlusX, nbMinusX, nbPlusZ, nbMinusZ);
  if (isPerpendicularStair(front, tall, top)) {
    const frontTall = (front & 3) ^ 1;
    const side = neighborAt(frontTall, nbPlusX, nbMinusX, nbPlusZ, nbMinusZ);
    if (!isSameStair(side, bits)) return CORNER_INNER | (frontTall << 2);
  }
  return CORNER_NONE;
}

/** O vizinho no índice `dir` de `FACING_STEP`. */
function neighborAt(dir: number, px: number, mx: number, pz: number, mz: number): number {
  return dir === 0 ? px : dir === 1 ? mx : dir === 2 ? pz : mz;
}

/** true se o vizinho é escada virada para o mesmo lado e na mesma metade. */
function isSameStair(nb: number, bits: number): boolean {
  return nb !== NOT_STAIRS && (nb & 7) === (bits & 7);
}

/** true se o vizinho é escada, do mesmo lado de cima e de eixo perpendicular. */
function isPerpendicularStair(nb: number, tall: number, top: number): boolean {
  if (nb === NOT_STAIRS) return false;
  if ((nb & 4) !== top) return false;
  // Eixo: 0/1 são X, 2/3 são Z. Perpendicular = eixos diferentes.
  return ((nb & 3) >> 1) !== (tall >> 1);
}
