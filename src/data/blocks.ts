/**
 * Tabela declarativa de blocos (doc 04).
 *
 * **Os ids são estáveis e vão para o save — nunca reordene esta tabela.**
 * Adicionar um bloco é acrescentar uma entrada; nada no motor tem um `switch`
 * por tipo de bloco.
 *
 * O `blockState` é um uint16: bits 0..9 = id do bloco, bits 10..15 = estado
 * (rotação, nível de fluido, idade de plantação…). Ver doc 04 §2.5.
 */

export type Face = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';

export type BlockShape =
  | 'cube' | 'cross' | 'slab' | 'stairs' | 'fence' | 'fence_gate' | 'door' | 'trapdoor'
  | 'torch' | 'carpet' | 'flat' | 'liquid' | 'pane' | 'ladder' | 'sign' | 'painting'
  | 'lever' | 'button' | 'plate' | 'repeater' | 'piston' | 'piston_head' | 'rail' | 'bed'
  | 'none';

/**
 * De que o bloco precisa para continuar existindo (M7).
 *
 * `below` = um bloco opaco embaixo (pó, placa de pressão, repetidor, tocha de
 * chão); `mount` = o bloco na direção em que ele está encaixado, nos bits 0..2
 * do estado (alavanca, botão). Quem perde o apoio cai como item — a checagem é
 * de `world/redstone.ts`, que já visita essas posições.
 */
export type SupportKind = 'none' | 'below' | 'mount';

/**
 * Bloco que ocupa **duas células** (M8): porta e cama.
 *
 * As duas metades são dois ids, não um id com bit de "sou a metade de cima".
 * O motivo é prático: cada metade tem textura própria — folha de cima e folha
 * de baixo da porta, travesseiro e pé da cama —, e textura por face é uma
 * coluna da tabela indexada por **id**. Com um bit de estado seria preciso
 * levar o estado até `mesh/blockinfo.ts`, que hoje não o vê.
 *
 * Quem cuida da consistência das duas células é `world/multiblock.ts`: ele
 * ouve `world.setBlock` e some com a metade órfã. Como **toda** mutação de
 * voxel passa por lá (regra nº 3 do projeto), isso vale para o jogador, para a
 * explosão, para o fogo e para o mob que quebra bloco, sem nenhum deles saber
 * que existe porta de dois blocos.
 */
export interface MultiSpec {
  /** Nome do bloco da outra metade. */
  other: string;
  /** Onde a outra metade fica: acima, abaixo, ou na direção dos bits 0..1. */
  at: 'above' | 'below' | 'facing';
  /** true na metade que o item coloca, que dropa e que responde ao clique. */
  root: boolean;
}

export type ToolKind = 'none' | 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'sword';
export type TintKind = 'none' | 'grass' | 'foliage' | 'water';
export type SoundKind =
  | 'stone' | 'wood' | 'gravel' | 'grass' | 'sand' | 'glass' | 'metal' | 'cloth' | 'snow';

export interface BlockDef {
  id: number;
  name: string;
  display: string;
  /** Textura por face; string única = todas iguais. */
  tex: string | { top?: string; bottom?: string; side?: string };
  shape: BlockShape;
  solid: boolean;
  /** Bloqueia luz totalmente e esconde a face do vizinho. */
  opaque: boolean;
  lightAttenuation: number;
  emission: number;
  /** Segundos-base para quebrar; −1 = inquebrável. */
  hardness: number;
  tool: ToolKind;
  minTier: 0 | 1 | 2 | 3 | 4;
  requiresTool: boolean;
  flammable: number;
  tint: TintKind;
  gravity: boolean;
  replaceable: boolean;
  slipperiness: number;
  sound: SoundKind;
  /**
   * Textura por valor de estado (plantação por idade). Vazio = a textura é a
   * mesma em qualquer estado. O mesher indexa por `min(estado, stages.length-1)`.
   */
  stages: readonly string[];
  /** true = não existe item deste bloco (água, lava, plantação). */
  itemless: boolean;
  /** Apoio de que o bloco precisa para ficar em pé (doc 04 §3, M7). */
  support: SupportKind;
  /** Duas células em vez de uma (M8). `null` = bloco comum. */
  multi: MultiSpec | null;
  /**
   * Desenhado no passe translúcido, com mistura alfa (M7).
   *
   * Até o M6 só a água era translúcida, e `mesh/blockinfo.ts` a reconhecia pelo
   * id. O portal precisa do mesmo passe, e reconhecer **dois** ids por nome
   * seria o começo de uma lista — daí o campo.
   */
  translucent: boolean;
}

/** Campos com valor padrão — a tabela só declara o que foge do comum. */
type BlockSpec = Partial<BlockDef> & Pick<BlockDef, 'id' | 'name' | 'display'>;

