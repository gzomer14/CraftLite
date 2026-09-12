/**
 * Tabela de itens (doc 05 §1–§2).
 *
 * No M2 só existe o necessário para quebrar e colocar: itens de bloco (gerados
 * automaticamente a partir da tabela de blocos) e as ferramentas, porque são
 * elas que entram na fórmula de tempo de quebra. Comida, receitas e armadura
 * entram no M4.
 */

import { BLOCKS, type ToolKind } from './blocks';

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
}

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

function register(def: ItemDef): void {
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
  { name: 'redstone', display: 'Pó de Redstone' },
  { name: 'lapis_lazuli', display: 'Lápis-lazúli' },
  { name: 'flint', display: 'Sílex' },
  { name: 'clay_ball', display: 'Bola de Argila' },
  { name: 'brick', display: 'Tijolo' },
  { name: 'glowstone_dust', display: 'Pó de Pedra Luminosa' },
  { name: 'snowball', display: 'Bola de Neve', maxStack: 16 },
  // vegetais e derivados
  { name: 'stick', display: 'Graveto', fuel: 100 },
  { name: 'bowl', display: 'Tigela' },
  { name: 'bucket', display: 'Balde', maxStack: 1 },
  { name: 'paper', display: 'Papel' },
  { name: 'book', display: 'Livro' },
  { name: 'wheat', display: 'Trigo' },
  { name: 'wheat_seeds', display: 'Sementes de Trigo' },
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
  { name: 'chicken', display: 'Frango Cru', food: { hunger: 2, saturation: 1.2, eatTicks: 32 } },
  { name: 'cooked_chicken', display: 'Frango Assado', food: { hunger: 6, saturation: 7.2, eatTicks: 32 } },
  { name: 'mutton', display: 'Carneiro Cru', food: { hunger: 2, saturation: 1.2, eatTicks: 32 } },
  { name: 'cooked_mutton', display: 'Carneiro Assado', food: { hunger: 6, saturation: 9.6, eatTicks: 32 } },
  { name: 'melon_slice', display: 'Fatia de Melancia', food: { hunger: 2, saturation: 1.2, eatTicks: 32 } },
  { name: 'rotten_flesh', display: 'Carne Podre', food: { hunger: 4, saturation: 0.8, eatTicks: 32 } },
  // --- drops de mob (M5). Apêndice: os ids acima não podem se mover. ------
  { name: 'bone', display: 'Osso' },
  { name: 'arrow', display: 'Flecha' },
  { name: 'slime_ball', display: 'Bola de Slime' },
  { name: 'ink_sac', display: 'Saco de Tinta' },
  { name: 'spider_eye', display: 'Olho de Aranha', food: { hunger: 2, saturation: 3.2, eatTicks: 32 } },
  { name: 'ender_pearl', display: 'Pérola do Fim', maxStack: 16 },
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
  { name: 'carrot', display: 'Cenoura', food: { hunger: 3, saturation: 3.6, eatTicks: 32 } },
  { name: 'potato', display: 'Batata', food: { hunger: 1, saturation: 0.6, eatTicks: 32 } },
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
  });
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
