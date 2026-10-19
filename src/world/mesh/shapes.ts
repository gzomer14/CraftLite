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

import { BOX_STRIDE, MAX_BOXES, one } from './box';
import { CORNER_NONE, stairs } from './stairshape';
import {
  MOUNT_FLOOR, anvil, button, comparator, hopper, lever, mounted, piston, pistonHead, repeater,
} from './machineshape';
import { campfire, cauldron, flowerPot, itemFrame, lantern } from './cozyshape';

/*
 * M24: trilho, escada e a caixa em si saíram para módulos próprios; daqui eles
 * são re-exportados para nenhum importador precisar mudar.
 */
export { BOX_STRIDE, MAX_BOXES } from './box';
export { CORNER_INNER, CORNER_NONE, CORNER_OUTER, NOT_STAIRS, stairCornerFrom } from './stairshape';
export * from './railshape';
export { MOUNT_CEILING, MOUNT_FLOOR, PISTON_STEP, mountForDir } from './machineshape';

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
export const SHAPE_LEVER = 14;
export const SHAPE_BUTTON = 15;
export const SHAPE_PLATE = 16;
export const SHAPE_REPEATER = 17;
export const SHAPE_PISTON = 18;
export const SHAPE_PISTON_HEAD = 19;
export const SHAPE_RAIL = 20;
/** Poste fino de pé, no chão ou inclinado na parede: a tocha (doc 04 §3). */
export const SHAPE_TORCH = 21;
/** Colchão com pés: metade da cama (doc 04 §3). */
export const SHAPE_BED = 22;
/** Caixa com tampa e tranca: o baú (doc 04 §3). */
export const SHAPE_CHEST = 23;
/** Bolo (2026-09-22): as fatias comidas, 0..6, nos bits 0..2 do estado. */
export const SHAPE_CAKE = 24;
/** Fatias que o bolo tem; comer a última some com ele. */
export const CAKE_SLICES = 7;
/** Sino pendurado (M9): coroa presa no teto, corpo e boca. */
export const SHAPE_BELL = 25;
/** Bigorna (M15): pé, cintura e mesa, a mesa no eixo dos bits 0..1. */
export const SHAPE_ANVIL = 26;
/** Funil (M15): tigela, corpo e o bico para a saída dos bits 0..2. */
export const SHAPE_HOPPER = 27;
/** Comparador (M15): o tampo do repetidor com três tochinhas. */
export const SHAPE_COMPARATOR = 28;
/** Suporte de preparo (M16): a base, a haste e a travessa dos frascos. */
export const SHAPE_BREWING_STAND = 29;
/** Moldura do portal do End (M16), sem olho e com. */
export const SHAPE_PORTAL_FRAME = 30;
export const SHAPE_PORTAL_FRAME_EYE = 31;
/** Placa do portal do End (M16): fina, a 3/4 da altura, como a água parada. */
export const SHAPE_PORTAL_PLANE = 32;
/** Ovo do dragão (M16): quatro fatias que afinam para cima. */
export const SHAPE_EGG = 33;
/** Aconchego (M26): ver `cozyshape.ts`. */
export const SHAPE_CAMPFIRE = 34;
export const SHAPE_CAULDRON = 35;
export const SHAPE_LANTERN = 36;
export const SHAPE_FLOWER_POT = 37;
export const SHAPE_ITEM_FRAME = 38;

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
  torch: SHAPE_TORCH,
  bed: SHAPE_BED,
  chest: SHAPE_CHEST,
  cake: SHAPE_CAKE,
  bell: SHAPE_BELL,
  anvil: SHAPE_ANVIL,
  hopper: SHAPE_HOPPER,
  comparator: SHAPE_COMPARATOR,
  brewing_stand: SHAPE_BREWING_STAND,
  portal_frame: SHAPE_PORTAL_FRAME,
  portal_frame_eye: SHAPE_PORTAL_FRAME_EYE,
  portal_plane: SHAPE_PORTAL_PLANE,
  egg: SHAPE_EGG,
  campfire: SHAPE_CAMPFIRE,
  cauldron: SHAPE_CAULDRON,
  lantern: SHAPE_LANTERN,
  flower_pot: SHAPE_FLOWER_POT,
  item_frame: SHAPE_ITEM_FRAME,
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
  lever: SHAPE_LEVER,
  button: SHAPE_BUTTON,
  plate: SHAPE_PLATE,
  repeater: SHAPE_REPEATER,
  piston: SHAPE_PISTON,
  piston_head: SHAPE_PISTON_HEAD,
  rail: SHAPE_RAIL,
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
export function collisionBoxesFor(
  shape: number, state: number, out: Float32Array, corner = CORNER_NONE,
): number {
  if (shape === SHAPE_FENCE) {
    return one(out, 0, 0, 0, 0, 1, FENCE_COLLISION_HEIGHT, 1);
  }
  if (shape === SHAPE_FENCE_GATE) {
    if ((state & 4) !== 0) return 0;
    return one(out, 0, 0, 0, 0, 1, FENCE_COLLISION_HEIGHT, 1);
  }
  return boxesFor(shape, state, corner, out);
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
      // A escada reusa `connections` como forma de canto: os dois são
      // derivados do vizinho e nenhum ocupa bit do save.
      return stairs(state, connections, out);
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
      return ladder(state, out);
    case SHAPE_SIGN:
      return sign(state, out);
    case SHAPE_PAINTING:
      return wallPlate(state & 3, out, 1 / 16, 15 / 16);
    case SHAPE_LEVER:
      return lever(state, out);
    case SHAPE_BUTTON:
      return button(state, out);
    case SHAPE_PLATE:
      // bit 0 = pisada: a chapa afunda meio pixel, o bastante para o olho ver.
      return one(out, 0, 1 / 16, 0, 1 / 16, 15 / 16, (state & 1) !== 0 ? 0.5 / 16 : 1 / 16, 15 / 16);
    case SHAPE_REPEATER:
      return repeater(state, out);
    case SHAPE_PISTON:
      return piston(state, out);
    case SHAPE_PISTON_HEAD:
      return pistonHead(state, out);
    case SHAPE_TORCH:
      return torchBox(state, out);
    case SHAPE_BED:
      return bed(state, out);
    case SHAPE_CHEST:
      return chest(out);
    case SHAPE_CAKE:
      // Cada fatia comida recua a face −X em 2/16, como no gênero.
      return one(out, 0, (1 + 2 * Math.min(state & 7, CAKE_SLICES - 1)) / 16, 0, 1 / 16, 15 / 16, 8 / 16, 15 / 16);
    case SHAPE_BELL:
      // Coroa presa no teto, corpo, e a boca um pouco mais larga embaixo.
      one(out, 0, 6 / 16, 13 / 16, 6 / 16, 10 / 16, 1, 10 / 16);
      one(out, 1, 5 / 16, 5 / 16, 5 / 16, 11 / 16, 13 / 16, 11 / 16);
      return one(out, 2, 4 / 16, 3 / 16, 4 / 16, 12 / 16, 5 / 16, 12 / 16);
    case SHAPE_ANVIL:
      return anvil(state & 3, out);
    case SHAPE_HOPPER:
      return hopper(state & 7, out);
    case SHAPE_COMPARATOR:
      return comparator(state & 3, out);
    case SHAPE_BREWING_STAND:
      one(out, 0, 1 / 16, 0, 1 / 16, 15 / 16, 2 / 16, 15 / 16);
      one(out, 1, 7 / 16, 2 / 16, 7 / 16, 9 / 16, 14 / 16, 9 / 16);
      return one(out, 2, 2 / 16, 10 / 16, 7.5 / 16, 14 / 16, 11 / 16, 8.5 / 16);
    case SHAPE_PORTAL_FRAME:
      return one(out, 0, 0, 0, 0, 1, 13 / 16, 1);
    case SHAPE_PORTAL_FRAME_EYE:
      one(out, 0, 0, 0, 0, 1, 13 / 16, 1);
      return one(out, 1, 4 / 16, 13 / 16, 4 / 16, 12 / 16, 1, 12 / 16);
    case SHAPE_PORTAL_PLANE:
      return one(out, 0, 0, 11 / 16, 0, 1, 12 / 16, 1);
    case SHAPE_EGG:
      one(out, 0, 5 / 16, 0, 5 / 16, 11 / 16, 1 / 16, 11 / 16);
      one(out, 1, 3 / 16, 1 / 16, 3 / 16, 13 / 16, 7 / 16, 13 / 16);
      one(out, 2, 2 / 16, 7 / 16, 2 / 16, 14 / 16, 11 / 16, 14 / 16);
      one(out, 3, 3 / 16, 11 / 16, 3 / 16, 13 / 16, 14 / 16, 13 / 16);
      return one(out, 4, 5 / 16, 14 / 16, 5 / 16, 11 / 16, 1, 11 / 16);
    case SHAPE_CAMPFIRE:
      return campfire(out);
    case SHAPE_CAULDRON:
      return cauldron(out);
    case SHAPE_LANTERN:
      return lantern(state, out);
    case SHAPE_FLOWER_POT:
      return flowerPot(out);
    case SHAPE_ITEM_FRAME:
      return itemFrame(state, out);
    case SHAPE_RAIL:
      // O desenho é um quad só (ver `mesh/complex.ts`); a caixa existe para
      // quem pergunta pela forma — hoje ninguém, porque trilho não colide.
      return one(out, 0, 0, 0, 0, 1, FLAT_HEIGHT, 1);
    default:
      return 0;
  }
}

