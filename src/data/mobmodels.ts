/**
 * Modelos de mob como dados (doc 07 §5): caixas com "box mapping" de UV.
 *
 * **Convenção de espaço** (própria do projeto, documentada aqui porque tudo
 * depende dela):
 *
 * - Unidade = 1/16 de bloco, igual ao pixel da skin. Uma caixa de 8×8×8 gasta
 *   exatamente 8×8×8 texels — é isso que faz o UV sair de graça.
 * - Origem no **centro dos pés** do mob, +Y para cima.
 * - +Z é a frente do mob (bate com o jogador: yaw 0 → frente = +Z), logo a
 *   direita do mob é −X. Daí `armRight` ter x negativo.
 * - `pivot` é o ponto de rotação, em unidades a partir da origem.
 * - `box` é `[x, y, z, sx, sy, sz]`, com a origem da caixa **relativa ao
 *   pivô** — assim girar um braço em torno do ombro é só girar em volta do
 *   pivô, sem matemática extra.
 *
 * A animação é procedural (doc 07 §5): cada parte declara em que eixo oscila,
 * com que amplitude e com que fase. Nenhum keyframe, nenhum caso especial por
 * tipo de mob.
 */

/**
 * Como a parte se move. `head` acompanha o olhar, `swing` oscila com o andar,
 * `flap` bate no tempo da idade (asa) e `stiff` fica travada na rotação fixa
 * com um tremor de 0,05 rad — os braços do zumbi do doc 07 §5.
 */
export type AnimKind = 'none' | 'head' | 'swing' | 'flap' | 'stiff';

export interface PartDef {
  name: string;
  pivot: readonly [number, number, number];
  box: readonly [number, number, number, number, number, number];
  /** Canto superior esquerdo do "box mapping" na skin. */
  uv: readonly [number, number];
  /** Espelha o UV horizontalmente (par esquerdo/direito com um só desenho). */
  mirror?: boolean;
  anim?: AnimKind;
  /** Eixo da oscilação: 0 = X, 1 = Y, 2 = Z. */
  axis?: 0 | 1 | 2;
  /** Amplitude em radianos. */
  amp?: number;
  /** Deslocamento de fase em radianos. */
  phase?: number;
  /** Rotação fixa `[rx, ry, rz]`, somada à animada. */
  rot?: readonly [number, number, number];
}

export interface ModelDef {
  /** Lado da skin em texels (sempre quadrada). */
  skinSize: number;
  /** Altura do modelo em unidades — só para conferir com a hitbox. */
  height: number;
  parts: readonly PartDef[];
}

const PI = Math.PI;

/** Braço/perna 4×12×4 reaproveitado pelos humanoides. */
const LIMB = [-2, -12, -2, 4, 12, 4] as const;

const HUMANOID_PARTS: PartDef[] = [
  { name: 'head', pivot: [0, 24, 0], box: [-4, 0, -4, 8, 8, 8], uv: [0, 0], anim: 'head' },
  { name: 'body', pivot: [0, 24, 0], box: [-4, -12, -2, 8, 12, 4], uv: [16, 16] },
  { name: 'armRight', pivot: [-4, 22, 0], box: [-4, -12, -2, 4, 12, 4], uv: [40, 16], anim: 'swing', axis: 0, amp: 2.0, phase: PI },
  { name: 'armLeft', pivot: [4, 22, 0], box: [0, -12, -2, 4, 12, 4], uv: [40, 16], mirror: true, anim: 'swing', axis: 0, amp: 2.0 },
  { name: 'legRight', pivot: [-2, 12, 0], box: LIMB, uv: [0, 16], anim: 'swing', axis: 0, amp: 1.4 },
  { name: 'legLeft', pivot: [2, 12, 0], box: LIMB, uv: [0, 16], mirror: true, anim: 'swing', axis: 0, amp: 1.4, phase: PI },
];

/** Zumbi: braços travados à frente (doc 07 §5), com o tremor de 0.05 rad. */
const ZOMBIE_PARTS: PartDef[] = HUMANOID_PARTS.map((part) => (
  part.name.startsWith('arm')
    ? { ...part, anim: 'stiff' as AnimKind, rot: [-PI / 2, 0, 0] as const }
    : part
));

