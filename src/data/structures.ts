/**
 * Estruturas do mundo, declarativas (doc 03 §7).
 *
 * **Leitura do doc, registrada aqui.** O doc pede "template declarativo (array
 * de `[dx,dy,dz,blockId]` + lista de baús)". Escrever uma casa de aldeia voxel
 * a voxel são ~500 entradas por template, e sete templates viram 3.500 linhas
 * de números que ninguém revisa. A forma declarativa adotada é uma camada acima
 * disso: cada estrutura é uma lista de **peças** — caixa cheia, caixa oca,
 * piso, moldura, pilar —, e um expansor genérico (`world/gen/structures.ts`)
 * transforma peça em voxel. Continua sendo dado: acrescentar uma estrutura é
 * uma entrada nesta tabela, sem uma linha no gerador.
 *
 * **A ordem desta tabela não vai para o save** — estrutura é conteúdo gerado,
 * regenerado da seed —, mas mudar uma entrada muda o mundo de quem já jogou.
 */

/** Como a peça preenche a caixa que declara. */
export type PieceKind =
  /** Todo o volume. */
  | 'fill'
  /** Só a casca: paredes, piso e teto, com o miolo vazio. */
  | 'hollow'
  /** Só as quatro paredes verticais. */
  | 'walls'
  /** Um voxel só, em `[x0,y0,z0]`. */
  | 'point';

/** Onde a peça pode escrever. */
export type PieceReplace =
  /** Sempre. */
  | 'any'
  /** Só onde já é ar — não fura a montanha ao redor. */
  | 'air'
  /** Só onde **não** é ar — reveste o que já existe. */
  | 'solid';

export interface Piece {
  kind: PieceKind;
  /** Nome do bloco; resolvido para id no boot. */
  block: string;
  /** Caixa inclusiva, relativa à origem da estrutura. */
  box: readonly [number, number, number, number, number, number];
  replace?: PieceReplace;
  /** Bloco alternativo sorteado por voxel — o musgo da dungeon. */
  alt?: string;
  /** Probabilidade 0..1 de sair o alternativo. */
  altChance?: number;
  /** Estado do bloco (rotação de escada, metade de laje). */
  state?: number;
}

/** Baú com tabela de loot, na posição relativa. */
export interface ChestSpot {
  at: readonly [number, number, number];
  loot: string;
}

/** Gerador de monstros, com o mob que ele solta. */
export interface SpawnerSpot {
  at: readonly [number, number, number];
  mob: string;
}

export interface Placement {
  /** Tentativas por chunk. Fracionário = probabilidade. */
  attempts: number;
  minY: number;
  maxY: number;
  /** true = assenta na superfície, ignorando `minY`/`maxY`. */
  surface: boolean;
  /** Biomas em que pode nascer; vazio = qualquer um. */
  biomes?: readonly string[];
}

export interface StructureDef {
  name: string;
  /** Tamanho em blocos, para o alcance de busca dos chunks vizinhos. */
  size: readonly [number, number, number];
  pieces: readonly Piece[];
  chests?: readonly ChestSpot[];
  spawners?: readonly SpawnerSpot[];
  placement: Placement;
}

/**
 * Loot de baú por estrutura, como faixas `[min, max]` e probabilidade.
 * A tabela de item é a mesma de `data/items.ts`, por nome.
 */
export interface LootRoll {
  item: string;
  count: readonly [number, number];
  chance: number;
}

export const CHEST_LOOT: Record<string, readonly LootRoll[]> = {
  dungeon: [
    { item: 'iron_ingot', count: [1, 4], chance: 0.6 },
    { item: 'gold_ingot', count: [1, 3], chance: 0.3 },
    { item: 'diamond', count: [1, 2], chance: 0.12 },
    { item: 'bread', count: [1, 3], chance: 0.5 },
    { item: 'bone', count: [1, 6], chance: 0.6 },
    { item: 'gunpowder', count: [1, 4], chance: 0.4 },
    { item: 'wheat_seeds', count: [1, 4], chance: 0.35 },
    { item: 'book', count: [1, 1], chance: 0.2 },
  ],
  mineshaft: [
    { item: 'rail', count: [4, 12], chance: 0.7 },
    { item: 'coal', count: [3, 8], chance: 0.6 },
    { item: 'iron_ingot', count: [1, 3], chance: 0.4 },
    { item: 'gold_ingot', count: [1, 2], chance: 0.15 },
    { item: 'diamond', count: [1, 1], chance: 0.06 },
    { item: 'bread', count: [1, 3], chance: 0.4 },
    { item: 'oak_planks', count: [2, 6], chance: 0.35 },
  ],
  village: [
    { item: 'bread', count: [2, 5], chance: 0.7 },
    { item: 'wheat', count: [2, 6], chance: 0.5 },
    { item: 'carrot', count: [2, 5], chance: 0.4 },
    { item: 'potato', count: [2, 5], chance: 0.4 },
    { item: 'iron_ingot', count: [1, 2], chance: 0.25 },
    { item: 'emerald', count: [1, 2], chance: 0.2 },
    { item: 'oak_sapling', count: [1, 3], chance: 0.3 },
  ],
};