const DEFAULTS: Omit<BlockDef, 'id' | 'name' | 'display'> = {
  tex: 'block/missing',
  shape: 'cube',
  solid: true,
  opaque: true,
  lightAttenuation: 15,
  emission: 0,
  hardness: 1,
  tool: 'none',
  minTier: 0,
  requiresTool: false,
  flammable: 0,
  tint: 'none',
  gravity: false,
  replaceable: false,
  slipperiness: 0.6,
  sound: 'stone',
  stages: [],
  itemless: false,
  support: 'none',
  multi: null,
  translucent: false,
};

/**
 * Atalhos para as combinações mais repetidas da tabela.
 *
 * **Correção sobre o doc 04 §2.1:** lá a pedra aparece com `minTier: 2`
 * (picareta de pedra). Isso torna o jogo impossível de começar — sem minerar
 * pedra com picareta de madeira não há pedregulho, e sem pedregulho não há
 * picareta de pedra. O tier correto é 1, como na referência do gênero.
 */
const rock = (tool: ToolKind = 'pickaxe', minTier: 0 | 1 | 2 | 3 | 4 = 1): Partial<BlockDef> =>
  ({ tool, minTier, requiresTool: true, sound: 'stone' });
const ore = (): Partial<BlockDef> =>
  ({ hardness: 3, tool: 'pickaxe', requiresTool: true, sound: 'stone' });
const soil = (): Partial<BlockDef> => ({ tool: 'shovel', sound: 'gravel' });
const wood = (): Partial<BlockDef> => ({ tool: 'axe', sound: 'wood', flammable: 5 });
const plant = (): Partial<BlockDef> => ({
  shape: 'cross', solid: false, opaque: false, lightAttenuation: 0,
  hardness: 0, replaceable: true, sound: 'grass',
});

/**
 * Plantação: cruz sem colisão que só existe sobre terra arada e guarda a idade
 * 0..7 nos bits de estado. As texturas vêm de `stages`, uma por idade.
 */
const crop = (stages: readonly string[]): Partial<BlockDef> => ({
  shape: 'cross', solid: false, opaque: false, lightAttenuation: 0,
  hardness: 0, sound: 'grass', itemless: true, stages,
  tex: stages[stages.length - 1],
});