/** Pernas de quadrúpede: as diagonais andam em fase (é o que parece natural). */
function quadLegs(y: number, length: number, spreadX: number, spreadZ: number): PartDef[] {
  const box = [-2, -length, -2, 4, length, 4] as const;
  return [
    { name: 'legFrontRight', pivot: [-spreadX, y, spreadZ], box, uv: [0, 16], anim: 'swing', axis: 0, amp: 1.0 },
    { name: 'legFrontLeft', pivot: [spreadX, y, spreadZ], box, uv: [0, 16], mirror: true, anim: 'swing', axis: 0, amp: 1.0, phase: PI },
    { name: 'legBackRight', pivot: [-spreadX, y, -spreadZ], box, uv: [0, 16], anim: 'swing', axis: 0, amp: 1.0, phase: PI },
    { name: 'legBackLeft', pivot: [spreadX, y, -spreadZ], box, uv: [0, 16], mirror: true, anim: 'swing', axis: 0, amp: 1.0 },
  ];
}

/** Pernas de aranha: 4 de cada lado, em duas fases cruzadas (doc 07 §5). */
function spiderLegs(): PartDef[] {
  const out: PartDef[] = [];
  const zs = [6, 2, -2, -6];
  for (let i = 0; i < zs.length; i++) {
    const phase = (i % 2) * PI;
    out.push({
      name: `legRight${i}`, pivot: [-4, 6, zs[i]], box: [-10, -1, -1, 10, 2, 2],
      uv: [0, 52], anim: 'swing', axis: 1, amp: 0.25, phase, rot: [0, 0, -0.35],
    });
    out.push({
      name: `legLeft${i}`, pivot: [4, 6, zs[i]], box: [0, -1, -1, 10, 2, 2],
      uv: [0, 52], mirror: true, anim: 'swing', axis: 1, amp: 0.25, phase: phase + PI, rot: [0, 0, 0.35],
    });
  }
  return out;
}

