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
export const SHAPE_LEVER = 14;
export const SHAPE_BUTTON = 15;
export const SHAPE_PLATE = 16;
export const SHAPE_REPEATER = 17;
export const SHAPE_PISTON = 18;
export const SHAPE_PISTON_HEAD = 19;
export const SHAPE_RAIL = 20;

/**
 * Formas de trilho nos bits 0..3 do estado (M7), na codificação do gênero.
 *
 * 0..1 são as retas, 2..5 as rampas (o nome diz para onde **sobe**) e 6..9 as
 * curvas (o nome diz quais dois lados a curva liga). Trilho motorizado e
 * detector só usam 0..5: curva com máquina dentro não existe.
 */
export const RAIL_NS = 0;
export const RAIL_EW = 1;
export const RAIL_ASCEND_EAST = 2;
export const RAIL_ASCEND_WEST = 3;
export const RAIL_ASCEND_NORTH = 4;
export const RAIL_ASCEND_SOUTH = 5;
export const RAIL_CURVE_SE = 6;
export const RAIL_CURVE_SW = 7;
export const RAIL_CURVE_NW = 8;
export const RAIL_CURVE_NE = 9;
/** Bit de "energizado" do trilho motorizado e do detector. */
export const RAIL_POWERED = 16;
/** Primeira forma de rampa e primeira de curva, para as comparações de faixa. */
export const RAIL_FIRST_SLOPE = RAIL_ASCEND_EAST;
export const RAIL_FIRST_CURVE = RAIL_CURVE_SE;

/** true se a forma é uma rampa. */
export function railIsSlope(shape: number): boolean {
  return shape >= RAIL_FIRST_SLOPE && shape < RAIL_FIRST_CURVE;
}

/** true se a forma é uma curva. */
export function railIsCurve(shape: number): boolean {
  return shape >= RAIL_FIRST_CURVE;
}

/**
 * Os dois lados que uma forma de trilho liga, nos índices de `FACING_STEP`
 * (0 = +X, 1 = −X, 2 = +Z, 3 = −Z). A rampa liga os dois lados do próprio eixo.
 */
export const RAIL_LINKS: readonly (readonly [number, number])[] = [
  [2, 3], // NS
  [0, 1], // EW
  [0, 1], // sobe para +X
  [0, 1], // sobe para −X
  [2, 3], // sobe para −Z
  [2, 3], // sobe para +Z
  [2, 0], // curva +Z/+X
  [2, 1], // curva +Z/−X
  [3, 1], // curva −Z/−X
  [3, 0], // curva −Z/+X
];