const SPECS: BlockSpec[] = [
  // --- 0..21 naturais / terreno ------------------------------------------
  { id: 0, name: 'air', display: 'Ar', shape: 'none', solid: false, opaque: false,
    lightAttenuation: 0, hardness: -1, replaceable: true },
  { id: 1, name: 'stone', display: 'Pedra', tex: 'block/stone', hardness: 1.5, ...rock() },
  { id: 2, name: 'granite', display: 'Granito', tex: 'block/granite', hardness: 1.5, ...rock() },
  { id: 3, name: 'diorite', display: 'Diorito', tex: 'block/diorite', hardness: 1.5, ...rock() },
  { id: 4, name: 'andesite', display: 'Andesito', tex: 'block/andesite', hardness: 1.5, ...rock() },
  { id: 5, name: 'cobblestone', display: 'Pedregulho', tex: 'block/cobblestone', hardness: 2, ...rock() },
  { id: 6, name: 'dirt', display: 'Terra', tex: 'block/dirt', hardness: 0.5, ...soil() },
  { id: 7, name: 'coarse_dirt', display: 'Terra Batida', tex: 'block/coarse_dirt', hardness: 0.5, ...soil() },
  { id: 8, name: 'grass_block', display: 'Bloco de Grama', hardness: 0.6, ...soil(), sound: 'grass',
    tex: { top: 'block/grass_top', side: 'block/dirt', bottom: 'block/dirt' }, tint: 'grass' },
  { id: 9, name: 'podzol', display: 'Podzol', hardness: 0.5, ...soil(),
    tex: { top: 'block/podzol_top', side: 'block/dirt', bottom: 'block/dirt' } },
  { id: 10, name: 'sand', display: 'Areia', tex: 'block/sand', hardness: 0.5, gravity: true,
    ...soil(), sound: 'sand' },
  { id: 11, name: 'red_sand', display: 'Areia Vermelha', tex: 'block/red_sand', hardness: 0.5,
    gravity: true, ...soil(), sound: 'sand' },
  { id: 12, name: 'gravel', display: 'Cascalho', tex: 'block/gravel', hardness: 0.6,
    gravity: true, ...soil() },
  { id: 13, name: 'sandstone', display: 'Arenito', hardness: 0.8, ...rock(),
    tex: { top: 'block/sandstone_top', side: 'block/sandstone_side', bottom: 'block/sandstone_top' } },
  { id: 14, name: 'clay', display: 'Argila', tex: 'block/clay', hardness: 0.6, ...soil() },
  { id: 15, name: 'snow_block', display: 'Bloco de Neve', tex: 'block/snow', hardness: 0.2,
    ...soil(), sound: 'snow' },
  { id: 16, name: 'snow_layer', display: 'Camada de Neve', tex: 'block/snow', shape: 'carpet',
    solid: false, opaque: false, lightAttenuation: 0, hardness: 0.1, ...soil(), sound: 'snow' },
  { id: 17, name: 'ice', display: 'Gelo', tex: 'block/ice', hardness: 0.5, opaque: false,
    lightAttenuation: 3, slipperiness: 0.98, tool: 'pickaxe', sound: 'glass' },
  { id: 18, name: 'bedrock', display: 'Rocha-mãe', tex: 'block/bedrock', hardness: -1 },
  { id: 19, name: 'obsidian', display: 'Obsidiana', tex: 'block/obsidian', hardness: 50,
    tool: 'pickaxe', minTier: 4, requiresTool: true },
  { id: 20, name: 'water', display: 'Água', tex: 'block/water', shape: 'liquid', solid: false,
    opaque: false, lightAttenuation: 1, hardness: 100, tint: 'water', replaceable: true },
  { id: 21, name: 'lava', display: 'Lava', tex: 'block/lava', shape: 'liquid', solid: false,
    opaque: false, lightAttenuation: 1, emission: 15, hardness: 100, replaceable: true },

  // --- 22..29 minérios ----------------------------------------------------
  { id: 22, name: 'coal_ore', display: 'Minério de Carvão', tex: 'block/coal_ore', ...ore(), minTier: 1 },
  { id: 23, name: 'iron_ore', display: 'Minério de Ferro', tex: 'block/iron_ore', ...ore(), minTier: 2 },
  { id: 24, name: 'copper_ore', display: 'Minério de Cobre', tex: 'block/copper_ore', ...ore(), minTier: 2 },
  { id: 25, name: 'gold_ore', display: 'Minério de Ouro', tex: 'block/gold_ore', ...ore(), minTier: 3 },
  { id: 26, name: 'redstone_ore', display: 'Minério de Redstone', tex: 'block/redstone_ore', ...ore(), minTier: 3 },
  { id: 27, name: 'lapis_ore', display: 'Minério de Lápis', tex: 'block/lapis_ore', ...ore(), minTier: 2 },
  { id: 28, name: 'diamond_ore', display: 'Minério de Diamante', tex: 'block/diamond_ore', ...ore(), minTier: 3 },
  { id: 29, name: 'emerald_ore', display: 'Minério de Esmeralda', tex: 'block/emerald_ore', ...ore(), minTier: 3 },

  // --- 30..51 madeira e vegetação ----------------------------------------
  { id: 30, name: 'oak_log', display: 'Tronco de Carvalho', hardness: 2, ...wood(),
    tex: { top: 'block/oak_log_top', side: 'block/oak_log_side', bottom: 'block/oak_log_top' } },
  { id: 31, name: 'birch_log', display: 'Tronco de Bétula', hardness: 2, ...wood(),
    tex: { top: 'block/birch_log_top', side: 'block/birch_log_side', bottom: 'block/birch_log_top' } },
  { id: 32, name: 'spruce_log', display: 'Tronco de Pinheiro', hardness: 2, ...wood(),
    tex: { top: 'block/spruce_log_top', side: 'block/spruce_log_side', bottom: 'block/spruce_log_top' } },
  { id: 33, name: 'acacia_log', display: 'Tronco de Acácia', hardness: 2, ...wood(),
    tex: { top: 'block/oak_log_top', side: 'block/oak_log_side', bottom: 'block/oak_log_top' } },
  { id: 34, name: 'oak_planks', display: 'Tábuas de Carvalho', tex: 'block/oak_planks', hardness: 2, ...wood() },
  { id: 35, name: 'birch_planks', display: 'Tábuas de Bétula', tex: 'block/birch_planks', hardness: 2, ...wood() },
  { id: 36, name: 'spruce_planks', display: 'Tábuas de Pinheiro', tex: 'block/spruce_planks', hardness: 2, ...wood() },
  { id: 37, name: 'acacia_planks', display: 'Tábuas de Acácia', tex: 'block/oak_planks', hardness: 2, ...wood() },
  // Folhas: opaque=false para não esconder a face do vizinho, mas atenuam luz.
  { id: 38, name: 'oak_leaves', display: 'Folhas de Carvalho', tex: 'block/oak_leaves',
    hardness: 0.2, opaque: false, lightAttenuation: 1, tint: 'foliage', tool: 'shears',
    flammable: 30, sound: 'grass' },
  { id: 39, name: 'birch_leaves', display: 'Folhas de Bétula', tex: 'block/oak_leaves',
    hardness: 0.2, opaque: false, lightAttenuation: 1, tint: 'foliage', tool: 'shears',
    flammable: 30, sound: 'grass' },
  { id: 40, name: 'spruce_leaves', display: 'Folhas de Pinheiro', tex: 'block/spruce_leaves',
    hardness: 0.2, opaque: false, lightAttenuation: 1, tint: 'foliage', tool: 'shears',
    flammable: 30, sound: 'grass' },
  { id: 41, name: 'oak_sapling', display: 'Muda de Carvalho', tex: 'block/oak_leaves', ...plant(), tint: 'foliage' },
  { id: 42, name: 'tall_grass', display: 'Grama Alta', tex: 'block/tall_grass', ...plant(), tint: 'grass' },
  { id: 43, name: 'fern', display: 'Samambaia', tex: 'block/tall_grass', ...plant(), tint: 'foliage' },
  { id: 44, name: 'dandelion', display: 'Dente-de-leão', tex: 'block/dandelion', ...plant() },
  { id: 45, name: 'poppy', display: 'Papoula', tex: 'block/poppy', ...plant() },
  { id: 46, name: 'cactus', display: 'Cacto', hardness: 0.4, opaque: false, lightAttenuation: 0,
    sound: 'cloth', tex: { top: 'block/cactus_top', side: 'block/cactus_side', bottom: 'block/cactus_top' } },
  { id: 47, name: 'sugar_cane', display: 'Cana-de-açúcar', tex: 'block/tall_grass', ...plant(), tint: 'foliage' },
  { id: 48, name: 'dead_bush', display: 'Arbusto Morto', tex: 'block/tall_grass', ...plant() },
  { id: 49, name: 'vine', display: 'Trepadeira', tex: 'block/oak_leaves', ...plant(), tint: 'foliage' },
  { id: 50, name: 'pumpkin', display: 'Abóbora', tex: 'block/oak_planks', hardness: 1, ...wood() },
  { id: 51, name: 'melon', display: 'Melancia', tex: 'block/oak_planks', hardness: 1, ...wood() },

  // --- 52..68 construídos / funcionais ------------------------------------
  { id: 52, name: 'crafting_table', display: 'Bancada', hardness: 2.5, ...wood(),
    tex: { top: 'block/crafting_table_top', side: 'block/crafting_table_side', bottom: 'block/oak_planks' } },
  { id: 53, name: 'furnace', display: 'Fornalha', hardness: 3.5, ...rock(),
    tex: { top: 'block/furnace_side', side: 'block/furnace_side', bottom: 'block/furnace_side' } },
  { id: 54, name: 'chest', display: 'Baú', hardness: 2.5, ...wood(), opaque: false,
    tex: { top: 'block/chest_top', side: 'block/chest_side', bottom: 'block/chest_top' } },
  // A tocha gruda no chão ou na parede (`support: 'mount'`), como alavanca e
  // botão: quem mina o apoio derruba a tocha.
  { id: 55, name: 'torch', display: 'Tocha', shape: 'torch', solid: false,
    tex: { top: 'block/torch_top', side: 'block/torch', bottom: 'block/torch_bottom' },
    opaque: false, lightAttenuation: 0, emission: 14, hardness: 0, sound: 'wood',
    support: 'mount' },
  { id: 56, name: 'glass', display: 'Vidro', tex: 'block/glass', hardness: 0.3, opaque: false,
    lightAttenuation: 0, sound: 'glass' },
  { id: 57, name: 'glowstone', display: 'Pedra Luminosa', tex: 'block/glowstone', hardness: 0.3,
    emission: 15, tool: 'pickaxe', sound: 'glass' },
  { id: 58, name: 'bookshelf', display: 'Estante', tex: 'block/bookshelf', hardness: 1.5, ...wood() },
  { id: 59, name: 'ladder', display: 'Escada de Mão', tex: 'block/ladder', shape: 'ladder',
    hardness: 0.4, solid: false, opaque: false, lightAttenuation: 0, ...wood() },
  { id: 60, name: 'oak_door', display: 'Porta de Carvalho', tex: 'block/oak_door', shape: 'door',
    hardness: 3, opaque: false, lightAttenuation: 0, ...wood(),
    multi: { other: 'oak_door_top', at: 'above', root: true } },
  { id: 61, name: 'oak_fence', display: 'Cerca de Carvalho', tex: 'block/oak_planks', shape: 'fence',
    hardness: 2, opaque: false, lightAttenuation: 0, ...wood() },
  // Cama: o **pé**. A cabeceira é `bed_head`, um bloco à frente (ver `MultiSpec`).
  // Sólida de propósito, com 9/16 de altura: subir na cama é parte do móvel.
  { id: 62, name: 'bed', display: 'Cama', hardness: 0.2, shape: 'bed',
    opaque: false, lightAttenuation: 0, sound: 'cloth',
    tex: { top: 'block/bed_foot_top', side: 'block/bed_side', bottom: 'block/bed_side' },
    multi: { other: 'bed_head', at: 'facing', root: true } },
  { id: 63, name: 'tnt', display: 'TNT', hardness: 0, sound: 'grass',
    tex: { top: 'block/tnt_top', side: 'block/tnt_side', bottom: 'block/tnt_bottom' } },
  { id: 64, name: 'stone_bricks', display: 'Tijolos de Pedra', tex: 'block/stone_bricks',
    hardness: 1.5, ...rock() },
  { id: 65, name: 'cobblestone_slab', display: 'Laje de Pedregulho', tex: 'block/cobblestone',
    shape: 'slab', hardness: 2, opaque: false, lightAttenuation: 0, ...rock() },
  { id: 66, name: 'white_wool', display: 'Lã Branca', tex: 'block/wool_white', hardness: 0.8,
    tool: 'shears', flammable: 30, sound: 'cloth' },
  { id: 67, name: 'iron_block', display: 'Bloco de Ferro', tex: 'block/iron_block', hardness: 5,
    ...rock('pickaxe', 2), sound: 'metal' },
  { id: 68, name: 'gold_block', display: 'Bloco de Ouro', tex: 'block/gold_block', hardness: 5,
    ...rock('pickaxe', 3), sound: 'metal' },
  { id: 69, name: 'diamond_block', display: 'Bloco de Diamante', tex: 'block/diamond_block',
    hardness: 5, ...rock('pickaxe', 3), sound: 'metal' },

  // --- 70..73 agricultura (M6) --------------------------------------------
  // A terra arada guarda a umidade 0..7 no estado; seca vira terra de novo.
  { id: 70, name: 'farmland', display: 'Terra Arada', hardness: 0.6, ...soil(),
    tex: { top: 'block/farmland_dry', side: 'block/dirt', bottom: 'block/dirt' },
    stages: [
      'block/farmland_dry', 'block/farmland_wet', 'block/farmland_wet', 'block/farmland_wet',
      'block/farmland_wet', 'block/farmland_wet', 'block/farmland_wet', 'block/farmland_wet',
    ] },
  { id: 71, name: 'wheat', display: 'Trigo', ...crop([
    'block/wheat_0', 'block/wheat_1', 'block/wheat_2', 'block/wheat_3',
    'block/wheat_4', 'block/wheat_5', 'block/wheat_6', 'block/wheat_7',
  ]) },
  { id: 72, name: 'carrots', display: 'Cenouras', ...crop([
    'block/carrots_0', 'block/carrots_0', 'block/carrots_1', 'block/carrots_1',
    'block/carrots_2', 'block/carrots_2', 'block/carrots_3', 'block/carrots_3',
  ]) },
  { id: 73, name: 'potatoes', display: 'Batatas', ...crop([
    'block/potatoes_0', 'block/potatoes_0', 'block/potatoes_1', 'block/potatoes_1',
    'block/potatoes_2', 'block/potatoes_2', 'block/potatoes_3', 'block/potatoes_3',
  ]) },

  // --- 74 encantamento (M6) -----------------------------------------------
  // Dura tanto quanto obsidiana porque é feita dela; a picareta de madeira
  // arranha, mas só a de diamante colhe de volta.
  { id: 74, name: 'enchanting_table', display: 'Mesa de Encantamento', hardness: 5,
    ...rock('pickaxe', 4),
    tex: {
      top: 'block/enchanting_table_top',
      side: 'block/enchanting_table_side',
      bottom: 'block/obsidian',
    } },

  // --- 75..79 apoio de estrutura (M6) --------------------------------------
  // Blocos que só existem porque dungeon e mina precisam deles; entram na
  // tabela como qualquer outro, sem caso especial no gerador.
  { id: 75, name: 'mossy_cobblestone', display: 'Pedregulho Musgoso',
    tex: 'block/mossy_cobblestone', hardness: 2, ...rock() },
  { id: 76, name: 'mob_spawner', display: 'Gerador de Monstros', tex: 'block/mob_spawner',
    hardness: 5, opaque: false, lightAttenuation: 1, ...rock('pickaxe', 2) },
  { id: 77, name: 'cobweb', display: 'Teia', tex: 'block/cobweb', shape: 'cross', solid: false,
    opaque: false, lightAttenuation: 0, hardness: 4, tool: 'sword', sound: 'cloth' },
  { id: 78, name: 'rail', display: 'Trilho', tex: 'block/rail', shape: 'rail', solid: false,
    opaque: false, lightAttenuation: 0, hardness: 0.7, tool: 'pickaxe', sound: 'metal',
    support: 'below', stages: railStages('block/rail', 'block/rail_curved') },
  { id: 79, name: 'oak_sign', display: 'Placa de Carvalho', tex: 'block/oak_sign', shape: 'sign',
    solid: false, opaque: false, lightAttenuation: 0, hardness: 1, ...wood() },
  { id: 80, name: 'painting', display: 'Quadro', tex: 'block/painting', shape: 'painting',
    solid: false, opaque: false, lightAttenuation: 0, hardness: 0.2, sound: 'wood' },
];