export const MODELS: Record<string, ModelDef> = {
  humanoid: { skinSize: 64, height: 31, parts: HUMANOID_PARTS },
  zombie: { skinSize: 64, height: 31, parts: ZOMBIE_PARTS },

  quadruped: {
    skinSize: 64, height: 22,
    parts: [
      { name: 'body', pivot: [0, 12, 0], box: [-6, 0, -8, 12, 10, 16], uv: [0, 32] },
      { name: 'head', pivot: [0, 17, 8], box: [-4, -4, 0, 8, 8, 8], uv: [0, 0], anim: 'head' },
      ...quadLegs(12, 12, 4, 5),
    ],
  },

  quadruped_short: {
    skinSize: 64, height: 14,
    parts: [
      { name: 'body', pivot: [0, 6, 0], box: [-5, 0, -8, 10, 8, 16], uv: [0, 32] },
      { name: 'head', pivot: [0, 10, 8], box: [-4, -4, 0, 8, 8, 6], uv: [0, 0], anim: 'head' },
      ...quadLegs(6, 6, 4, 5),
    ],
  },

  bird: {
    skinSize: 64, height: 11,
    parts: [
      { name: 'body', pivot: [0, 5, 0], box: [-3, 0, -4, 6, 6, 8], uv: [0, 32] },
      { name: 'head', pivot: [0, 10, 2], box: [-2, -2, 0, 4, 4, 4], uv: [0, 0], anim: 'head' },
      { name: 'beak', pivot: [0, 10, 4], box: [-1, -1, 0, 2, 1, 3], uv: [20, 0], anim: 'head' },
      { name: 'wingRight', pivot: [-3, 9, 0], box: [-1, -4, -3, 1, 4, 6], uv: [32, 0], anim: 'flap', axis: 2, amp: 0.6 },
      { name: 'wingLeft', pivot: [3, 9, 0], box: [0, -4, -3, 1, 4, 6], uv: [32, 0], mirror: true, anim: 'flap', axis: 2, amp: -0.6 },
      { name: 'legRight', pivot: [-2, 5, 0], box: [-1, -5, -1, 2, 5, 2], uv: [0, 16], anim: 'swing', axis: 0, amp: 1.4 },
      { name: 'legLeft', pivot: [2, 5, 0], box: [-1, -5, -1, 2, 5, 2], uv: [0, 16], mirror: true, anim: 'swing', axis: 0, amp: 1.4, phase: PI },
    ],
  },

  /**
   * Morcego (doc 07 §4, categoria `ambient`).
   *
   * Corpo pequeno, cabeça com orelhas e duas asas que batem no tempo da idade
   * (`flap`). As orelhas são duas caixas de 1×2×1: sem elas a silhueta a cinco
   * blocos de distância é um rato voando.
   */
  bat: {
    skinSize: 64, height: 9,
    parts: [
      { name: 'body', pivot: [0, 3, 0], box: [-2, 0, -1.5, 4, 6, 3], uv: [0, 32] },
      { name: 'head', pivot: [0, 9, 0], box: [-2, -2, -2, 4, 4, 4], uv: [0, 0], anim: 'head' },
      { name: 'earRight', pivot: [-1.5, 11, 0], box: [-1, 0, -0.5, 1, 2, 1], uv: [24, 0], anim: 'head' },
      { name: 'earLeft', pivot: [1.5, 11, 0], box: [0, 0, -0.5, 1, 2, 1], uv: [24, 0], mirror: true, anim: 'head' },
      { name: 'wingRight', pivot: [-2, 8, 0], box: [-7, -5, -0.5, 7, 6, 1], uv: [32, 16], anim: 'flap', axis: 2, amp: 1.1 },
      { name: 'wingLeft', pivot: [2, 8, 0], box: [0, -5, -0.5, 7, 6, 1], uv: [32, 16], mirror: true, anim: 'flap', axis: 2, amp: -1.1 },
    ],
  },

  wolf: {
    skinSize: 64, height: 14,
    parts: [
      { name: 'body', pivot: [0, 8, 0], box: [-3, 0, -7, 6, 6, 14], uv: [0, 32] },
      { name: 'head', pivot: [0, 11, 7], box: [-3, -3, 0, 6, 6, 5], uv: [0, 0], anim: 'head' },
      { name: 'snout', pivot: [0, 10, 12], box: [-1.5, -1.5, 0, 3, 3, 3], uv: [24, 0], anim: 'head' },
      { name: 'tail', pivot: [0, 13, -7], box: [-1, -1, -6, 2, 2, 6], uv: [40, 0], anim: 'swing', axis: 1, amp: 0.4 },
      ...quadLegs(8, 8, 2.5, 5),
    ],
  },

  creeper: {
    skinSize: 64, height: 27,
    parts: [
      { name: 'head', pivot: [0, 19, 0], box: [-4, 0, -4, 8, 8, 8], uv: [0, 0], anim: 'head' },
      { name: 'body', pivot: [0, 7, 0], box: [-4, 0, -2, 8, 12, 4], uv: [16, 16] },
      { name: 'legFrontRight', pivot: [-2, 7, 4], box: [-2, -7, -2, 4, 7, 4], uv: [0, 32], anim: 'swing', axis: 0, amp: 0.8 },
      { name: 'legFrontLeft', pivot: [2, 7, 4], box: [-2, -7, -2, 4, 7, 4], uv: [0, 32], mirror: true, anim: 'swing', axis: 0, amp: 0.8, phase: PI },
      { name: 'legBackRight', pivot: [-2, 7, -4], box: [-2, -7, -2, 4, 7, 4], uv: [0, 32], anim: 'swing', axis: 0, amp: 0.8, phase: PI },
      { name: 'legBackLeft', pivot: [2, 7, -4], box: [-2, -7, -2, 4, 7, 4], uv: [0, 32], mirror: true, anim: 'swing', axis: 0, amp: 0.8 },
    ],
  },

  spider: {
    skinSize: 64, height: 14,
    parts: [
      { name: 'body', pivot: [0, 7, -5], box: [-5, -4, -6, 10, 8, 12], uv: [0, 32] },
      { name: 'head', pivot: [0, 7, 4], box: [-4, -4, 0, 8, 8, 8], uv: [0, 0], anim: 'head' },
      ...spiderLegs(),
    ],
  },

  enderman: {
    skinSize: 64, height: 46,
    parts: [
      { name: 'head', pivot: [0, 38, 0], box: [-4, 0, -4, 8, 8, 8], uv: [0, 0], anim: 'head' },
      { name: 'body', pivot: [0, 38, 0], box: [-4, -12, -2, 8, 12, 4], uv: [16, 16] },
      { name: 'armRight', pivot: [-4, 36, 0], box: [-4, -26, -2, 4, 26, 4], uv: [40, 0], anim: 'swing', axis: 0, amp: 0.7, phase: PI },
      { name: 'armLeft', pivot: [4, 36, 0], box: [0, -26, -2, 4, 26, 4], uv: [40, 30], mirror: true, anim: 'swing', axis: 0, amp: 0.7 },
      { name: 'legRight', pivot: [-2, 26, 0], box: [-2, -26, -2, 4, 26, 4], uv: [0, 16], anim: 'swing', axis: 0, amp: 0.9 },
      { name: 'legLeft', pivot: [2, 26, 0], box: [-2, -26, -2, 4, 26, 4], uv: [16, 32], mirror: true, anim: 'swing', axis: 0, amp: 0.9, phase: PI },
    ],
  },

  slime: {
    skinSize: 64, height: 8,
    parts: [
      { name: 'body', pivot: [0, 0, 0], box: [-4, 0, -4, 8, 8, 8], uv: [0, 0] },
    ],
  },

  /**
   * Ghast (M7): um cubo grande e quatro tentáculos curtos.
   *
   * O original tem nove tentáculos compridos; quatro curtos leem igual a 30
   * blocos de distância, que é onde o ghast é visto, e custam cinco caixas em
   * vez de dez no batcher.
   */
  cube: {
    skinSize: 64, height: 16,
    parts: [
      { name: 'body', pivot: [0, 0, 0], box: [-8, 0, -8, 16, 16, 16], uv: [0, 0] },
      { name: 'tentacle_a', pivot: [-4, 0, -4], box: [-1, -6, -1, 2, 6, 2], uv: [0, 32] },
      { name: 'tentacle_b', pivot: [4, 0, -4], box: [-1, -6, -1, 2, 6, 2], uv: [0, 32] },
      { name: 'tentacle_c', pivot: [-4, 0, 4], box: [-1, -6, -1, 2, 6, 2], uv: [0, 32] },
      { name: 'tentacle_d', pivot: [4, 0, 4], box: [-1, -6, -1, 2, 6, 2], uv: [0, 32] },
    ],
  },

  /**
   * Carrinho de mina (M7): caçamba aberta, quatro paredes e um piso.
   * Mesmo precedente da flecha e do barco — caixa com skin, batcher dos mobs.
   */
  minecart: {
    skinSize: 64, height: 8,
    parts: [
      { name: 'floor', pivot: [0, 0, 0], box: [-7, 0, -7, 14, 2, 14], uv: [0, 0] },
      { name: 'wall_n', pivot: [0, 0, -7], box: [-7, 2, 0, 14, 5, 2], uv: [0, 18] },
      { name: 'wall_s', pivot: [0, 0, 5], box: [-7, 2, 0, 14, 5, 2], uv: [0, 18] },
      { name: 'wall_w', pivot: [-7, 0, 0], box: [0, 2, -5, 2, 5, 10], uv: [0, 26] },
      { name: 'wall_e', pivot: [5, 0, 0], box: [0, 2, -5, 2, 5, 10], uv: [0, 26] },
    ],
  },

  /**
   * Flecha. Não é mob, mas é uma caixa com skin — reusar o mesmo batcher sai
   * mais barato que um passe novo só para ela (doc 07 §6).
   */
  arrow: {
    skinSize: 64, height: 1,
    parts: [
      { name: 'shaft', pivot: [0, 0, 0], box: [-0.5, -0.5, -5, 1, 1, 10], uv: [0, 0] },
    ],
  },

  /**
   * Barco. Mesmo argumento da flecha: é uma caixa com skin, e reusar o batcher
   * dos mobs sai mais barato que um passe novo (doc 07 §6).
   */
  boat: {
    skinSize: 64, height: 6,
    parts: [
      { name: 'floor', pivot: [0, 0, 0], box: [-10, 0, -6, 20, 2, 12], uv: [0, 0] },
      { name: 'bowWall', pivot: [0, 0, 0], box: [-10, 2, -6, 20, 4, 2], uv: [0, 16] },
      { name: 'sternWall', pivot: [0, 0, 0], box: [-10, 2, 4, 20, 4, 2], uv: [0, 24] },
      { name: 'leftWall', pivot: [0, 0, 0], box: [-10, 2, -6, 2, 4, 12], uv: [32, 16] },
      { name: 'rightWall', pivot: [0, 0, 0], box: [8, 2, -6, 2, 4, 12], uv: [32, 24] },
    ],
  },

  /**
   * Pesca (M14): a boia e um trecho da linha. A linha é desenhada como uma
   * fila de trechos girados na direção dela, no mesmo batcher da flecha —
   * nenhum passe de linha novo por causa de um fio. O trecho tem 16 unidades
   * de comprimento: com `scale = L`, ele mede L blocos e tem L/16 de espessura.
   */
  fishing_bobber: {
    skinSize: 64, height: 4,
    parts: [
      { name: 'float', pivot: [0, 0, 0], box: [-2, 0, -2, 4, 4, 4], uv: [0, 0] },
    ],
  },
  fishing_line: {
    skinSize: 64, height: 1,
    parts: [
      { name: 'thread', pivot: [0, 0, 0], box: [-0.5, -0.5, -8, 1, 1, 16], uv: [0, 0] },
    ],
  },

  squid: {
    skinSize: 64, height: 13,
    parts: [
      { name: 'body', pivot: [0, 12, 0], box: [-6, -10, -6, 12, 10, 12], uv: [0, 0] },
      { name: 'tentacle0', pivot: [-3, 2, 3], box: [-1, -8, -1, 2, 8, 2], uv: [48, 0], anim: 'swing', axis: 0, amp: 0.4 },
      { name: 'tentacle1', pivot: [3, 2, 3], box: [-1, -8, -1, 2, 8, 2], uv: [48, 0], anim: 'swing', axis: 0, amp: 0.4, phase: PI / 2 },
      { name: 'tentacle2', pivot: [-3, 2, -3], box: [-1, -8, -1, 2, 8, 2], uv: [48, 0], anim: 'swing', axis: 0, amp: 0.4, phase: PI },
      { name: 'tentacle3', pivot: [3, 2, -3], box: [-1, -8, -1, 2, 8, 2], uv: [48, 0], anim: 'swing', axis: 0, amp: 0.4, phase: 3 * PI / 2 },
    ],
  },
};

