/**
 * Peças de circuito (M7) e de oficina (M15) em caixas: alavanca, botão,
 * repetidor, comparador, pistão, bigorna e funil, mais a codificação de
 * encaixe que alavanca, botão e pistão dividem.
 *
 * Saiu de `mesh/shapes.ts` no M24, que passava de 700 linhas. `shapes.ts`
 * re-exporta o que é público daqui e chama as formas pelo `boxesFor`.
 */

import { one } from './box';

/**
 * Encaixe de alavanca e botão, nos bits 0..2 do estado (M7).
 *
 * 0..3 = a parede em que está pendurado, nas direções de `FACING_STEP`;
 * 4 = no chão; 5 = no teto. É a mesma codificação que `world/redstone.ts` usa
 * para achar o bloco de apoio, e por isso vive aqui, ao lado da geometria que
 * depende dela.
 */
export const MOUNT_FLOOR = 4;
export const MOUNT_CEILING = 5;

/**
 * Direção do pistão nos bits 0..2: 0 = +X, 1 = −X, 2 = +Z, 3 = −Z, 4 = +Y,
 * 5 = −Y. Os quatro primeiros coincidem com `FACING_STEP` de propósito.
 */
export const PISTON_STEP: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0],
];

/** Encaixe cuja superfície fica na direção `dir` de `PISTON_STEP`. */
export function mountForDir(dir: number): number {
  if (dir < 4) return dir;
  return dir === 4 ? MOUNT_CEILING : MOUNT_FLOOR;
}

// --- redstone (M7) ---------------------------------------------------------

/**
 * Caixa descrita no referencial da **superfície de encaixe**: `u` e `v` correm
 * sobre a superfície, `w` é a distância a partir dela.
 *
 * É isso que permite alavanca e botão terem uma geometria só para os seis
 * encaixes possíveis, em vez de seis blocos de código quase iguais.
 */
export function mounted(
  out: Float32Array, index: number, mount: number,
  u0: number, v0: number, w0: number, u1: number, v1: number, w1: number,
): number {
  switch (mount) {
    case 0: return one(out, index, 1 - w1, v0, u0, 1 - w0, v1, u1); // parede +X
    case 1: return one(out, index, w0, v0, u0, w1, v1, u1);         // parede −X
    case 2: return one(out, index, u0, v0, 1 - w1, u1, v1, 1 - w0); // parede +Z
    case 3: return one(out, index, u0, v0, w0, u1, v1, w1);         // parede −Z
    case MOUNT_CEILING: return one(out, index, u0, 1 - w1, v0, u1, 1 - w0, v1);
    default: return one(out, index, u0, w0, v0, u1, w1, v1);        // chão
  }
}

/**
 * Alavanca: a base presa na superfície mais a haste, que muda de lado conforme
 * ligada. Não há giro de 45° — dois estados e a haste pula de um lado ao outro,
 * que é o que se enxerga a 16 px.
 */
export function lever(state: number, out: Float32Array): number {
  const mount = state & 7;
  const on = (state & 8) !== 0;
  let count = mounted(out, 0, mount, 5 / 16, 4 / 16, 0, 11 / 16, 12 / 16, 3 / 16);
  const v0 = on ? 3 / 16 : 9 / 16;
  count = mounted(out, count, mount, 7 / 16, v0, 2 / 16, 9 / 16, v0 + 4 / 16, 10 / 16);
  return count;
}

/** Botão: uma pastilha na superfície, mais rasa quando apertada. */
export function button(state: number, out: Float32Array): number {
  const mount = state & 7;
  const depth = (state & 8) !== 0 ? 1 / 16 : 2 / 16;
  return mounted(out, 0, mount, 5 / 16, 6 / 16, 0, 11 / 16, 10 / 16, depth);
}

/**
 * Repetidor: a base achatada mais duas tochinhas. A de trás anda para longe da
 * saída conforme o atraso (bits 2..3) — é assim que se lê o atraso sem HUD.
 */
export function repeater(state: number, out: Float32Array): number {
  let count = one(out, 0, 0, 0, 0, 1, 2 / 16, 1);
  const facing = state & 3;
  const delay = (state >> 2) & 3;
  count = torchNub(out, count, facing, 3 / 16);
  count = torchNub(out, count, facing, (7 + delay * 2) / 16);
  return count;
}

/**
 * Bigorna (M15): pé largo, cintura estreita e a mesa comprida. O comprimento
 * corre no eixo **perpendicular** ao olhar de quem a colocou, como no gênero:
 * o martelo bate de lado.
 */