/**
 * Dungeon: sala 7×5×7 de pedregulho manchado de musgo, spawner no centro e
 * dois baús nos cantos (doc 03 §7).
 *
 * A casca é `hollow` com `replace: 'any'` — ela precisa cavar a rocha em volta
 * para a sala existir —, e o miolo é um `fill` de ar.
 */
const DUNGEON: StructureDef = {
  name: 'dungeon',
  size: [7, 5, 7],
  pieces: [
    {
      kind: 'hollow', block: 'cobblestone', box: [0, 0, 0, 6, 4, 6], replace: 'any',
      alt: 'mossy_cobblestone', altChance: 0.35,
    },
    { kind: 'fill', block: 'air', box: [1, 1, 1, 5, 3, 5], replace: 'any' },
  ],
  chests: [
    { at: [1, 1, 1], loot: 'dungeon' },
    { at: [5, 1, 5], loot: 'dungeon' },
  ],
  spawners: [{ at: [3, 1, 3], mob: 'zombie' }],
  placement: { attempts: 0.06, minY: 8, maxY: 48, surface: false },
};

/**
 * Trecho de mina abandonada: um corredor de 3×3 com suportes de madeira, teia
 * e um baú no fim (doc 03 §7).
 *
 * Cada chunk sorteia o seu trecho de forma independente, então trechos vizinhos
 * se encontram e formam uma rede — o efeito de "mina" sem um algoritmo de
 * corredores com estado, que não caberia no orçamento de geração de T0.
 */
const MINESHAFT: StructureDef = {
  name: 'mineshaft',
  size: [13, 4, 3],
  pieces: [
    // O corredor propriamente dito: escavado no que houver.
    { kind: 'fill', block: 'air', box: [0, 1, 0, 12, 3, 2], replace: 'any' },
    // Piso de tábuas para o corredor não ter buraco.
    { kind: 'fill', block: 'oak_planks', box: [0, 0, 0, 12, 0, 2], replace: 'any' },
    // Suportes de cerca a cada 4 blocos, com a viga por cima.
    { kind: 'fill', block: 'oak_fence', box: [2, 1, 0, 2, 2, 0], replace: 'air' },
    { kind: 'fill', block: 'oak_fence', box: [2, 1, 2, 2, 2, 2], replace: 'air' },
    { kind: 'fill', block: 'oak_planks', box: [2, 3, 0, 2, 3, 2], replace: 'air' },
    { kind: 'fill', block: 'oak_fence', box: [6, 1, 0, 6, 2, 0], replace: 'air' },
    { kind: 'fill', block: 'oak_fence', box: [6, 1, 2, 6, 2, 2], replace: 'air' },
    { kind: 'fill', block: 'oak_planks', box: [6, 3, 0, 6, 3, 2], replace: 'air' },
    { kind: 'fill', block: 'oak_fence', box: [10, 1, 0, 10, 2, 0], replace: 'air' },
    { kind: 'fill', block: 'oak_fence', box: [10, 1, 2, 10, 2, 2], replace: 'air' },
    { kind: 'fill', block: 'oak_planks', box: [10, 3, 0, 10, 3, 2], replace: 'air' },
    // Trilho no meio do corredor e teias nos cantos escuros.
    { kind: 'fill', block: 'rail', box: [0, 1, 1, 12, 1, 1], replace: 'air' },
    { kind: 'point', block: 'cobweb', box: [3, 2, 0, 3, 2, 0], replace: 'air' },
    { kind: 'point', block: 'cobweb', box: [8, 2, 2, 8, 2, 2], replace: 'air' },
    // Tocha no piso de tábua, encostada na parede — estado 4 é o encaixe de
    // chão (`MOUNT_FLOOR`). Ela boiava no meio do corredor quando tocha era
    // uma cruz e não tinha encaixe nenhum.
    { kind: 'point', block: 'torch', box: [4, 1, 0, 4, 1, 0], replace: 'air', state: 4 },
  ],
  chests: [{ at: [11, 1, 1], loot: 'mineshaft' }],
  placement: { attempts: 0.08, minY: 12, maxY: 38, surface: false },
};

/**
 * Casa de aldeia: 7×5×7 com paredes de tábua, telhado de laje, porta, janela e
 * um baú dentro. É o template do "pool" do doc — a aldeia é um punhado destas.
 */