export function modelOf(name: string): ModelDef {
  const model = MODELS[name];
  if (model === undefined) throw new Error(`Modelo de mob desconhecido: ${name}`);
  return model;
}

/** Total de caixas de todos os modelos — o batcher dimensiona o buffer com isso. */
export function maxPartsPerModel(): number {
  let max = 0;
  for (const name of Object.keys(MODELS)) max = Math.max(max, MODELS[name].parts.length);
  return max;
}

/**
 * Retângulo de uma face no "box mapping", em texels.
 *
 * Layout (largura `2*(sx+sz)`, altura `sz+sy`), o mesmo que o gerador de skin
 * usa para pintar:
 * ```
 *        +--------+--------+
 *        |  topo  | baixo  |          linha 0, altura sz
 * +------+--------+--------+--------+
 * |leste | frente | oeste  | trás   |  linha 1, altura sy
 * +------+--------+--------+--------+
 * ```
 */
export type FaceName = 'top' | 'bottom' | 'east' | 'front' | 'west' | 'back';

export const FACE_ORDER: readonly FaceName[] = ['top', 'bottom', 'east', 'front', 'west', 'back'];

/** Escreve `[x, y, w, h]` do retângulo da face em `out`. */
export function faceRect(part: PartDef, face: FaceName, out: Float32Array): void {
  const sx = part.box[3];
  const sy = part.box[4];
  const sz = part.box[5];
  const u = part.uv[0];
  const v = part.uv[1];

  switch (face) {
    case 'top': out[0] = u; out[1] = v; out[2] = sx; out[3] = sz; break;
    case 'bottom': out[0] = u + sx; out[1] = v; out[2] = sx; out[3] = sz; break;
    case 'east': out[0] = u; out[1] = v + sz; out[2] = sz; out[3] = sy; break;
    case 'front': out[0] = u + sz; out[1] = v + sz; out[2] = sx; out[3] = sy; break;
    case 'west': out[0] = u + sz + sx; out[1] = v + sz; out[2] = sz; out[3] = sy; break;
    default: out[0] = u + sz + sx + sz; out[1] = v + sz; out[2] = sx; out[3] = sy; break;
  }
}
