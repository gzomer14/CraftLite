/**
 * Geometria dos blocos que não são cubo, como **listas de caixas** (doc 04 §3).
 *
 * Toda forma fora do cubo e da cruz vira uma ou mais caixas alinhadas aos
 * eixos: laje é uma, escada são duas, cerca é um poste mais um braço por
 * vizinho conectado, alçapão é uma caixa fina que muda de lugar conforme
 * aberto/fechado. Descrever isso como dado — uma caixa é seis números — em vez
 * de seis funções de emissão é o que permite acrescentar forma nova sem tocar
 * no mesher.
 *
 * Fica separado de `complex.ts` porque são duas responsabilidades diferentes:
 * aqui se decide **qual é a forma**, lá se decide **como emitir os quads e
 * quais faces o vizinho esconde**.
 *
 * As mesmas caixas alimentam a colisão em `world/physics.ts`: se o desenho e a
 * colisão viessem de tabelas diferentes, elas divergiriam na primeira forma
 * nova — e o jogador atravessaria a escada que enxerga.
 */

/** Uma caixa por 6 números: x0, y0, z0, x1, y1, z1, em fração de bloco. */
export const BOX_STRIDE = 6;
/** Nenhuma forma passa de 5 caixas (a cerca com os 4 braços). */
export const MAX_BOXES = 5;

/** Formas com geometria de caixa, na ordem em que `blockinfo.ts` as indexa. */
export const SHAPE_NONE = 0;
export const SHAPE_CROSS = 1;
export const SHAPE_SLAB = 2;
export const SHAPE_CARPET = 3;
export const SHAPE_FLAT = 4;
export const SHAPE_STAIRS = 5;
export const SHAPE_FENCE = 6;
export const SHAPE_FENCE_GATE = 7;
export const SHAPE_TRAPDOOR = 8;
export const SHAPE_DOOR = 9;
export const SHAPE_PANE = 10;
export const SHAPE_LADDER = 11;
export const SHAPE_SIGN = 12;
export const SHAPE_PAINTING = 13;

/** Espessura de tudo que é "chapa": alçapão, porta, placa, quadro, escada de mão. */
const THIN = 3 / 16;
/** Meia altura de laje e do degrau da escada. */
const HALF = 0.5;
/** Altura do trilho e afins. */
const FLAT_HEIGHT = 1 / 16;
/** Meia largura do poste da cerca. */
const POST = 2 / 16;
/** Meia largura do poste da grade de vidro. */
const PANE = 1 / 16;

/** `SHAPE_*` de cada `shape` da tabela de blocos. Fonte única: o mesher e a
 * física leem daqui, então desenho e colisão nunca divergem. */
export const SHAPE_BY_NAME: Readonly<Record<string, number>> = {
  cross: SHAPE_CROSS,
  torch: SHAPE_CROSS,
  slab: SHAPE_SLAB,
  carpet: SHAPE_CARPET,
  flat: SHAPE_FLAT,
  stairs: SHAPE_STAIRS,
  fence: SHAPE_FENCE,
  fence_gate: SHAPE_FENCE_GATE,
  trapdoor: SHAPE_TRAPDOOR,
  door: SHAPE_DOOR,
  pane: SHAPE_PANE,
  ladder: SHAPE_LADDER,
  sign: SHAPE_SIGN,
  painting: SHAPE_PAINTING,
};

/** Altura da colisão de cerca e portão fechado (doc 04 §3). */
export const FENCE_COLLISION_HEIGHT = 1.5;

/**
 * Caixas de **colisão** de uma forma.
 *
 * Iguais às do desenho, com duas exceções vindas do doc 04 §3: cerca e portão
 * fechado colidem como um bloco inteiro de 1,5 de altura — é o que impede
 * pular a cerca —, e portão aberto não colide com nada.
 */
export function collisionBoxesFor(shape: number, state: number, out: Float32Array): number {
  if (shape === SHAPE_FENCE) {
    return one(out, 0, 0, 0, 0, 1, FENCE_COLLISION_HEIGHT, 1);
  }
  if (shape === SHAPE_FENCE_GATE) {
    if ((state & 4) !== 0) return 0;
    return one(out, 0, 0, 0, 0, 1, FENCE_COLLISION_HEIGHT, 1);
  }
  return boxesFor(shape, state, 0, out);
}