/**
 * Escadas, lajes, cercas, portões e alçapões dos materiais do jogo (doc 14 — M6).
 *
 * São **gerados**, não escritos à mão: a única diferença entre a escada de
 * arenito e a de tijolo de pedra é a textura e o nome. A ordem desta lista
 * define os ids, então **nunca reordene** — eles vão para o save, como os
 * da tabela acima.
 */
const BUILD_MATERIALS: readonly {
  name: string; display: string; tex: string; wood: boolean; hardness: number;
}[] = [
  { name: 'cobblestone', display: 'Pedregulho', tex: 'block/cobblestone', wood: false, hardness: 2 },
  { name: 'stone', display: 'Pedra', tex: 'block/stone', wood: false, hardness: 1.5 },
  { name: 'stone_brick', display: 'Tijolo de Pedra', tex: 'block/stone_bricks', wood: false, hardness: 1.5 },
  { name: 'sandstone', display: 'Arenito', tex: 'block/sandstone_side', wood: false, hardness: 0.8 },
  { name: 'oak', display: 'Carvalho', tex: 'block/oak_planks', wood: true, hardness: 2 },
  { name: 'birch', display: 'Bétula', tex: 'block/birch_planks', wood: true, hardness: 2 },
  { name: 'spruce', display: 'Pinheiro', tex: 'block/spruce_planks', wood: true, hardness: 2 },
];

