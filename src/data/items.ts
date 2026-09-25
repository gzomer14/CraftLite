/**
 * Tabela de itens (doc 05 §1–§2).
 *
 * No M2 só existe o necessário para quebrar e colocar: itens de bloco (gerados
 * automaticamente a partir da tabela de blocos) e as ferramentas, porque são
 * elas que entram na fórmula de tempo de quebra. Comida, receitas e armadura
 * entram no M4.
 */

import { BLOCK_BY_NAME, BLOCKS, type ToolKind } from './blocks';
import { DYES, LEGACY_DYE_COUNT } from './dyes';
import type { FoodEffect } from './effects';
import { POTIONS } from './potions';

/** Id de bloco por nome, para os itens que colocam um bloco de outro nome. */
function blockIdByName(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco desconhecido no item: ${name}`);
  return def.id;
}

export interface ToolSpec {
  kind: ToolKind;
  tier: 1 | 2 | 3 | 4 | 5;
  speed: number;
}

/** Peça de armadura (doc 05 §3). */
export interface ArmorSpec {
  slot: 'head' | 'chest' | 'legs' | 'feet';
  defense: number;
  toughness: number;
}

/** Efeito de comer (doc 05 §4). */
export interface FoodSpec {
  hunger: number;
  saturation: number;
  /** Ticks segurando o botão para comer. 32 = 1,6 s. */
  eatTicks: number;
  /** Efeitos ao terminar de comer (doc 05 §4: carne podre, maçã dourada). */
  effects?: readonly FoodEffect[];
  /** Come mesmo de barriga cheia — a maçã dourada é remédio, não comida. */
  alwaysEdible?: boolean;
  /** Bebe em vez de comer (M16, poções): muda só o som. */
  drink?: boolean;
}

/** Item que se usa segurando o botão (doc 05 §1). */
export type ChargeKind = 'bow' | 'shield';

export interface ItemDef {
  id: number;
  name: string;
  display: string;
  /** Sprite no atlas. Itens de bloco usam a textura da face lateral. */
  tex: string;
  maxStack: number;
  durability?: number;
  /** blockId que este item coloca, se for um item de bloco. */
  placesBlock?: number;
  tool?: ToolSpec;
  armor?: ArmorSpec;
  food?: FoodSpec;
  /** Ticks de queima na fornalha (doc 05 §5). */
  fuel?: number;
  /** Dano de ataque somado ao material. */
  attack?: number;
  /** Ataques por segundo (doc 05 §2). A mão vazia faz 4.0. */
  attackSpeed?: number;
  /**
   * Como o item responde a segurar o botão (M6): o arco carrega e dispara ao
   * soltar; o escudo bloqueia enquanto estiver segurado.
   */
  charge?: ChargeKind;
  /** Ticks para o arco chegar à carga máxima. */
  chargeTicks?: number;
  /** blockId/entidade que o item coloca ao usar — o barco. */
  placesBoat?: boolean;
  /** Coloca um carrinho no trilho mirado (M7). */
  placesMinecart?: boolean;
  /** Acende portal de obsidiana ao ser usado (isqueiro, M7). */
  lights?: boolean;
  /**
   * O que sobra na mão depois de gastar o item: a tigela do ensopado, o balde
   * do balde de leite (2026-09-22). Vale para comer, para queimar na fornalha
   * e para a receita que o consome.
   */
  remainder?: string;
  /**
   * O que o item faz ao ser usado, quando não se deduz dos outros campos
   * (2026-09-22). O comportamento mora em `game/itemuse.ts`, indexado por este
   * nome; a tabela só diz qual.
   */
  use?: ItemUse;
  /**
   * Todos os usos do item, **em ordem de tentativa**: o declarado em `use` e os
   * que saem dos outros campos (`food` come, `charge` segura, `placesBoat`
   * põe barco…). Derivado no fim desta tabela — é o que `game/itemuse.ts` lê.
   * A cenoura, que planta **e** se come, é `['plant', 'eat']`.
   */
  uses: readonly ItemUse[];
}

/** Ações de uso de item que `game/itemuse.ts` sabe executar. */
export type ItemUse =
  | 'fill_bucket' | 'pour_water' | 'pour_lava' | 'drink_milk' | 'shears' | 'throw_egg'
  | 'throw_snowball' | 'dye_sheep' | 'eat' | 'charge' | 'place_boat' | 'place_minecart'
  | 'ignite' | 'till' | 'plant' | 'open_map' | 'fish'
  // M16: encher o frasco na água e arremessar o olho do ender.
  | 'fill_bottle' | 'throw_eye';

/**
 * Materiais de ferramenta (doc 05 §2).
 *
 * `damage` é o **bônus do material**, somado ao modificador do tipo. É o que
 * faz a coluna "dano espada" da tabela do doc fechar em 4/4/5/6/7: sem ele, a
 * espada de diamante bateria igual à de madeira e a progressão de combate
 * simplesmente não existiria.
 */
export const TOOL_MATERIALS: readonly {
  name: string; display: string; tier: 1 | 2 | 3 | 4 | 5;
  speed: number; durability: number; damage: number;
}[] = [
  { name: 'wooden', display: 'Madeira', tier: 1, speed: 2.0, durability: 59, damage: 0 },
  { name: 'golden', display: 'Ouro', tier: 1, speed: 12.0, durability: 32, damage: 0 },
  { name: 'stone', display: 'Pedra', tier: 2, speed: 4.0, durability: 131, damage: 1 },
  { name: 'iron', display: 'Ferro', tier: 3, speed: 6.0, durability: 250, damage: 2 },
  { name: 'diamond', display: 'Diamante', tier: 4, speed: 8.0, durability: 1561, damage: 3 },
];

const TOOL_KINDS: readonly { kind: ToolKind; suffix: string; display: string }[] = [
  { kind: 'pickaxe', suffix: 'pickaxe', display: 'Picareta' },
  { kind: 'axe', suffix: 'axe', display: 'Machado' },
  { kind: 'shovel', suffix: 'shovel', display: 'Pá' },
  { kind: 'sword', suffix: 'sword', display: 'Espada' },
];

/**
 * Itens de bloco ocupam os ids 1..1023, espelhando o blockId. Itens que não são
 * blocos começam em 1024 — assim `itemId === blockId` para tudo que é bloco, o
 * que evita uma tabela de tradução no caminho quente.
 */
export const ITEM_ID_BASE = 1024;

const items: ItemDef[] = [];

function register(input: Omit<ItemDef, 'uses'>): void {
  const def: ItemDef = { ...input, uses: [] };
  if (items[def.id] !== undefined) {
    throw new Error(`Id de item duplicado: ${def.id} (${def.name})`);
  }
  items[def.id] = def;
}

// Itens de bloco, derivados da tabela de blocos.
for (const block of BLOCKS) {
  if (block === undefined || block.id === 0) continue;
  if (block.itemless) continue; // água, lava e plantações não viram item
  const tex = typeof block.tex === 'string'
    ? block.tex
    : block.tex.side ?? block.tex.top ?? 'block/missing';
  register({
    id: block.id,
    name: block.name,
    display: block.display,
    tex,
    maxStack: 64,
    placesBlock: block.id,
    ...(block.fuel > 0 ? { fuel: block.fuel } : {}),
  });
}

// Ferramentas: 5 materiais × 4 tipos.
let nextId = ITEM_ID_BASE;
/** Modificador de dano por tipo de ferramenta (doc 05 §2). */
const TOOL_ATTACK: Record<string, number> = { sword: 4, axe: 6, pickaxe: 2, shovel: 2.5 };
/** Velocidade de ataque por tipo (doc 05 §2): machado bate forte e devagar. */
const TOOL_SPEED: Record<string, number> = { sword: 1.6, axe: 0.9, pickaxe: 1.2, shovel: 1.0 };
for (const material of TOOL_MATERIALS) {
  for (const kind of TOOL_KINDS) {
    register({
      id: nextId++,
      name: `${material.name}_${kind.suffix}`,
      display: `${kind.display} de ${material.display}`,
      tex: `item/${kind.suffix}`,
      maxStack: 1,
      durability: material.durability,
      tool: { kind: kind.kind, tier: material.tier, speed: material.speed },
      attack: material.damage + (TOOL_ATTACK[kind.suffix] ?? 1),
      attackSpeed: TOOL_SPEED[kind.suffix] ?? 4,
      // Ferramenta de madeira queima na fornalha (doc 05 §5).
      ...(material.name === 'wooden' ? { fuel: 200 } : {}),
    });
  }
}

// --- materiais, comida e utilidades (doc 05 §1, §4, §5) --------------------

interface SimpleItem {
  name: string;
  display: string;
  /** Sprite; quando ausente, deriva de `item/<name>`. */
  tex?: string;
  maxStack?: number;
  food?: FoodSpec;
  fuel?: number;
  /** Nome do bloco que o item coloca, quando não é o bloco de mesmo nome. */
  places?: string;
  /** Ação de uso (`game/itemuse.ts`). */
  use?: ItemUse;
}

const SIMPLE_ITEMS: SimpleItem[] = [
  // minerais e materiais
  { name: 'coal', display: 'Carvão', fuel: 1600 },
  { name: 'charcoal', display: 'Carvão Vegetal', fuel: 1600 },
  { name: 'raw_iron', display: 'Ferro Bruto' },
  { name: 'iron_ingot', display: 'Barra de Ferro' },
  { name: 'raw_copper', display: 'Cobre Bruto' },
  { name: 'copper_ingot', display: 'Barra de Cobre' },
  { name: 'raw_gold', display: 'Ouro Bruto' },
  { name: 'gold_ingot', display: 'Barra de Ouro' },
  { name: 'diamond', display: 'Diamante' },
  { name: 'emerald', display: 'Esmeralda' },
  // O pó é item de material **e** bloco: o `redstone_wire` é `itemless` e este
  // item é quem o coloca (doc 14 — M7).
  { name: 'redstone', display: 'Pó de Redstone', places: 'redstone_wire' },
  { name: 'lapis_lazuli', display: 'Lápis-lazúli' },
  { name: 'flint', display: 'Sílex' },
  { name: 'clay_ball', display: 'Bola de Argila' },
  { name: 'brick', display: 'Tijolo' },
  { name: 'glowstone_dust', display: 'Pó de Pedra Luminosa' },
  { name: 'snowball', display: 'Bola de Neve', maxStack: 16, use: 'throw_snowball' },
  // vegetais e derivados
  { name: 'stick', display: 'Graveto', fuel: 100 },
  { name: 'bowl', display: 'Tigela' },
  { name: 'bucket', display: 'Balde', maxStack: 1, use: 'fill_bucket' },
  { name: 'paper', display: 'Papel' },
  { name: 'book', display: 'Livro' },
  { name: 'wheat', display: 'Trigo' },
  { name: 'wheat_seeds', display: 'Sementes de Trigo', use: 'plant' },
  { name: 'string', display: 'Linha' },
  { name: 'feather', display: 'Pena' },
  { name: 'leather', display: 'Couro' },
  { name: 'gunpowder', display: 'Pólvora' },
  // comida (doc 05 §4)
  { name: 'apple', display: 'Maçã', food: { hunger: 4, saturation: 2.4, eatTicks: 32 } },
  { name: 'bread', display: 'Pão', food: { hunger: 5, saturation: 6.0, eatTicks: 32 } },
  { name: 'beef', display: 'Carne Crua', food: { hunger: 3, saturation: 1.8, eatTicks: 32 } },
  { name: 'cooked_beef', display: 'Bife', food: { hunger: 8, saturation: 12.8, eatTicks: 32 } },
  { name: 'porkchop', display: 'Porco Cru', food: { hunger: 3, saturation: 1.8, eatTicks: 32 } },
  { name: 'cooked_porkchop', display: 'Porco Assado', food: { hunger: 8, saturation: 12.8, eatTicks: 32 } },
  {
    name: 'chicken', display: 'Frango Cru',
    food: {
      hunger: 2, saturation: 1.2, eatTicks: 32,
      effects: [{ effect: 'hunger', level: 1, seconds: 30, chance: 0.3 }],
    },
  },
  { name: 'cooked_chicken', display: 'Frango Assado', food: { hunger: 6, saturation: 7.2, eatTicks: 32 } },
  { name: 'mutton', display: 'Carneiro Cru', food: { hunger: 2, saturation: 1.2, eatTicks: 32 } },
  { name: 'cooked_mutton', display: 'Carneiro Assado', food: { hunger: 6, saturation: 9.6, eatTicks: 32 } },
  { name: 'melon_slice', display: 'Fatia de Melancia', food: { hunger: 2, saturation: 1.2, eatTicks: 32 } },
  // Doc 05 §4: carne podre dá Fome em 80% das vezes, frango cru em 30% (os
  // efeitos só passaram a existir em 2026-09-22).
  {
    name: 'rotten_flesh', display: 'Carne Podre',
    food: {
      hunger: 4, saturation: 0.8, eatTicks: 32,
      effects: [{ effect: 'hunger', level: 1, seconds: 30, chance: 0.8 }],
    },
  },
  // --- drops de mob (M5). Apêndice: os ids acima não podem se mover. ------
  { name: 'bone', display: 'Osso' },
  { name: 'arrow', display: 'Flecha' },
  { name: 'slime_ball', display: 'Bola de Slime' },
  { name: 'ink_sac', display: 'Saco de Tinta' },
  { name: 'spider_eye', display: 'Olho de Aranha', food: { hunger: 2, saturation: 3.2, eatTicks: 32 } },
  { name: 'ender_pearl', display: 'Pérola do Fim', maxStack: 16 },
  // --- corantes (M8). Gerados da tabela de cores, no fim para não mover id. -
  // Só as oito do M8 aqui: as do M13 entram no fim da tabela, senão o id de
  // todo item registrado depois desta lista mudaria.
  ...DYES.slice(0, LEGACY_DYE_COUNT).map((dye) => ({
    name: `${dye.name}_dye`, display: `Corante ${dye.display}`, use: 'dye_sheep' as const,
  })),
];

for (const item of SIMPLE_ITEMS) {
  register({
    id: nextId++,
    name: item.name,
    display: item.display,
    tex: item.tex ?? `item/${item.name}`,
    maxStack: item.maxStack ?? 64,
    ...(item.food !== undefined ? { food: item.food } : {}),
    ...(item.fuel !== undefined ? { fuel: item.fuel } : {}),
    ...(item.places !== undefined ? { placesBlock: blockIdByName(item.places) } : {}),
    ...(item.use !== undefined ? { use: item.use } : {}),
  });
}

// --- armadura (doc 05 §3) ---------------------------------------------------

/**
 * Materiais de armadura. `defense` é por peça, na ordem capacete/peitoral/
 * calça/bota, e soma os pontos totais da tabela do doc (couro 7, ouro 11,
 * ferro 15, diamante 20).
 *
 * A durabilidade vem do peitoral do doc dividida pelo fator de cada peça — é
 * assim que a bota dura menos que o peitoral do mesmo material.
 */
export const ARMOR_MATERIALS: readonly {
  name: string; display: string; defense: readonly [number, number, number, number];
  toughness: number; base: number;
}[] = [
  { name: 'leather', display: 'Couro', defense: [1, 3, 2, 1], toughness: 0, base: 5 },
  { name: 'golden', display: 'Ouro', defense: [2, 5, 3, 1], toughness: 0, base: 7 },
  { name: 'iron', display: 'Ferro', defense: [2, 6, 5, 2], toughness: 0, base: 15 },
  { name: 'diamond', display: 'Diamante', defense: [3, 8, 6, 3], toughness: 2, base: 33 },
];

const ARMOR_PIECES: readonly {
  slot: ArmorSpec['slot']; suffix: string; display: string; factor: number;
}[] = [
  { slot: 'head', suffix: 'helmet', display: 'Capacete', factor: 11 },
  { slot: 'chest', suffix: 'chestplate', display: 'Peitoral', factor: 16 },
  { slot: 'legs', suffix: 'leggings', display: 'Calça', factor: 15 },
  { slot: 'feet', suffix: 'boots', display: 'Bota', factor: 13 },
];

for (const material of ARMOR_MATERIALS) {
  for (let i = 0; i < ARMOR_PIECES.length; i++) {
    const piece = ARMOR_PIECES[i];
    register({
      id: nextId++,
      name: `${material.name}_${piece.suffix}`,
      display: `${piece.display} de ${material.display}`,
      tex: `item/${piece.suffix}`,
      maxStack: 1,
      durability: material.base * piece.factor,
      armor: { slot: piece.slot, defense: material.defense[i], toughness: material.toughness },
    });
  }
}

// --- apêndice do M6: enxadas e a comida da roça -----------------------------
// Entram **no fim** porque o id de item vai para o save: encaixar a enxada no
// laço de ferramentas lá em cima empurraria todos os ids seguintes.

for (const material of TOOL_MATERIALS) {
  register({
    id: nextId++,
    name: `${material.name}_hoe`,
    display: `Enxada de ${material.display}`,
    tex: 'item/hoe',
    maxStack: 1,
    durability: material.durability,
    tool: { kind: 'hoe', tier: material.tier, speed: material.speed },
    // Doc 05 §2: a enxada não tem bônus de dano — ela ara, não briga.
    attack: material.damage,
    attackSpeed: 1.0,
    ...(material.name === 'wooden' ? { fuel: 200 } : {}),
  });
}

const FARM_ITEMS: SimpleItem[] = [
  { name: 'carrot', display: 'Cenoura', food: { hunger: 3, saturation: 3.6, eatTicks: 32 }, use: 'plant' },
  { name: 'potato', display: 'Batata', food: { hunger: 1, saturation: 0.6, eatTicks: 32 }, use: 'plant' },
  { name: 'baked_potato', display: 'Batata Assada', food: { hunger: 5, saturation: 6.0, eatTicks: 32 } },
];

// --- apêndice do M6: arco, escudo e barco -----------------------------------
// Também no fim, pelo mesmo motivo das enxadas: id de item vai para o save.

register({
  id: nextId++,
  name: 'bow',
  display: 'Arco',
  tex: 'item/bow',
  maxStack: 1,
  durability: 384,
  charge: 'bow',
  // 20 ticks = 1 s até a carga cheia (doc 05 §1 e a referência do gênero).
  chargeTicks: 20,
  attack: 1,
  attackSpeed: 1,
});

register({
  id: nextId++,
  name: 'shield',
  display: 'Escudo',
  tex: 'item/shield',
  maxStack: 1,
  durability: 336,
  charge: 'shield',
  attack: 1,
  attackSpeed: 1,
});

register({
  id: nextId++,
  name: 'boat',
  display: 'Barco',
  tex: 'item/boat',
  maxStack: 1,
  placesBoat: true,
  fuel: 1200,
});

for (const item of FARM_ITEMS) {
  register({
    id: nextId++,
    name: item.name,
    display: item.display,
    tex: `item/${item.name}`,
    maxStack: 64,
    ...(item.food !== undefined ? { food: item.food } : {}),
    ...(item.use !== undefined ? { use: item.use } : {}),
  });
}

// --- apêndice do M7: Nether -------------------------------------------------
// No fim da fila, como todo apêndice: id de item vai para o save.

for (const item of [
  { name: 'nether_quartz', display: 'Quartzo do Nether' },
  { name: 'nether_brick', display: 'Tijolo do Nether' },
] as const) {
  register({
    id: nextId++, name: item.name, display: item.display,
    tex: `item/${item.name}`, maxStack: 64,
  });
}

/**
 * Isqueiro: a única forma de acender um portal.
 *
 * **Desvio consciente do gênero:** ele não põe fogo em bloco nenhum. Fogo que
 * se espalha exigiria um sistema de propagação com orçamento próprio, e o que o
 * M7 precisa dele é abrir o portal — o resto é escopo que o aparelho-alvo não
 * pediu. A durabilidade é a da referência.
 */
register({
  id: nextId++,
  name: 'minecart',
  display: 'Carrinho de Mina',
  tex: 'item/minecart',
  maxStack: 1,
  placesMinecart: true,
});

register({
  id: nextId++,
  name: 'flint_and_steel',
  display: 'Isqueiro',
  tex: 'item/flint_and_steel',
  maxStack: 1,
  durability: 64,
  lights: true,
});

// --- apêndice de 2026-09-22: o que os docs 05 e 07 pediam e não existia -----
// No fim, como todo apêndice. `use` aponta para `game/itemuse.ts`.

interface AppendixItem {
  name: string; display: string; maxStack?: number; food?: FoodSpec; remainder?: string;
  use?: ItemUse; fuel?: number;
}

for (const item of [
  {
    name: 'golden_apple', display: 'Maçã Dourada',
    food: {
      hunger: 4, saturation: 9.6, eatTicks: 32, alwaysEdible: true,
      effects: [
        { effect: 'regeneration', level: 2, seconds: 5 },
        { effect: 'absorption', level: 1, seconds: 120 },
      ],
    },
  },
  {
    name: 'mushroom_stew', display: 'Ensopado de Cogumelo', maxStack: 1, remainder: 'bowl',
    food: { hunger: 6, saturation: 7.2, eatTicks: 32 },
  },
  { name: 'cookie', display: 'Biscoito', food: { hunger: 2, saturation: 0.4, eatTicks: 16 } },
  { name: 'sugar', display: 'Açúcar' },
  { name: 'egg', display: 'Ovo', maxStack: 16, use: 'throw_egg' },
  { name: 'water_bucket', display: 'Balde de Água', maxStack: 1, remainder: 'bucket', use: 'pour_water' },
  {
    name: 'lava_bucket', display: 'Balde de Lava', maxStack: 1, remainder: 'bucket',
    use: 'pour_lava', fuel: 20000,
  },
  { name: 'milk_bucket', display: 'Balde de Leite', maxStack: 1, remainder: 'bucket', use: 'drink_milk' },
] satisfies AppendixItem[]) {
  register({
    id: nextId++,
    name: item.name,
    display: item.display,
    tex: `item/${item.name}`,
    maxStack: item.maxStack ?? 64,
    ...(item.food !== undefined ? { food: item.food } : {}),
    ...(item.remainder !== undefined ? { remainder: item.remainder } : {}),
    ...(item.use !== undefined ? { use: item.use } : {}),
    ...(item.fuel !== undefined ? { fuel: item.fuel } : {}),
  });
}

/**
 * Tesoura (doc 05 §6.3). O tipo de ferramenta `shears` existia desde o M1 —
 * folha e lã o pedem — e o item não: a folha só saía na mão, lenta, e a lã
 * só saía matando a ovelha.
 */
register({
  id: nextId++,
  name: 'shears',
  display: 'Tesoura',
  tex: 'item/shears',
  maxStack: 1,
  durability: 238,
  tool: { kind: 'shears', tier: 1, speed: 5 },
  use: 'shears',
});

// --- apêndice do M13: os oito corantes novos, no fim da fila de ids --------
for (const dye of DYES.slice(LEGACY_DYE_COUNT)) {
  register({
    id: nextId++, name: `${dye.name}_dye`, display: `Corante ${dye.display}`,
    tex: `item/${dye.name}_dye`, maxStack: 64, use: 'dye_sheep',
  });
}

// --- apêndice do M10: saber onde se está, no fim da fila de ids -------------
// A bússola aponta para o nascimento do mundo e o relógio mostra o céu; os dois
// giram no desenho (`render/itemsprites.ts`, quadros de mostrador) e enlouquecem
// no Nether. O mapa abre a tela do mapa explorado (`ui/screens/mapscreen.ts`).
for (const item of [
  { name: 'compass', display: 'Bússola' },
  { name: 'clock', display: 'Relógio' },
  { name: 'map', display: 'Mapa', use: 'open_map' },
] satisfies AppendixItem[]) {
  register({
    id: nextId++,
    name: item.name,
    display: item.display,
    tex: `item/${item.name}`,
    maxStack: 64,
    ...(item.use !== undefined ? { use: item.use } : {}),
  });
}

// --- apêndice do M14: selva e pesca, no fim da fila de ids -------------------
// O cacau cai da folha da selva e volta o biscoito à receita do doc. O
// bacalhau é o do doc 05 §4 (cozido 5 / 6,0; cru, a linha do gênero), e a
// vara (`game/fishing.ts`) é a comida renovável que não depende de fazenda.
for (const item of [
  { name: 'cocoa_beans', display: 'Sementes de Cacau' },
  { name: 'cod', display: 'Bacalhau Cru', food: { hunger: 2, saturation: 0.4, eatTicks: 32 } },
  { name: 'cooked_cod', display: 'Bacalhau Assado', food: { hunger: 5, saturation: 6, eatTicks: 32 } },
] satisfies AppendixItem[]) {
  register({
    id: nextId++,
    name: item.name,
    display: item.display,
    tex: `item/${item.name}`,
    maxStack: 64,
    ...(item.food !== undefined ? { food: item.food } : {}),
  });
}
register({
  id: nextId++,
  name: 'fishing_rod',
  display: 'Vara de Pesca',
  tex: 'item/fishing_rod',
  maxStack: 1,
  durability: 64,
  use: 'fish',
});

// --- apêndice do M15: o livro que a mesa encanta e a bigorna consome ---------
// Sempre no fim da fila: o id de item vai para o save.
register({
  id: nextId++,
  name: 'enchanted_book',
  display: 'Livro Encantado',
  tex: 'item/enchanted_book',
  maxStack: 1,
});

// --- apêndice do M16: um fim para a jornada, no fim da fila de ids -----------
// Vara e pó de blaze saem da fortaleza do Nether; a verruga, do jardim dela.
// O olho do ender (pérola + pó) aponta a fortaleza da superfície. O resto é
// ingrediente de poção (`data/potions.ts`).
for (const item of [
  { name: 'blaze_rod', display: 'Vara de Blaze', fuel: 2400 },
  { name: 'blaze_powder', display: 'Pó de Blaze' },
  { name: 'nether_wart', display: 'Verruga do Nether', use: 'plant' },
  { name: 'glass_bottle', display: 'Frasco de Vidro', use: 'fill_bottle' },
  { name: 'ender_eye', display: 'Olho do Ender', use: 'throw_eye' },
  { name: 'magma_cream', display: 'Creme de Magma' },
  { name: 'gold_nugget', display: 'Pepita de Ouro' },
  { name: 'glistering_melon_slice', display: 'Fatia de Melancia Reluzente' },
  {
    name: 'golden_carrot', display: 'Cenoura Dourada',
    food: { hunger: 6, saturation: 14.4, eatTicks: 32 },
  },
  { name: 'fermented_spider_eye', display: 'Olho de Aranha Fermentado' },
] satisfies AppendixItem[]) {
  register({
    id: nextId++,
    name: item.name,
    display: item.display,
    tex: `item/${item.name}`,
    maxStack: 64,
    ...(item.food !== undefined ? { food: item.food } : {}),
    ...(item.use !== undefined ? { use: item.use } : {}),
    ...(item.fuel !== undefined ? { fuel: item.fuel } : {}),
  });
}
// As poções, na ordem da tabela: bebe-se como se come, e sobra o frasco.
for (const potion of POTIONS) {
  const effects: FoodEffect[] = potion.effect === undefined
    ? []
    : [{ effect: potion.effect, level: potion.level ?? 1, seconds: potion.seconds ?? 0 }];
  register({
    id: nextId++,
    name: potion.name,
    display: potion.display,
    tex: `item/${potion.name}`,
    maxStack: 1,
    remainder: 'glass_bottle',
    food: { hunger: 0, saturation: 0, eatTicks: 32, alwaysEdible: true, drink: true, effects },
  });
}

/**
 * Usos de cada item, em ordem de tentativa (ver `ItemDef.uses`).
 *
 * O declarado vem primeiro: a cenoura tenta plantar antes de comer, porque
 * mirando terra arada é plantar que se quer. Depois, o que os campos dizem.
 */
for (const def of items) {
  if (def === undefined) continue;
  const uses: ItemUse[] = [];
  if (def.use !== undefined) uses.push(def.use);
  if (def.tool?.kind === 'hoe') uses.push('till');
  if (def.placesMinecart === true) uses.push('place_minecart');
  if (def.placesBoat === true) uses.push('place_boat');
  if (def.charge !== undefined) uses.push('charge');
  if (def.lights === true) uses.push('ignite');
  if (def.food !== undefined) uses.push('eat');
  def.uses = uses;
}

export const ITEMS: readonly (ItemDef | undefined)[] = items;

export const ITEM_BY_NAME: ReadonlyMap<string, ItemDef> = new Map(
  items.filter((i): i is ItemDef => i !== undefined).map((i) => [i.name, i]),
);

export function itemDef(id: number): ItemDef | undefined {
  return items[id];
}

/** Uma pilha no inventário. `null` representa slot vazio (doc 05 §1). */
export interface ItemStack {
  item: number;
  count: number;
  /** Dano acumulado, para itens com durabilidade. */
  damage: number;
  /**
   * Encantamentos empacotados: 3 bits por encantamento, indexados pelo id da
   * tabela de `data/enchants.ts`. Ausente ou 0 = pilha comum. Ver
   * `game/enchanting.ts` para a razão de ser um inteiro e não um objeto.
   */
  ench?: number;
  /**
   * Nome dado na bigorna (M15). Só em item que não empilha — ver
   * `game/anvil.ts` —, então juntar pilhas nunca precisa escolher um nome.
   */
  name?: string;
}

export function makeStack(item: number, count = 1): ItemStack {
  return { item, count, damage: 0 };
}

export function stackTool(stack: ItemStack | null): ToolSpec | undefined {
  if (stack === null) return undefined;
  return itemDef(stack.item)?.tool;
}

/** Limite de empilhamento de um item; 64 se desconhecido. */
export function maxStackOf(item: number): number {
  return itemDef(item)?.maxStack ?? 64;
}

/** Resolve um nome de item para o id, com erro claro se não existir. */
export function itemId(name: string): number {
  const def = ITEM_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Item desconhecido: ${name}`);
  return def.id;
}