/**
 * Direção que os 2 bits baixos do estado codificam.
 * 0 = +X (leste), 1 = −X (oeste), 2 = +Z (sul), 3 = −Z (norte).
 */
export const FACING_STEP: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/**
 * Preenche `out` com as caixas da forma e devolve **quantas** escreveu.
 *
 * `connections` é a máscara de vizinhos conectados, nos mesmos bits de
 * `FACING_STEP` (bit 0 = +X, 1 = −X, 2 = +Z, 3 = −Z). Só cerca e grade a usam;
 * é o mesher que a calcula, porque ela **não** ocupa bits do save (doc 04 §2.5).
 */
export function boxesFor(
  shape: number, state: number, connections: number, out: Float32Array,
): number {
  switch (shape) {
    case SHAPE_SLAB:
      // bit 0 = metade de cima.
      return one(out, 0, 0, (state & 1) === 0 ? 0 : HALF, 0, 1, (state & 1) === 0 ? HALF : 1, 1);
    case SHAPE_CARPET:
      // A camada de neve guarda a altura 0..7 no estado.
      return one(out, 0, 0, 0, 0, 1, ((state & 7) + 1) / 8, 1);
    case SHAPE_FLAT:
      return one(out, 0, 0, 0, 0, 1, FLAT_HEIGHT, 1);
    case SHAPE_STAIRS:
      return stairs(state, out);
    case SHAPE_FENCE:
      return connected(out, POST, 1, connections);
    case SHAPE_PANE:
      return connected(out, PANE, 1, connections);
    case SHAPE_FENCE_GATE:
      return fenceGate(state, out);
    case SHAPE_TRAPDOOR:
      return trapdoor(state, out);
    case SHAPE_DOOR:
      return door(state, out);
    case SHAPE_LADDER:
      return wallPlate(state & 3, out, 0, 1);
    case SHAPE_SIGN:
      return sign(state, out);
    case SHAPE_PAINTING:
      return wallPlate(state & 3, out, 1 / 16, 15 / 16);
    default:
      return 0;
  }
}

/** Escreve uma caixa em `out[i]` e devolve `i + 1` como contagem. */
function one(
  out: Float32Array, index: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): number {
  const o = index * BOX_STRIDE;
  out[o] = x0; out[o + 1] = y0; out[o + 2] = z0;
  out[o + 3] = x1; out[o + 4] = y1; out[o + 5] = z1;
  return index + 1;
}

/**
 * Escada: a base de meio bloco mais o degrau encostado na parede de trás.
 *
 * bits 0–1 = para onde a **subida** aponta, bit 2 = de cabeça para baixo. Não
 * há variante de canto: no orçamento de T0, dobrar a geometria da escada para
 * arredondar quina custa mais do que o olho ganha.
 */
function stairs(state: number, out: Float32Array): number {
  const top = (state & 4) !== 0;
  const baseY0 = top ? HALF : 0;
  let count = one(out, 0, 0, baseY0, 0, 1, baseY0 + HALF, 1);

  const stepY0 = top ? 0 : HALF;
  const facing = state & 3;
  if (facing === 0) count = one(out, count, 0, stepY0, 0, HALF, stepY0 + HALF, 1);
  else if (facing === 1) count = one(out, count, HALF, stepY0, 0, 1, stepY0 + HALF, 1);
  else if (facing === 2) count = one(out, count, 0, stepY0, 0, 1, stepY0 + HALF, HALF);
  else count = one(out, count, 0, stepY0, HALF, 1, stepY0 + HALF, 1);
  return count;
}