/**
 * Caixa que **envolve** a forma inteira, escrita em `out` como
 * `[x0,y0,z0,x1,y1,z1]`.
 *
 * É o que o contorno do bloco mirado usa: até 2026-09-16 ele era sempre o cubo
 * unitário, e mirar uma laje, uma tocha ou uma placa acendia um cubo inteiro no
 * ar em volta dela. Com a envolvente, o contorno cobre o que o jogador está
 * olhando.
 *
 * A cerca entra com **todos** os braços ligados de propósito: a envolvente dela
 * é o bloco inteiro, e o contorno não pode mudar de tamanho conforme o vizinho.
 */
export function boundsFor(shape: number, state: number, out: Float32Array): void {
  const count = boxesFor(shape, state, 0xf, BOUNDS_BOXES);
  if (count === 0) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    out[3] = 1; out[4] = 1; out[5] = 1;
    return;
  }
  out[0] = Infinity; out[1] = Infinity; out[2] = Infinity;
  out[3] = -Infinity; out[4] = -Infinity; out[5] = -Infinity;
  for (let b = 0; b < count; b++) {
    const o = b * BOX_STRIDE;
    for (let a = 0; a < 3; a++) {
      if (BOUNDS_BOXES[o + a] < out[a]) out[a] = BOUNDS_BOXES[o + a];
      if (BOUNDS_BOXES[o + a + 3] > out[a + 3]) out[a + 3] = BOUNDS_BOXES[o + a + 3];
    }
  }
}

