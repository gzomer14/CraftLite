/**
 * Dimensões do mundo (doc 14 — M7).
 *
 * Como toda tabela de `src/data`, é **dado**: acrescentar uma dimensão é uma
 * entrada aqui mais um gerador em `world/gen/`. Nada no motor tem um `if` por
 * nome de dimensão — quem pergunta consulta `dimensionOf(world.dimension)`.
 *
 * **Só existe uma dimensão carregada por vez.** Num aparelho de 2 GB, manter o
 * Overworld na memória enquanto o jogador está no Nether dobraria o custo de
 * voxel, luz e malha sem nada na tela para mostrar. Atravessar o portal grava o
 * que está sujo, descarrega tudo e recarrega do outro lado — ver
 * `game/travel.ts`.
 */

export const DIM_OVERWORLD = 0;
export const DIM_NETHER = 1;
/** O End (M16): a ilha do dragão. */
export const DIM_END = 2;

export interface DimensionDef {
  id: number;
  name: string;
  display: string;
  /**
   * Salt da seed. O Nether do mesmo mundo é determinístico, mas não é o
   * Overworld com outras cores: o ruído nasce de `seed ^ salt`.
   */
  salt: number;
  /** Há luz do céu? No Nether tudo é escuro, e a luz vem de lava e glowstone. */
  hasSky: boolean;
  /**
   * Luz ambiente mínima, 0..15. O Nether nunca é preto absoluto — é o que
   * evita o jogador ficar cego numa caverna de netherrack sem tocha.
   */
  ambientLight: number;
  /** Cor do céu e da névoa, RGB 0..1. `null` = céu normal, com ciclo de dia. */
  fog: readonly [number, number, number] | null;
  /**
   * Escala horizontal ao vir do Overworld: 1 bloco aqui vale `blockScale` lá.
   * É o que torna o Nether um atalho de viagem em vez de um cenário a mais.
   */
  blockScale: number;
  /** Água evapora ao ser colocada (o Nether é seco). */
  waterEvaporates: boolean;
  /** Alcance horizontal da lava, em blocos (doc 03 §9: 3, 4 no Nether). */
  lavaRange: number;
  /** Teto sólido de rocha-mãe: o Nether tem, o Overworld não. */
  solidCeiling: boolean;
}

export const DIMENSIONS: readonly DimensionDef[] = [
  {
    id: DIM_OVERWORLD,
    name: 'overworld',
    display: 'Superfície',
    salt: 0,
    hasSky: true,
    ambientLight: 0,
    fog: null,
    blockScale: 1,
    waterEvaporates: false,
    lavaRange: 3,
    solidCeiling: false,
  },
  {
    id: DIM_NETHER,
    name: 'nether',
    display: 'Nether',
    // Número arbitrário e fixo: mudá-lo regenera todo Nether já salvo.
    salt: 0x4e455448,
    hasSky: false,
    ambientLight: 3,
    fog: [0.24, 0.06, 0.05],
    blockScale: 8,
    waterEvaporates: true,
    lavaRange: 4,
    solidCeiling: true,
  },
  /*
   * O End (M16). Sem céu e sem ciclo: a névoa roxa-escura de tabela e uma luz
   * ambiente alta — a ilha é pálida e se enxerga de ponta a ponta, que é o
   * que a luta contra o dragão pede. Escala 1: não é atalho de viagem.
   */
  {
    id: DIM_END,
    name: 'end',
    display: 'O End',
    // Número arbitrário e fixo: mudá-lo regenera todo End já salvo.
    salt: 0x454e4421,
    hasSky: false,
    ambientLight: 9,
    fog: [0.06, 0.03, 0.09],
    blockScale: 1,
    waterEvaporates: false,
    lavaRange: 3,
    solidCeiling: false,
  },
];

export function dimensionOf(id: number): DimensionDef {
  return DIMENSIONS[id] ?? DIMENSIONS[DIM_OVERWORLD];
}

/**
 * Converte coordenada horizontal entre dimensões pela escala de cada uma.
 * Overworld → Nether divide por 8; a volta multiplica.
 */
export function scaleCoordinate(value: number, from: number, to: number): number {
  const ratio = dimensionOf(from).blockScale / dimensionOf(to).blockScale;
  return Math.floor(value * ratio);
}