/** Peças geradas por material. `wood` limita as que só existem em madeira. */
const BUILD_PARTS: readonly {
  suffix: string; display: string; shape: BlockShape; woodOnly: boolean;
}[] = [
  { suffix: 'stairs', display: 'Escada', shape: 'stairs', woodOnly: false },
  { suffix: 'slab', display: 'Laje', shape: 'slab', woodOnly: false },
  { suffix: 'fence', display: 'Cerca', shape: 'fence', woodOnly: true },
  { suffix: 'fence_gate', display: 'Portão', shape: 'fence_gate', woodOnly: true },
  { suffix: 'trapdoor', display: 'Alçapão', shape: 'trapdoor', woodOnly: true },
];

function buildingSpecs(): BlockSpec[] {
  const out: BlockSpec[] = [];
  // Começa depois do último id escrito à mão.
  let id = SPECS.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  const taken = new Set(SPECS.map((s) => s.name));

  for (const material of BUILD_MATERIALS) {
    for (const part of BUILD_PARTS) {
      if (part.woodOnly && !material.wood) continue;
      const name = `${material.name}_${part.suffix}`;
      // `cobblestone_slab` e `oak_fence` já existem com id antigo — o save deles
      // não pode mudar de número por causa desta tabela.
      if (taken.has(name)) continue;
      out.push({
        id: id++,
        name,
        display: `${part.display} de ${material.display}`,
        tex: material.tex,
        shape: part.shape,
        hardness: material.hardness,
        opaque: false,
        lightAttenuation: 0,
        ...(material.wood
          ? { tool: 'axe' as ToolKind, sound: 'wood' as SoundKind, flammable: 5 }
          : { tool: 'pickaxe' as ToolKind, minTier: 1 as const, requiresTool: true, sound: 'stone' as SoundKind }),
      });
    }
  }
  return out;
}