const BOUNDS_BOXES = new Float32Array(MAX_BOXES * BOX_STRIDE);

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
 * Escada de mão: dois montantes e três degraus (M8).
 *
 * Era uma **chapa** de 3/16 com a textura vazada — de frente passava, de lado
 * era uma folha de papel com desenho de escada. Agora é a peça de marcenaria
 * que ela é, e cabe em cinco caixas, que é o teto de `MAX_BOXES`.
 *
 * Os degraus ficam 1/16 recuados em relação aos montantes: é essa sombra entre
 * as peças que faz o olho ler "degrau" em vez de "listra".
 *
 * `state & 3` é a parede em que ela está pendurada, na mesma codificação de
 * encaixe de alavanca e botão — por isso a geometria sai toda de `mounted`.
 */
const LADDER_DEPTH = 3 / 16;
const LADDER_RAIL = 2 / 16;
/** Alturas dos degraus, medidas da base do bloco. */
const LADDER_RUNGS: readonly number[] = [2 / 16, 7 / 16, 12 / 16];

function ladder(state: number, out: Float32Array): number {
  const face = state & 3;
  let count = mounted(out, 0, face, 1 / 16, 0, 0, 1 / 16 + LADDER_RAIL, 1, LADDER_DEPTH);
  count = mounted(
    out, count, face, 15 / 16 - LADDER_RAIL, 0, 0, 15 / 16, 1, LADDER_DEPTH,
  );
  for (let i = 0; i < LADDER_RUNGS.length; i++) {
    const y = LADDER_RUNGS[i];
    count = mounted(
      out, count, face, 3 / 16, y, 1 / 16, 13 / 16, y + 2 / 16, LADDER_DEPTH - 1 / 16,
    );
  }
  return count;
}

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

/**
 * Tocha (doc 04 §3).
 *
 * **Era uma cruz de planta** até 2026-09-16 — dois quads na diagonal com a
 * textura de tocha, que lia como "flor marrom" e não como tocha. Virou poste,
 * porque o formato de vértice passou a representar 1/16 de bloco (ver
 * `render/vertex.ts`); antes disso um poste de 2/16 colapsava no
 * arredondamento, e a cruz era a saída honesta.
 *
 * O encaixe está nos bits 0..2, na mesma codificação de alavanca e botão:
 * 0..3 = parede, `MOUNT_FLOOR` = chão. Teto não existe — tocha de cabeça para
 * baixo não é do gênero, e `game/interaction.ts` recusa a colocação.
 */
export const TORCH_HALF = 1 / 16;
/** Altura do poste plantado no chão. */
export const TORCH_FLOOR_TOP = 10 / 16;
/** Base e topo do poste preso na parede. */
export const TORCH_WALL_Y0 = 3 / 16;
export const TORCH_WALL_Y1 = 13 / 16;
/** Distância do centro do bloco até o centro do poste, na base e no topo. */
export const TORCH_WALL_BASE = 7 / 16;
export const TORCH_WALL_TOP = 1 / 16;

/**
 * Caixa da tocha. A de parede é **inclinada** no desenho (ver `mesh/complex.ts`);
 * aqui sai a caixa que a envolve, que é o que basta para quem pergunta pela
 * forma — a tocha não colide com ninguém.
 */