/** Direção para onde a rampa sobe, ou −1 se a forma é plana. */
export function railSlopeDir(shape: number): number {
  if (!railIsSlope(shape)) return -1;
  // A ordem das rampas é +X, −X, −Z, +Z; a de `FACING_STEP` é +X, −X, +Z, −Z.
  const order = [0, 1, 3, 2];
  return order[shape - RAIL_FIRST_SLOPE];
}

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
  lever: SHAPE_LEVER,
  button: SHAPE_BUTTON,
  plate: SHAPE_PLATE,
  repeater: SHAPE_REPEATER,
  piston: SHAPE_PISTON,
  piston_head: SHAPE_PISTON_HEAD,
  rail: SHAPE_RAIL,
};

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
      return wallPlate(state & 3, out, 0, 1);
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
    case SHAPE_RAIL:
      // O desenho é um quad só (ver `mesh/complex.ts`); a caixa existe para
      // quem pergunta pela forma — hoje ninguém, porque trilho não colide.
      return one(out, 0, 0, 0, 0, 1, FLAT_HEIGHT, 1);
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
function stairs(state: number, corner: number, out: Float32Array): number {
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
 * das duas escadas tem que ser contínua pela face que elas dividem.**
 *
 *  - vizinho perpendicular **do lado alto** → canto **interno**: a escada ganha
 *    o quarto que falta para o L fechar em volta dele;
 *  - vizinho perpendicular **do lado aberto** → canto **externo**: a meia caixa
 *    encolhe para o quarto que sobra do lado de fora da curva.
 *
 * Nos dois casos quem escolhe o quarto é o **lado alto do vizinho**: é ele que
 * diz para onde a curva vira. O interno vem depois e vence, como no gênero —
 * uma escada entre duas perpendiculares fecha a curva em vez de abrir.
 *
 * Vizinho com o bit de "de cabeça para baixo" diferente não faz canto: as duas
 * metades altas estão em alturas diferentes e não há superfície para ligar.
 */
export function stairCornerFrom(
  bits: number, nbPlusX: number, nbMinusX: number, nbPlusZ: number, nbMinusZ: number,
): number {
  const tall = (bits & 3) ^ 1;
  const open = tall ^ 1;
  const top = bits & 4;
  const neighbors = [nbPlusX, nbMinusX, nbPlusZ, nbMinusZ];

  // Externo primeiro, para o interno poder sobrescrever.
  let result = CORNER_NONE;
  const front = neighbors[open];
  if (isPerpendicularStair(front, tall, top)) {
    result = CORNER_OUTER | (((front & 3) ^ 1) << 2);
  }
  const back = neighbors[tall];
  if (isPerpendicularStair(back, tall, top)) {
    result = CORNER_INNER | (((back & 3) ^ 1) << 2);
  }
  return result;
}

/** true se o vizinho é escada, do mesmo lado de cima e de eixo perpendicular. */
function isPerpendicularStair(nb: number, tall: number, top: number): boolean {
  if (nb === NOT_STAIRS) return false;
  if ((nb & 4) !== top) return false;
  // Eixo: 0/1 são X, 2/3 são Z. Perpendicular = eixos diferentes.
  return ((nb & 3) >> 1) !== (tall >> 1);
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

// --- redstone (M7) ---------------------------------------------------------

/**
 * Caixa descrita no referencial da **superfície de encaixe**: `u` e `v` correm
 * sobre a superfície, `w` é a distância a partir dela.
 *
 * É isso que permite alavanca e botão terem uma geometria só para os seis
 * encaixes possíveis, em vez de seis blocos de código quase iguais.
 */
function mounted(
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
function lever(state: number, out: Float32Array): number {
  const mount = state & 7;
  const on = (state & 8) !== 0;
  let count = mounted(out, 0, mount, 5 / 16, 4 / 16, 0, 11 / 16, 12 / 16, 3 / 16);
  const v0 = on ? 3 / 16 : 9 / 16;
  count = mounted(out, count, mount, 7 / 16, v0, 2 / 16, 9 / 16, v0 + 4 / 16, 10 / 16);
  return count;
}

/** Botão: uma pastilha na superfície, mais rasa quando apertada. */
function button(state: number, out: Float32Array): number {
  const mount = state & 7;
  const depth = (state & 8) !== 0 ? 1 / 16 : 2 / 16;
  return mounted(out, 0, mount, 5 / 16, 6 / 16, 0, 11 / 16, 10 / 16, depth);
}

/**
 * Repetidor: a base achatada mais duas tochinhas. A de trás anda para longe da
 * saída conforme o atraso (bits 2..3) — é assim que se lê o atraso sem HUD.
 */
function repeater(state: number, out: Float32Array): number {
  let count = one(out, 0, 0, 0, 0, 1, 2 / 16, 1);
  const facing = state & 3;
  const delay = (state >> 2) & 3;
  count = torchNub(out, count, facing, 3 / 16);
  count = torchNub(out, count, facing, (7 + delay * 2) / 16);
  return count;
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
function piston(state: number, out: Float32Array): number {
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
function pistonHead(state: number, out: Float32Array): number {
  const dir = state & 7;
  const mount = mountForDir(dir ^ 1);
  let count = mounted(out, 0, mount, 6 / 16, 6 / 16, 0, 10 / 16, 10 / 16, PISTON_BODY);
  count = mounted(out, count, mount, 0, 0, PISTON_BODY, 1, 1, 1);
  return count;
}