SPECS.push(...buildingSpecs());

/**
 * Redstone (doc 14 — M7). Entram **depois** das peças geradas porque o id vai
 * para o save: encaixá-los antes empurraria escada, laje e cerca de lugar.
 *
 * Tocha e lâmpada existem em **dois ids**, aceso e apagado, e não em um id com
 * bit de estado: a emissão de luz é uma coluna da tabela indexada por id, e o
 * flood fill de `world/lighting.ts` lê ela — um bit de estado não chegaria lá
 * sem espalhar estado por todo o caminho da luz.
 */

/**
 * Texturas do trilho por forma: retas e rampas usam uma, as curvas usam outra.
 *
 * As formas vivem nos bits 0..3 (`RAIL_*` de `world/mesh/shapes.ts`), e o
 * índice 16 do bit de energizado nunca chega aqui porque `stageTexOf` satura em
 * `MAX_STAGES - 1`. Trilho motorizado passa a textura acesa como `powered`.
 */
function railStages(
  straight: string, curved: string, powered = straight,
): readonly string[] {
  const out: string[] = [];
  for (let shape = 0; shape < 16; shape++) {
    out.push(shape >= 6 && shape <= 9 ? curved : (shape >= 16 ? powered : straight));
  }
  return out;
}

/** 16 níveis de pó em 4 texturas: o brilho sobe em degraus, não pixel a pixel. */
function dustStages(): readonly string[] {
  const out: string[] = [];
  for (let power = 0; power < 16; power++) {
    const step = power === 0 ? 0 : 1 + Math.min(2, Math.floor((power - 1) / 5));
    out.push(`block/redstone_dust_${step}`);
  }
  return out;
}

/** Alavanca, botão e placa: quebram na mão, não somem do mundo por acidente. */
const gadget = (sound: SoundKind): Partial<BlockDef> => ({
  solid: false, opaque: false, lightAttenuation: 0, hardness: 0.5, sound,
});