function torchBox(state: number, out: Float32Array): number {
  const mount = state & 7;
  const h = TORCH_HALF;
  if (mount === MOUNT_FLOOR || mount > 3) {
    return one(out, 0, 0.5 - h, 0, 0.5 - h, 0.5 + h, TORCH_FLOOR_TOP, 0.5 + h);
  }
  const step = FACING_STEP[mount];
  const near = 0.5 + step[0] * TORCH_WALL_TOP;
  const far = 0.5 + step[0] * (TORCH_WALL_BASE + h);
  const nearZ = 0.5 + step[1] * TORCH_WALL_TOP;
  const farZ = 0.5 + step[1] * (TORCH_WALL_BASE + h);
  return one(
    out, 0,
    Math.min(near, far) - (step[0] === 0 ? h : 0), TORCH_WALL_Y0,
    Math.min(nearZ, farZ) - (step[1] === 0 ? h : 0),
    Math.max(near, far) + (step[0] === 0 ? h : 0), TORCH_WALL_Y1,
    Math.max(nearZ, farZ) + (step[1] === 0 ? h : 0),
  );
}

/**
 * Metade de cama: o colchão mais dois pés na ponta de fora (M8).
 *
 * bits 0..1 = a direção em que fica a **outra** metade. Os pés ficam do lado
 * oposto a ela, que é o que faz as duas metades juntas parecerem um móvel com
 * quatro pés, e não dois blocos encostados.
 */
export const BED_HEIGHT = 9 / 16;
/** Altura dos pés, medida do chão até a base do colchão. */
const BED_LEG = 3 / 16;
const BED_LEG_SIZE = 3 / 16;

function bed(state: number, out: Float32Array): number {
  let count = one(out, 0, 0, BED_LEG, 0, 1, BED_HEIGHT, 1);
  // A ponta de fora é o lado oposto ao da outra metade.
  const outer = (state & 3) ^ 1;
  const s = BED_LEG_SIZE;
  const step = FACING_STEP[outer];
  const x0 = step[0] > 0 ? 1 - s : 0;
  const z0 = step[1] > 0 ? 1 - s : 0;
  if (step[0] !== 0) {
    count = one(out, count, x0, 0, 0, x0 + s, BED_LEG, s);
    count = one(out, count, x0, 0, 1 - s, x0 + s, BED_LEG, 1);
  } else {
    count = one(out, count, 0, 0, z0, s, BED_LEG, z0 + s);
    count = one(out, count, 1 - s, 0, z0, 1, BED_LEG, z0 + s);
  }
  return count;
}

/**
 * Baú: caixa, tampa e tranca (M8).
 *
 * Era um cubo inteiro — encostado noutro cubo qualquer, a única coisa que o
 * distinguia era a textura. O baú do gênero é **menor que o bloco**: sobra
 * 1/16 em volta, e é essa folga que o faz parecer um móvel pousado no chão em
 * vez de parte da parede.
 *
 * Três caixas: o corpo até 10/16, a tampa dali até 14/16, e a tranca saindo da
 * frente. A divisa entre corpo e tampa é onde o olho procura a dobradiça.
 *
 * **Desvio consciente:** a tampa não abre. Abrir de verdade é girar uma caixa
 * em torno da dobradiça, e a geometria deste jogo é de caixas **alinhadas aos
 * eixos** (doc 04 §3) — não há como representar rotação sem um segundo formato
 * de vértice. O que o jogador ganha é a forma; o que ele perde é a animação,
 * que nunca existiu.
 */
export const CHEST_MARGIN = 1 / 16;
export const CHEST_BODY_TOP = 10 / 16;
export const CHEST_TOP = 14 / 16;
/**
 * Quanto a tampa gira ao abrir, em radianos (M8).
 *
 * 95° e não 90 para a tampa passar do prumo e ficar apoiada para trás: parada
 * exatamente em pé ela lê como parede, não como tampa aberta.
 */
export const CHEST_LID_ANGLE = (95 * Math.PI) / 180;

function chest(out: Float32Array): number {
  const a = CHEST_MARGIN;
  const b = 1 - CHEST_MARGIN;
  let count = one(out, 0, a, 0, a, b, CHEST_BODY_TOP, b);
  count = one(out, count, a, CHEST_BODY_TOP, a, b, CHEST_TOP, b);
  /*
   * Tranca: uma pastilha na divisa entre corpo e tampa, saindo da face +Z.
   *
   * O lado importa. O baú não tem direção — ele é igual nas quatro faces —, e
   * a isometria do inventário mostra **+X e +Z**: uma tranca em −Z ficaria
   * escondida justamente no lugar onde ela ajuda a reconhecer a peça.
   */
  count = one(
    out, count, 7 / 16, CHEST_BODY_TOP - 2 / 16, b,
    9 / 16, CHEST_BODY_TOP + 2 / 16, b + 1 / 16,
  );
  return count;
}