export function anvil(facing: number, out: Float32Array): number {
  const alongX = facing >= 2; // olhando em Z, a mesa corre em X
  let count = one(out, 0, 2 / 16, 0, 2 / 16, 14 / 16, 4 / 16, 14 / 16);
  count = alongX
    ? one(out, count, 4 / 16, 4 / 16, 6 / 16, 12 / 16, 10 / 16, 10 / 16)
    : one(out, count, 6 / 16, 4 / 16, 4 / 16, 10 / 16, 10 / 16, 12 / 16);
  return alongX
    ? one(out, count, 0, 10 / 16, 3 / 16, 1, 1, 13 / 16)
    : one(out, count, 3 / 16, 10 / 16, 0, 13 / 16, 1, 1);
}

/**
 * Funil (M15): a tigela de cima, o corpo no meio e o bico. O bico aponta para
 * a saída — para baixo (5) ou para um dos lados (0..3, `PISTON_STEP`).
 */
export function hopper(output: number, out: Float32Array): number {
  let count = one(out, 0, 0, 10 / 16, 0, 1, 1, 1);
  count = one(out, count, 4 / 16, 4 / 16, 4 / 16, 12 / 16, 10 / 16, 12 / 16);
  switch (output) {
    case 0: return one(out, count, 12 / 16, 4 / 16, 6 / 16, 1, 8 / 16, 10 / 16);
    case 1: return one(out, count, 0, 4 / 16, 6 / 16, 4 / 16, 8 / 16, 10 / 16);
    case 2: return one(out, count, 6 / 16, 4 / 16, 12 / 16, 10 / 16, 8 / 16, 1);
    case 3: return one(out, count, 6 / 16, 4 / 16, 0, 10 / 16, 8 / 16, 4 / 16);
    default: return one(out, count, 6 / 16, 0, 6 / 16, 10 / 16, 4 / 16, 10 / 16);
  }
}

/** Comparador (M15): tampo, duas tochinhas atrás e a da frente. */
export function comparator(facing: number, out: Float32Array): number {
  let count = one(out, 0, 0, 0, 0, 1, 2 / 16, 1);
  count = torchNub(out, count, facing, 2 / 16);
  // As duas de trás ficam lado a lado, a 3/16 da face de trás.
  const back = 11 / 16;
  const y0 = 2 / 16;
  const y1 = 5 / 16;
  if (facing === 0 || facing === 1) {
    const x = facing === 0 ? 1 - back - 2 / 16 : back;
    count = one(out, count, x, y0, 3 / 16, x + 2 / 16, y1, 5 / 16);
    return one(out, count, x, y0, 11 / 16, x + 2 / 16, y1, 13 / 16);
  }
  const z = facing === 2 ? 1 - back - 2 / 16 : back;
  count = one(out, count, 3 / 16, y0, z, 5 / 16, y1, z + 2 / 16);
  return one(out, count, 11 / 16, y0, z, 13 / 16, y1, z + 2 / 16);
}

/** Tochinha do repetidor a `back` blocos da face de saída. */
function torchNub(
  out: Float32Array, index: number, facing: number, back: number,
): number {
  const y0 = 2 / 16;
  const y1 = 6 / 16;
  const a = 7 / 16;
  const b = 9 / 16;
  if (facing === 0) return one(out, index, 1 - back - 2 / 16, y0, a, 1 - back, y1, b);
  if (facing === 1) return one(out, index, back, y0, a, back + 2 / 16, y1, b);
  if (facing === 2) return one(out, index, a, y0, 1 - back - 2 / 16, b, y1, 1 - back);
  return one(out, index, a, y0, back, b, y1, back + 2 / 16);
}

/** Fundura do corpo do pistão medida a partir da face de trás. */
const PISTON_BODY = 12 / 16;

/**
 * Pistão: corpo de 12/16 mais a placa da frente.
 *
 * **Desvio consciente:** a textura é a mesma nas seis faces, porque o formato de
 * vértice não guarda rotação de textura (doc 01 §5.1). Quem diz para onde o
 * pistão aponta é a geometria — a placa da frente é levemente mais estreita que
 * o corpo, e o degrau entre as duas se vê de qualquer ângulo.
 */
export function piston(state: number, out: Float32Array): number {
  const dir = state & 7;
  const extended = (state & 8) !== 0;
  const mount = mountForDir(dir ^ 1);
  let count = mounted(out, 0, mount, 0, 0, 0, 1, 1, PISTON_BODY);
  if (!extended) {
    count = mounted(out, count, mount, 1 / 16, 1 / 16, PISTON_BODY, 15 / 16, 15 / 16, 1);
  }
  return count;
}

/** Braço do pistão: a haste que sai do corpo mais a placa da ponta. */
export function pistonHead(state: number, out: Float32Array): number {
  const dir = state & 7;
  const mount = mountForDir(dir ^ 1);
  let count = mounted(out, 0, mount, 6 / 16, 6 / 16, 0, 10 / 16, 10 / 16, PISTON_BODY);
  count = mounted(out, count, mount, 0, 0, PISTON_BODY, 1, 1, 1);
  return count;
}