const VILLAGE_HOUSE: StructureDef = {
  name: 'village_house',
  size: [7, 6, 7],
  pieces: [
    // Fundação enterrada, para a casa não ficar com pé no ar na encosta.
    { kind: 'fill', block: 'cobblestone', box: [0, -3, 0, 6, 0, 6], replace: 'any' },
    // Casca de tábuas e miolo vazio.
    { kind: 'hollow', block: 'oak_planks', box: [0, 0, 0, 6, 4, 6], replace: 'any' },
    { kind: 'fill', block: 'air', box: [1, 1, 1, 5, 3, 5], replace: 'any' },
    // Cantos de tronco, que é o que faz uma caixa parecer uma casa.
    { kind: 'fill', block: 'oak_log', box: [0, 1, 0, 0, 3, 0], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [6, 1, 0, 6, 3, 0], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [0, 1, 6, 0, 3, 6], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [6, 1, 6, 6, 3, 6], replace: 'any' },
    // Telhado de laje, uma fileira acima da casca.
    { kind: 'fill', block: 'cobblestone_slab', box: [0, 5, 0, 6, 5, 6], replace: 'any' },
    // Porta na parede norte e janelas de vidro nas laterais.
    { kind: 'fill', block: 'air', box: [3, 1, 0, 3, 2, 0], replace: 'any' },
    // A porta ocupa duas células desde o M8: as duas metades entram aqui, senão
    // a aldeia nasce com meia porta e o ouvinte de `world/multiblock.ts` — que
    // ignora a geração de propósito — não tem o que consertar.
    { kind: 'point', block: 'oak_door', box: [3, 1, 0, 3, 1, 0], replace: 'any', state: 3 },
    { kind: 'point', block: 'oak_door_top', box: [3, 2, 0, 3, 2, 0], replace: 'any', state: 3 },
    { kind: 'point', block: 'glass', box: [0, 2, 3, 0, 2, 3], replace: 'any' },
    { kind: 'point', block: 'glass', box: [6, 2, 3, 6, 2, 3], replace: 'any' },
    { kind: 'point', block: 'glass', box: [3, 2, 6, 3, 2, 6], replace: 'any' },
    // Mobília: mesa de trabalho, tocha e cama.
    { kind: 'point', block: 'crafting_table', box: [1, 1, 5, 1, 1, 5], replace: 'any' },
    // Tocha pendurada na parede norte (encaixe 3 = apoio em −Z).
    { kind: 'point', block: 'torch', box: [2, 2, 1, 2, 2, 1], replace: 'any', state: 3 },
    // Cama com o pé em (5,1,1) e a cabeceira em (5,1,2): estado 2 é +Z.
    { kind: 'point', block: 'bed', box: [5, 1, 1, 5, 1, 1], replace: 'any', state: 2 },
    { kind: 'point', block: 'bed_head', box: [5, 1, 2, 5, 1, 2], replace: 'any', state: 3 },
  ],
  chests: [{ at: [1, 1, 1], loot: 'village' }],
  placement: {
    attempts: 1, minY: 0, maxY: 0, surface: true,
    biomes: ['plains', 'savanna', 'desert'],
  },
};

/**
 * Poço central da aldeia: o marco que diz "aqui é o meio". Fica na âncora da
 * região, e é por ele que a aldeia se reconhece de longe.
 */
const VILLAGE_WELL: StructureDef = {
  name: 'village_well',
  size: [5, 5, 5],
  pieces: [
    { kind: 'fill', block: 'cobblestone', box: [0, -4, 0, 4, 0, 4], replace: 'any' },
    { kind: 'walls', block: 'cobblestone', box: [1, 1, 1, 3, 1, 3], replace: 'any' },
    { kind: 'fill', block: 'water', box: [2, -3, 2, 2, 1, 2], replace: 'any' },
    { kind: 'fill', block: 'oak_fence', box: [1, 2, 1, 1, 3, 1], replace: 'any' },
    { kind: 'fill', block: 'oak_fence', box: [3, 2, 1, 3, 3, 1], replace: 'any' },
    { kind: 'fill', block: 'oak_fence', box: [1, 2, 3, 1, 3, 3], replace: 'any' },
    { kind: 'fill', block: 'oak_fence', box: [3, 2, 3, 3, 3, 3], replace: 'any' },
    { kind: 'fill', block: 'cobblestone_slab', box: [1, 4, 1, 3, 4, 3], replace: 'any' },
  ],
  placement: {
    attempts: 1, minY: 0, maxY: 0, surface: true,
    biomes: ['plains', 'savanna', 'desert'],
  },
};

export const STRUCTURES: readonly StructureDef[] = [
  DUNGEON, MINESHAFT, VILLAGE_HOUSE, VILLAGE_WELL,
];

export function structureByName(name: string): StructureDef | undefined {
  return STRUCTURES.find((s) => s.name === name);
}

/** Lado da região de aldeia, em chunks (doc 03 §7: ~1 a cada 32×32). */
export const VILLAGE_REGION = 32;
/** Raio, em chunks, em que as casas da aldeia se espalham a partir do poço. */
export const VILLAGE_RADIUS = 2;
/** Quantos aldeões nascem por aldeia (doc 03 §7). */
export const VILLAGERS_PER_VILLAGE: readonly [number, number] = [3, 8];