SPECS.push(
  { id: 102, name: 'redstone_wire', display: 'Pó de Redstone', shape: 'flat',
    solid: false, opaque: false, lightAttenuation: 0, hardness: 0, sound: 'stone',
    itemless: true, support: 'below', tex: 'block/redstone_dust_0', stages: dustStages() },
  { id: 103, name: 'redstone_torch', display: 'Tocha de Redstone', shape: 'torch',
    tex: {
      top: 'block/redstone_torch_top', side: 'block/redstone_torch',
      bottom: 'block/torch_bottom',
    },
    solid: false, opaque: false, lightAttenuation: 0,
    emission: 7, hardness: 0, sound: 'wood', support: 'below' },
  { id: 104, name: 'redstone_torch_off', display: 'Tocha de Redstone', shape: 'torch',
    tex: {
      top: 'block/redstone_torch_off_top', side: 'block/redstone_torch_off',
      bottom: 'block/torch_bottom',
    },
    solid: false, opaque: false, lightAttenuation: 0,
    hardness: 0, sound: 'wood', itemless: true, support: 'below' },
  { id: 105, name: 'lever', display: 'Alavanca', shape: 'lever', tex: 'block/lever',
    ...gadget('wood'), support: 'mount' },
  { id: 106, name: 'stone_button', display: 'Botão de Pedra', shape: 'button',
    tex: 'block/stone', ...gadget('stone'), support: 'mount' },
  { id: 107, name: 'oak_button', display: 'Botão de Carvalho', shape: 'button',
    tex: 'block/oak_planks', ...gadget('wood'), support: 'mount' },
  { id: 108, name: 'stone_pressure_plate', display: 'Placa de Pressão de Pedra', shape: 'plate',
    tex: 'block/stone', ...gadget('stone'), support: 'below' },
  { id: 109, name: 'oak_pressure_plate', display: 'Placa de Pressão de Carvalho', shape: 'plate',
    tex: 'block/oak_planks', ...gadget('wood'), support: 'below' },
  { id: 110, name: 'repeater', display: 'Repetidor', shape: 'repeater', tex: 'block/repeater',
    solid: false, opaque: false, lightAttenuation: 0, hardness: 0, sound: 'stone',
    support: 'below' },
  { id: 111, name: 'piston', display: 'Pistão', shape: 'piston', tex: 'block/piston',
    hardness: 1.5, opaque: false, tool: 'pickaxe', sound: 'stone' },
  { id: 112, name: 'sticky_piston', display: 'Pistão Pegajoso', shape: 'piston',
    tex: 'block/piston_sticky', hardness: 1.5, opaque: false, tool: 'pickaxe', sound: 'stone' },
  { id: 113, name: 'piston_head', display: 'Braço de Pistão', shape: 'piston_head',
    tex: 'block/piston_head', hardness: 1.5, opaque: false, lightAttenuation: 0,
    tool: 'pickaxe', sound: 'stone', itemless: true },
  { id: 114, name: 'redstone_lamp', display: 'Lâmpada de Redstone', tex: 'block/redstone_lamp',
    hardness: 0.3, sound: 'glass' },
  { id: 115, name: 'redstone_lamp_on', display: 'Lâmpada de Redstone',
    tex: 'block/redstone_lamp_on', hardness: 0.3, emission: 15, sound: 'glass', itemless: true },
  { id: 116, name: 'redstone_block', display: 'Bloco de Redstone', tex: 'block/redstone_block',
    hardness: 5, ...rock('pickaxe', 1), sound: 'metal' },
);

/**
 * Nether (doc 14 — M7). Mesma regra de sempre: ids no fim, nunca no meio.
 *
 * O portal é `itemless` e tem `emission: 11` — ele é a única fonte de luz de um
 * corredor recém-aberto, e ver o caminho de volta importa mais que o realismo.
 */
SPECS.push(
  { id: 117, name: 'netherrack', display: 'Netherrack', tex: 'block/netherrack',
    hardness: 0.4, ...rock('pickaxe', 1) },
  // Areia das almas segura o passo: `slipperiness` baixo é o freio que a
  // física do jogador já lê (`entity/player.ts`), sem campo novo na tabela.
  { id: 118, name: 'soul_sand', display: 'Areia das Almas', tex: 'block/soul_sand',
    hardness: 0.5, ...soil(), sound: 'sand', slipperiness: 0.4 },
  { id: 119, name: 'nether_quartz_ore', display: 'Minério de Quartzo', ...ore(), minTier: 1,
    tex: 'block/nether_quartz_ore' },
  { id: 120, name: 'nether_bricks', display: 'Tijolos do Nether', tex: 'block/nether_bricks',
    hardness: 2, ...rock() },
  { id: 121, name: 'magma_block', display: 'Bloco de Magma', tex: 'block/magma_block',
    hardness: 0.5, emission: 3, ...rock('pickaxe', 1) },
  // Cubo inteiro em vez do plano fino do gênero: um plano exigiria forma nova
  // com eixo no estado, e o portal é atravessado, não observado de perto.
  { id: 122, name: 'nether_portal', display: 'Portal do Nether', tex: 'block/nether_portal',
    solid: false, opaque: false, lightAttenuation: 0, emission: 11, hardness: -1,
    sound: 'glass', itemless: true, translucent: true },
);

