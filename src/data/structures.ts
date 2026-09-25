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
  | 'point'
  /**
   * Coluna que desce de `y0` até bater em chão sólido (M16: os pilares da
   * ponte da fortaleza do Nether, que não sabem de antemão onde o chão fica).
   * Atravessa ar e fluido; para no primeiro bloco sólido ou 64 blocos abaixo.
   */
  | 'pillar';

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
  /**
   * Assenta no **fundo do mar** em vez da superfície (naufrágio, 2026-09-22).
   * Só vale com `surface`; a coluna tem que estar a pelo menos 4 blocos de
   * água, senão o barco nasce encalhado na praia.
   */
  underwater?: boolean;
}

export interface StructureDef {
  name: string;
  /**
   * Parte de aldeia (M9): não é sorteada chunk a chunk como as outras — quem a
   * coloca é o plano da aldeia (`world/gen/village.ts`).
   */
  village?: boolean;
  /** Tamanho em blocos, para o alcance de busca dos chunks vizinhos. */
  size: readonly [number, number, number];
  pieces: readonly Piece[];
  chests?: readonly ChestSpot[];
  spawners?: readonly SpawnerSpot[];
  /** Mobs que nascem com a estrutura, na primeira vez que o chunk entra (M16: a bruxa). */
  mobs?: readonly { at: readonly [number, number, number]; mob: string }[];
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
  // Naufrágio (2026-09-22): mantimento de bordo e um pouco de metal.
  // M16: a fortaleza do Nether guarda o que falta para o fim da jornada.
  nether_fortress: [
    { item: 'nether_wart', count: [3, 7], chance: 0.6 },
    { item: 'iron_ingot', count: [1, 5], chance: 0.45 },
    { item: 'gold_ingot', count: [1, 3], chance: 0.45 },
    { item: 'diamond', count: [1, 3], chance: 0.2 },
    { item: 'obsidian', count: [2, 4], chance: 0.3 },
    { item: 'flint_and_steel', count: [1, 1], chance: 0.2 },
    { item: 'blaze_rod', count: [1, 2], chance: 0.25 },
  ],
  // M16: os baús da fortaleza da superfície. As pérolas são o seguro de quem
  // não conseguiu caçar endermen — o olho que faltou para acender o portal.
  stronghold_corridor: [
    { item: 'ender_pearl', count: [1, 2], chance: 0.45 },
    { item: 'bread', count: [1, 3], chance: 0.6 },
    { item: 'iron_ingot', count: [1, 5], chance: 0.5 },
    { item: 'redstone', count: [4, 9], chance: 0.35 },
    { item: 'golden_apple', count: [1, 1], chance: 0.15 },
    { item: 'diamond', count: [1, 3], chance: 0.1 },
  ],
  stronghold_library: [
    { item: 'book', count: [1, 3], chance: 0.8 },
    { item: 'paper', count: [2, 7], chance: 0.6 },
    { item: 'compass', count: [1, 1], chance: 0.3 },
    { item: 'map', count: [1, 1], chance: 0.3 },
    { item: 'ender_pearl', count: [1, 1], chance: 0.25 },
  ],
  shipwreck: [
    { item: 'paper', count: [1, 6], chance: 0.6 },
    { item: 'coal', count: [2, 6], chance: 0.5 },
    { item: 'iron_ingot', count: [1, 4], chance: 0.45 },
    { item: 'gold_ingot', count: [1, 3], chance: 0.2 },
    { item: 'emerald', count: [1, 3], chance: 0.25 },
    { item: 'carrot', count: [2, 6], chance: 0.35 },
    { item: 'potato', count: [2, 6], chance: 0.35 },
    { item: 'wheat', count: [4, 10], chance: 0.3 },
    { item: 'diamond', count: [1, 1], chance: 0.05 },
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
/** A casa em si, igual para todo ofício: o que muda é a frente dela. */
const HOUSE_PIECES: readonly Piece[] = [
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
];

const VILLAGE_PLACEMENT: Placement = {
  attempts: 1, minY: 0, maxY: 0, surface: true,
  biomes: ['plains', 'savanna', 'desert', 'flower_plains'],
};

/**
 * Casa de aldeia: 7×5×7 com paredes de tábua, telhado de laje, porta, janela e
 * um baú dentro. É o template do "pool" do doc — a aldeia é um punhado destas.
 *
 * Desde o M9 ela é a base das casas por ofício (abaixo), que acrescentam a
 * frente; esta fica na tabela na mesma posição, porque a posição é o sal do
 * sorteio das estruturas que vêm depois dela.
 */
const VILLAGE_HOUSE: StructureDef = {
  name: 'village_house',
  village: true,
  size: [7, 6, 7],
  pieces: HOUSE_PIECES,
  chests: [{ at: [1, 1, 1], loot: 'village' }],
  placement: VILLAGE_PLACEMENT,
};

/**
 * Terreiro na frente da porta (M9): fundação, piso de terra batida na altura
 * do piso da casa, ar em cima, e o bloco de trabalho do ofício. É onde o
 * aldeão passa a manhã — fora de casa, onde se vê.
 */
function yard(workstation: string): Piece[] {
  return [
    { kind: 'fill', block: 'cobblestone', box: [0, -3, -3, 6, -1, -1], replace: 'any' },
    { kind: 'fill', block: 'dirt_path', box: [0, 0, -3, 6, 0, -1], replace: 'any' },
    { kind: 'fill', block: 'air', box: [0, 1, -3, 6, 3, -1], replace: 'any' },
    ...frontStep(-4),
    { kind: 'point', block: workstation, box: [5, 1, -2, 5, 1, -2], replace: 'any' },
  ];
}

/**
 * Degrau largo na borda da frente (M9). A casa assenta na altura da origem, e
 * a frente avança sobre o terreno: numa encosta ela virava uma plataforma dois
 * blocos acima do chão, que ninguém sobe — o aldeão ficava ao pé dela, a seis
 * blocos da cama. Com o degrau, a descida é de um bloco por vez.
 */
function frontStep(z: number): Piece[] {
  return [
    { kind: 'fill', block: 'cobblestone', box: [2, -3, z, 4, -2, z], replace: 'any' },
    { kind: 'fill', block: 'dirt_path', box: [2, -1, z, 4, -1, z], replace: 'any' },
    { kind: 'fill', block: 'air', box: [2, 0, z, 4, 2, z], replace: 'any' },
  ];
}

/**
 * Horta cercada do fazendeiro (M9, doc 14: "cercado de plantação"): dois
 * canteiros de terra arada com um corredor no meio, água tampada por laje em
 * cada canteiro e cerca em volta, aberta só no corredor. As plantas nascem
 * meio crescidas.
 */
const FARM_YARD: readonly Piece[] = [
  { kind: 'fill', block: 'dirt', box: [-1, -3, -6, 7, 0, -1], replace: 'any' },
  { kind: 'fill', block: 'farmland', box: [0, 0, -5, 2, 0, -2], replace: 'any' },
  { kind: 'fill', block: 'farmland', box: [4, 0, -5, 6, 0, -2], replace: 'any' },
  { kind: 'fill', block: 'dirt_path', box: [3, 0, -6, 3, 0, -1], replace: 'any' },
  { kind: 'fill', block: 'dirt_path', box: [0, 0, -1, 6, 0, -1], replace: 'any' },
  { kind: 'fill', block: 'air', box: [-1, 1, -6, 7, 3, -1], replace: 'any' },
  { kind: 'fill', block: 'wheat', box: [0, 1, -5, 2, 1, -2], replace: 'any', state: 5, alt: 'carrots', altChance: 0.3 },
  { kind: 'fill', block: 'wheat', box: [4, 1, -5, 6, 1, -2], replace: 'any', state: 5, alt: 'potatoes', altChance: 0.3 },
  { kind: 'point', block: 'water', box: [1, 0, -4, 1, 0, -4], replace: 'any' },
  { kind: 'point', block: 'water', box: [5, 0, -4, 5, 0, -4], replace: 'any' },
  // A água fica na altura da terra arada (é o que a hidrata) e ganha uma laje
  // por cima: um buraco de água aberto no meio da horta prendia o aldeão, que
  // caía nele e não conseguia pular para fora.
  { kind: 'point', block: 'oak_slab', box: [1, 1, -4, 1, 1, -4], replace: 'any' },
  { kind: 'point', block: 'oak_slab', box: [5, 1, -4, 5, 1, -4], replace: 'any' },
  // As laterais param um bloco antes da casa: é a passagem de quem chega pelo
  // lado. Fechada, a porta do fazendeiro só se alcançava pela abertura do
  // corredor lá na frente, e quem vinha rente à parede ficava preso na quina.
  { kind: 'fill', block: 'oak_fence', box: [-1, 1, -6, -1, 1, -2], replace: 'any' },
  { kind: 'fill', block: 'oak_fence', box: [7, 1, -6, 7, 1, -2], replace: 'any' },
  { kind: 'fill', block: 'oak_fence', box: [-1, 1, -6, 2, 1, -6], replace: 'any' },
  { kind: 'fill', block: 'oak_fence', box: [4, 1, -6, 7, 1, -6], replace: 'any' },
  ...frontStep(-7),
];

function houseOf(name: string, front: readonly Piece[]): StructureDef {
  return {
    name, village: true, size: [9, 6, 13],
    pieces: [...front, ...HOUSE_PIECES],
    chests: [{ at: [1, 1, 1], loot: 'village' }],
    placement: VILLAGE_PLACEMENT,
  };
}

/**
 * Onde fica cada coisa numa casa de aldeia, relativo à origem — o que o
 * aldeão precisa saber para morar nela (`game/village.ts`).
 */
export interface VillageHouseSpec {
  structure: StructureDef;
  /** Pé da cama. */
  bed: readonly [number, number, number];
  /** Metade de baixo da porta. */
  door: readonly [number, number, number];
  /** Para onde é a rua, em índice de `FACING_STEP` (3 = −Z). */
  doorOut: number;
  /** Onde o ofício trabalha de dia. */
  work: readonly [number, number, number];
}

/** Uma casa por profissão, **na ordem de `PROFESSIONS`** (`data/villagers.ts`). */
export const VILLAGE_HOUSES: readonly VillageHouseSpec[] = [
  {
    structure: houseOf('village_house_farmer', FARM_YARD),
    bed: [5, 1, 1], door: [3, 1, 0], doorOut: 3, work: [3, 1, -3],
  },
  {
    structure: houseOf('village_house_butcher', yard('crafting_table')),
    bed: [5, 1, 1], door: [3, 1, 0], doorOut: 3, work: [5, 1, -2],
  },
  {
    structure: houseOf('village_house_smith', yard('furnace')),
    bed: [5, 1, 1], door: [3, 1, 0], doorOut: 3, work: [5, 1, -2],
  },
  {
    structure: houseOf('village_house_librarian', yard('bookshelf')),
    bed: [5, 1, 1], door: [3, 1, 0], doorOut: 3, work: [5, 1, -2],
  },
];

/**
 * Poço central da aldeia: o marco que diz "aqui é o meio". Fica na âncora da
 * região, e é por ele que a aldeia se reconhece de longe.
 */
const VILLAGE_WELL: StructureDef = {
  name: 'village_well',
  village: true,
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
    // O sino (M9), pendurado no meio do telhado, sobre a água.
    { kind: 'point', block: 'bell', box: [2, 3, 2, 2, 3, 2], replace: 'any' },
  ],
  placement: VILLAGE_PLACEMENT,
};

/** Onde fica o sino do poço, relativo à origem do poço. */
export const WELL_BELL: readonly [number, number, number] = [2, 3, 2];

/*
 * As três estruturas do doc 03 §7 que faltavam (2026-09-22). Entram **no fim**
 * da lista: o sal do sorteio de cada estrutura é a posição dela aqui, e
 * encaixá-las no meio mudaria onde nascem as dungeons e as minas de todo mundo
 * ainda não gerado.
 */

/**
 * Poço do deserto (doc 03 §7: "1/1000 chunks, Desert — estrutura de sandstone
 * com água"): base de arenito, bordo de laje, quatro pilares e o telhado.
 */
const DESERT_WELL: StructureDef = {
  name: 'desert_well',
  size: [5, 5, 5],
  pieces: [
    { kind: 'fill', block: 'sandstone', box: [0, -3, 0, 4, 0, 4], replace: 'any' },
    { kind: 'fill', block: 'water', box: [2, -2, 2, 2, 0, 2], replace: 'any' },
    { kind: 'fill', block: 'sandstone_slab', box: [0, 1, 0, 4, 1, 4], replace: 'air' },
    { kind: 'walls', block: 'sandstone', box: [1, 1, 1, 3, 1, 3], replace: 'any' },
    { kind: 'point', block: 'water', box: [2, 1, 2, 2, 1, 2], replace: 'any' },
    { kind: 'fill', block: 'sandstone', box: [1, 2, 1, 1, 3, 1], replace: 'any' },
    { kind: 'fill', block: 'sandstone', box: [3, 2, 1, 3, 3, 1], replace: 'any' },
    { kind: 'fill', block: 'sandstone', box: [1, 2, 3, 1, 3, 3], replace: 'any' },
    { kind: 'fill', block: 'sandstone', box: [3, 2, 3, 3, 3, 3], replace: 'any' },
    { kind: 'fill', block: 'sandstone_slab', box: [1, 4, 1, 3, 4, 3], replace: 'any' },
    { kind: 'point', block: 'sandstone', box: [2, 4, 2, 2, 4, 2], replace: 'any' },
  ],
  placement: { attempts: 0.001, minY: 0, maxY: 0, surface: true, biomes: ['desert'] },
};

/**
 * Cabana de bruxa (doc 03 §7: "Swamp, raro — sobre estacas"). A bruxa não
 * existe ainda (M14); a cabana já dá o marco no pântano e os dois cogumelos
 * do ensopado para quem a achar.
 */
const WITCH_HUT: StructureDef = {
  name: 'witch_hut',
  size: [5, 8, 5],
  pieces: [
    // Estacas de tronco até o chão (ou o fundo do pântano).
    { kind: 'fill', block: 'oak_log', box: [0, -3, 0, 0, 1, 0], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [4, -3, 0, 4, 1, 0], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [0, -3, 4, 0, 1, 4], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [4, -3, 4, 4, 1, 4], replace: 'any' },
    // Casca de pinheiro, miolo vazio, telhado de laje por cima.
    { kind: 'hollow', block: 'spruce_planks', box: [0, 2, 0, 4, 6, 4], replace: 'any' },
    { kind: 'fill', block: 'air', box: [1, 3, 1, 3, 5, 3], replace: 'any' },
    { kind: 'fill', block: 'spruce_slab', box: [-1, 7, -1, 5, 7, 5], replace: 'air' },
    // Porta aberta e janelas.
    { kind: 'fill', block: 'air', box: [2, 3, 0, 2, 4, 0], replace: 'any' },
    { kind: 'point', block: 'glass', box: [0, 4, 2, 0, 4, 2], replace: 'any' },
    { kind: 'point', block: 'glass', box: [4, 4, 2, 4, 4, 2], replace: 'any' },
    // Mobília: bancada e os dois cogumelos no chão.
    { kind: 'point', block: 'crafting_table', box: [1, 3, 3, 1, 3, 3], replace: 'any' },
    { kind: 'point', block: 'brown_mushroom', box: [3, 3, 3, 3, 3, 3], replace: 'any' },
    { kind: 'point', block: 'red_mushroom', box: [3, 3, 1, 3, 3, 1], replace: 'any' },
  ],
  // A bruxa mora na cabana desde o M16.
  mobs: [{ at: [2, 3, 2], mob: 'witch' }],
  placement: { attempts: 0.004, minY: 0, maxY: 0, surface: true, biomes: ['swamp'] },
};

/**
 * Naufrágio (doc 03 §7: "Ocean, raro — barco quebrado com baú de loot"):
 * casco de tábua no fundo, mastro caído de pé pela metade e o baú na popa.
 * Só as paredes são escritas; o miolo continua água.
 */
const SHIPWRECK: StructureDef = {
  name: 'shipwreck',
  size: [9, 5, 3],
  pieces: [
    { kind: 'fill', block: 'oak_planks', box: [0, 0, 0, 8, 0, 2], replace: 'any' },
    { kind: 'walls', block: 'oak_planks', box: [0, 1, 0, 8, 1, 2], replace: 'any' },
    // Borda quebrada: só parte da segunda fiada ficou.
    { kind: 'fill', block: 'oak_planks', box: [0, 2, 0, 3, 2, 0], replace: 'any' },
    { kind: 'fill', block: 'oak_planks', box: [5, 2, 2, 8, 2, 2], replace: 'any' },
    { kind: 'fill', block: 'oak_log', box: [4, 1, 1, 4, 4, 1], replace: 'any' },
  ],
  chests: [{ at: [7, 1, 1], loot: 'shipwreck' }],
  placement: {
    attempts: 0.01, minY: 0, maxY: 0, surface: true, underwater: true, biomes: ['ocean'],
  },
};

export const STRUCTURES: readonly StructureDef[] = [
  DUNGEON, MINESHAFT, VILLAGE_HOUSE, VILLAGE_WELL, DESERT_WELL, WITCH_HUT, SHIPWRECK,
  // M9: as casas por ofício, no fim para não mexer no sal de quem vem antes.
  ...VILLAGE_HOUSES.map((house) => house.structure),
];

export function structureByName(name: string): StructureDef | undefined {
  return STRUCTURES.find((s) => s.name === name);
}

/** Lado da região de aldeia, em chunks (doc 03 §7: ~1 a cada 32×32). */
export const VILLAGE_REGION = 32;
/** Raio, em chunks, em que as casas da aldeia se espalham a partir do poço. */
export const VILLAGE_RADIUS = 2;
/**
 * Quantos aldeões uma aldeia tem (doc 03 §7). Sorteado por aldeia, e os
 * moradores vão para as casas de menor sorteio; casa sem morador continua de
 * pé — é a cama vaga que a aldeia tem para crescer.
 */
export const VILLAGERS_PER_VILLAGE: readonly [number, number] = [3, 8];