/** Poste central mais um braço por vizinho conectado (cerca e grade). */
function connected(out: Float32Array, half: number, height: number, connections: number): number {
  let count = one(out, 0, 0.5 - half, 0, 0.5 - half, 0.5 + half, height, 0.5 + half);
  // Braço fino, na altura de cima, indo do poste até a face do bloco.
  const armY0 = height * 0.35;
  const armY1 = height * 0.85;
  if ((connections & 1) !== 0) {
    count = one(out, count, 0.5 + half, armY0, 0.5 - half, 1, armY1, 0.5 + half);
  }
  if ((connections & 2) !== 0) {
    count = one(out, count, 0, armY0, 0.5 - half, 0.5 - half, armY1, 0.5 + half);
  }
  if ((connections & 4) !== 0) {
    count = one(out, count, 0.5 - half, armY0, 0.5 + half, 0.5 + half, armY1, 1);
  }
  if ((connections & 8) !== 0) {
    count = one(out, count, 0.5 - half, armY0, 0, 0.5 + half, armY1, 0.5 - half);
  }
  return count;
}

/**
 * Portão: dois postes nas laterais e a travessa no meio.
 * bits 0–1 = eixo da travessa, bit 2 = aberto (a travessa some).
 */
function fenceGate(state: number, out: Float32Array): number {
  const open = (state & 4) !== 0;
  const alongX = (state & 3) < 2;
  const y0 = 5 / 16;
  const y1 = 1;

  if (alongX) {
    let count = one(out, 0, 0, y0, 0.5 - POST, POST * 2, y1, 0.5 + POST);
    count = one(out, count, 1 - POST * 2, y0, 0.5 - POST, 1, y1, 0.5 + POST);
    if (!open) count = one(out, count, POST * 2, 0.5, 0.5 - PANE, 1 - POST * 2, 0.9, 0.5 + PANE);
    return count;
  }
  let count = one(out, 0, 0.5 - POST, y0, 0, 0.5 + POST, y1, POST * 2);
  count = one(out, count, 0.5 - POST, y0, 1 - POST * 2, 0.5 + POST, y1, 1);
  if (!open) count = one(out, count, 0.5 - PANE, 0.5, POST * 2, 0.5 + PANE, 0.9, 1 - POST * 2);
  return count;
}

/**
 * Alçapão: chapa fina deitada quando fechado, em pé contra a parede quando
 * aberto. bits 0–1 = a parede em que a dobradiça está, bit 2 = metade de cima,
 * bit 3 = aberto.
 */
function trapdoor(state: number, out: Float32Array): number {
  if ((state & 8) === 0) {
    const y0 = (state & 4) !== 0 ? 1 - THIN : 0;
    return one(out, 0, 0, y0, 0, 1, y0 + THIN, 1);
  }
  return wallPlate(state & 3, out, 0, 1);
}

/**
 * Porta: chapa fina de um bloco de altura, encostada na face de `facing`.
 * Abrir gira 90°, o que aqui é encostar na parede vizinha no sentido horário.
 */
function door(state: number, out: Float32Array): number {
  const facing = state & 3;
  const open = (state & 4) !== 0;
  return wallPlate(open ? ROTATE_CW[facing] : facing, out, 0, 1);
}

/** Direção 90° no sentido horário, para a porta aberta. */
const ROTATE_CW: readonly number[] = [2, 3, 1, 0];

/**
 * Placa: poste central baixo mais a tábua na altura dos olhos.
 * bits 0–1 = para onde a face escrita aponta.
 */
function sign(state: number, out: Float32Array): number {
  let count = one(out, 0, 0.5 - PANE, 0, 0.5 - PANE, 0.5 + PANE, 0.5, 0.5 + PANE);
  const facing = state & 3;
  if (facing < 2) count = one(out, count, 0.5 - PANE, 0.5, 1 / 8, 0.5 + PANE, 1, 7 / 8);
  else count = one(out, count, 1 / 8, 0.5, 0.5 - PANE, 7 / 8, 1, 0.5 + PANE);
  return count;
}

/**
 * Chapa fina colada na parede indicada, entre as alturas `y0` e `y1`.
 * `facing` é a direção em que a parede está, nos bits de `FACING_STEP`.
 */
function wallPlate(facing: number, out: Float32Array, y0: number, y1: number): number {
  if (facing === 0) return one(out, 0, 1 - THIN, y0, 0, 1, y1, 1);
  if (facing === 1) return one(out, 0, 0, y0, 0, THIN, y1, 1);
  if (facing === 2) return one(out, 0, 0, y0, 1 - THIN, 1, y1, 1);
  return one(out, 0, 0, y0, 0, 1, y1, THIN);
}