/**
 * Trilhos especiais (doc 14 — M7).
 *
 * O trilho comum já existia desde o M6, porque a mina usa — o que faltava era o
 * que o torna transporte: um que empurra e um que avisa. Os dois **não fazem
 * curva**: máquina dentro de curva não existe no gênero, e a lógica de conexão
 * de `world/rails.ts` respeita isso sem um caso próprio, lendo `railCurves`.
 */
const railBase = (): Partial<BlockDef> => ({
  shape: 'rail', solid: false, opaque: false, lightAttenuation: 0,
  hardness: 0.7, tool: 'pickaxe', sound: 'metal', support: 'below',
});

SPECS.push(
  /*
   * Fogo (doc 03 §9 e doc 04).
   *
   * Cruz sem colisão, luz 15 e `replaceable`: andar nele não empurra o
   * jogador, e colocar bloco por cima o apaga. **`itemless`** porque fogo não
   * é item — quem o cria é o isqueiro ou a propagação, nunca a mochila.
   *
   * Os bits de estado guardam a **idade** 0..15, que é o que decide quando ele
   * se apaga sozinho (`world/fire.ts`).
   */
  { id: 125, name: 'fire', display: 'Fogo', tex: 'block/fire', shape: 'cross',
    solid: false, opaque: false, lightAttenuation: 0, emission: 15, hardness: 0,
    replaceable: true, itemless: true, sound: 'cloth' },
  { id: 123, name: 'powered_rail', display: 'Trilho Motorizado', ...railBase(),
    tex: 'block/powered_rail',
    stages: railStages('block/powered_rail', 'block/powered_rail', 'block/powered_rail_on') },
  { id: 124, name: 'detector_rail', display: 'Trilho Detector', ...railBase(),
    tex: 'block/detector_rail',
    stages: railStages('block/detector_rail', 'block/detector_rail', 'block/detector_rail_on') },
);

/**
 * Segundas metades dos blocos de duas células (M8).
 *
 * Ids no fim, como sempre — id vai para o save. As duas são `itemless`: o item
 * é o da metade de baixo, e quebrar qualquer uma das duas dropa um só.
 */
SPECS.push(
  { id: 126, name: 'oak_door_top', display: 'Porta de Carvalho', tex: 'block/oak_door_top',
    shape: 'door', hardness: 3, opaque: false, lightAttenuation: 0, ...wood(), itemless: true,
    multi: { other: 'oak_door', at: 'below', root: false } },
  { id: 127, name: 'bed_head', display: 'Cama', hardness: 0.2, shape: 'bed',
    opaque: false, lightAttenuation: 0, sound: 'cloth', itemless: true,
    tex: { top: 'block/bed_top', side: 'block/bed_side', bottom: 'block/bed_side' },
    multi: { other: 'bed', at: 'facing', root: false } },
);

/** Tabela final, indexada por id. Buracos ficam como `undefined`. */
export const BLOCKS: readonly BlockDef[] = buildTable();

/** Índice nome → definição. */
export const BLOCK_BY_NAME: ReadonlyMap<string, BlockDef> = new Map(
  BLOCKS.filter((b): b is BlockDef => b !== undefined).map((b) => [b.name, b]),
);

function buildTable(): BlockDef[] {
  const maxId = SPECS.reduce((m, s) => Math.max(m, s.id), 0);
  const table = new Array<BlockDef>(maxId + 1);
  for (const spec of SPECS) {
    if (table[spec.id] !== undefined) {
      throw new Error(`Id de bloco duplicado: ${spec.id} (${spec.name})`);
    }
    table[spec.id] = { ...DEFAULTS, ...spec } as BlockDef;
  }
  return table;
}

/** Ids usados o bastante pelo motor para merecerem constante nomeada. */
export const AIR = 0;
export const STONE = 1;
export const DIRT = 6;
export const GRASS_BLOCK = 8;
export const SAND = 10;
export const GRAVEL = 12;
export const SANDSTONE = 13;
export const SNOW_BLOCK = 15;
export const BEDROCK = 18;
export const WATER = 20;
export const LAVA = 21;
export const PODZOL = 9;
export const FARMLAND = 70;

// --- codificação de blockState ---------------------------------------------

/** Empacota id + estado em um uint16. */
export function makeState(id: number, state = 0): number {
  return ((id & 0x3ff) | ((state & 0x3f) << 10)) >>> 0;
}

export function blockIdOf(state: number): number {
  return state & 0x3ff;
}

export function stateBitsOf(state: number): number {
  return (state >>> 10) & 0x3f;
}

/** Definição de um blockState, com fallback seguro para ids desconhecidos. */
export function defOf(state: number): BlockDef {
  const def = BLOCKS[state & 0x3ff];
  return def !== undefined ? def : BLOCKS[AIR];
}

/** Textura de uma face, resolvendo a forma abreviada da tabela. */
export function texOf(def: BlockDef, face: 'top' | 'bottom' | 'side'): string {
  const tex = def.tex;
  if (typeof tex === 'string') return tex;
  return tex[face] ?? tex.side ?? tex.top ?? 'block/missing';
}
