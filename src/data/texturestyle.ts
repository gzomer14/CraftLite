/**
 * Estilos de textura, declarativos (doc 13 §2.2, extensão).
 *
 * O jogo tem dois visuais, escolhidos nas opções e aplicados no boot:
 *
 * - **Clássico** — o procedural cru, exatamente como sempre foi. Nada roda.
 * - **Nítido** — o mesmo procedural com o acabamento de `render/texfinish.ts`
 *   por cima, e os sprites de item redesenhados em volume por
 *   `render/itemart3d.ts`.
 *
 * Não há uma segunda tabela de textura: **o estilo é ajuste, não desenho**.
 * Acrescentar um bloco continua sendo uma linha em `textures.ts` e ele já nasce
 * com os dois visuais. O que mora aqui são os números do acabamento e as poucas
 * exceções que a regra genérica erraria.
 *
 * Nenhum pixel vem de fora: tudo continua gerado por código (PROMPT.md §6).
 */

import { t } from '../core/i18n';
import { NO_FINISH, type FinishStyle } from '../render/texfinish';

export type TextureStyleId = 'classico' | 'nitido';

/** Nome legível de cada estilo, para a tela de opções. */
export const TEXTURE_STYLE_LABEL: Record<TextureStyleId, string> = {
  classico: t('opt.tex_classic_short'),
  nitido: t('opt.tex_sharp_short'),
};

/**
 * Acabamento padrão de bloco.
 *
 * O relevo é o número que mais muda o jogo e o mais fácil de exagerar: acima de
 * ~0,6 a pedra vira couve-flor. O chanfro é discreto de propósito — ele existe
 * para a parede de pedra ter grade, não para o mundo virar azulejo.
 */
export const BLOCK_FINISH: FinishStyle = {
  relief: 0.5,
  rim: 0.18,
  sharpen: 0.3,
  saturation: 1.14,
  contrast: 1.1,
};

/**
 * Acabamento de skin de mob. Sem chanfro: a skin não é ladrilhada, a borda de
 * cada ilha do mapa UV encosta em outra parte do corpo, e um chanfro ali
 * desenharia costura onde não há.
 */
export const ENTITY_FINISH: FinishStyle = {
  relief: 0.3,
  rim: 0,
  sharpen: 0.25,
  saturation: 1.12,
  contrast: 1.08,
};

/**
 * Exceções por textura. O que não está aqui usa `BLOCK_FINISH`.
 *
 * Três motivos aparecem:
 *
 * - **líquido e portal** recusam tudo: a textura rola por cima de si mesma a
 *   cada quadro, e relevo fixo sobre imagem que anda vira cintilação;
 * - **bloco que emite luz** recusa o chanfro e o contraste: escurecer a borda
 *   de uma fonte de luz é exatamente o contrário do que ela deveria parecer;
 * - **família confundível** ganha um empurrão de cor, que é o jeito honesto de
 *   granito, diorito e andesito pararem de ser três cinzas iguais.
 */
export const FINISH_OVERRIDES: Record<string, Partial<FinishStyle>> = {
  // Animadas: o acabamento briga com o deslocamento dos quadros.
  'block/water': NO_FINISH,
  'block/lava': NO_FINISH,
  'block/nether_portal': NO_FINISH,
  'block/missing': NO_FINISH,

  // Emissivos: relevo sim, borda escura não.
  'block/glowstone': { rim: 0, contrast: 1, saturation: 1.1 },
  'block/magma_block': { rim: 0, contrast: 1 },
  'block/redstone_lamp_on': { rim: 0, contrast: 1 },
  'block/torch': { rim: 0 },
  'block/redstone_torch': { rim: 0 },
  'block/redstone_block': { rim: 0.12 },

  // As três pedras decorativas, que eram cinza, cinza e cinza.
  'block/granite': { tint: [1.1, 0.96, 0.93], saturation: 1.25 },
  'block/diorite': { tint: [1.04, 1.04, 1.06], contrast: 1.16 },
  'block/andesite': { tint: [0.95, 0.98, 1.04], saturation: 1.18 },

  // As três madeiras, que eram marrom, marrom e marrom.
  'block/oak_planks': { tint: [1.06, 0.98, 0.86] },
  'block/birch_planks': { tint: [1.08, 1.05, 0.9], contrast: 1.05 },
  'block/spruce_planks': { tint: [0.86, 0.78, 0.72] },
  'block/oak_log_side': { tint: [1.04, 0.97, 0.87] },
  'block/birch_log_side': { tint: [1.06, 1.05, 1.0] },
  'block/spruce_log_side': { tint: [0.85, 0.79, 0.74] },

  // Terra e areia: mais relevo, que é o que dá granulado a superfície solta.
  'block/dirt': { relief: 0.55 },
  'block/gravel': { relief: 0.6 },
  'block/sand': { relief: 0.5, saturation: 1.25 },
  'block/red_sand': { relief: 0.5, saturation: 1.25 },

  // Vidro e teia são quase só recorte: relevo forte só suja.
  'block/glass': { relief: 0.15, sharpen: 0.1 },
  // A teia é quase só linha fina: relevo em linha de 1 px só a engorda.
  'block/cobweb': NO_FINISH,
  'block/ice': { relief: 0.2, saturation: 1.3 },
};

/** Acabamento de uma textura de bloco no estilo Nítido, já com as exceções. */
export function blockFinishOf(name: string): FinishStyle {
  const patch = FINISH_OVERRIDES[name];
  return patch === undefined ? BLOCK_FINISH : { ...BLOCK_FINISH, ...patch };
}

// ---------------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------------

/** Como um item responde à luz. */
export type ItemMaterial = 'metal' | 'gem' | 'stone' | 'matte' | 'soft';

export interface ItemFinish {
  /** Luz que chega mesmo na face virada para longe. */
  ambient: number;
  /** Força do brilho especular. */
  specular: number;
  /** Expoente do especular: alto = ponto pequeno e duro, de metal. */
  shininess: number;
  /** Luz fria na quina de baixo-direita, que separa o item do fundo. */
  rimLight: number;
  /** Quanto a silhueta é abaulada: 1 = cheia, 0 = chapada. */
  volume: number;
}

/**
 * Resposta de cada material.
 *
 * `metal` e `gem` existem separados porque o brilho deles é diferente: metal
 * tem um ponto duro e um corpo escuro, gema espalha luz pelo corpo inteiro e
 * brilha na quina. É essa diferença que faz a picareta de diamante parecer de
 * diamante ao lado da de ferro.
 */
export const ITEM_FINISHES: Record<ItemMaterial, ItemFinish> = {
  metal: { ambient: 0.4, specular: 0.85, shininess: 24, rimLight: 0.3, volume: 1 },
  gem: { ambient: 0.55, specular: 0.7, shininess: 10, rimLight: 0.45, volume: 1 },
  stone: { ambient: 0.5, specular: 0.18, shininess: 6, rimLight: 0.16, volume: 0.9 },
  matte: { ambient: 0.52, specular: 0.12, shininess: 5, rimLight: 0.14, volume: 0.85 },
  soft: { ambient: 0.58, specular: 0.22, shininess: 8, rimLight: 0.2, volume: 1 },
};

/** Material pela silhueta, quando o nome do item não disser nada melhor. */
const SHAPE_MATERIAL: Record<string, ItemMaterial> = {
  gem: 'gem',
  ingot: 'metal',
  bucket: 'metal',
  chunk: 'stone',
  round: 'soft',
  meat: 'soft',
  apple: 'soft',
  carrot: 'soft',
  potato: 'soft',
  melon: 'soft',
  eye: 'soft',
  dust: 'matte',
  seeds: 'matte',
  feather: 'matte',
  string: 'matte',
  sheet: 'matte',
};

/** Prefixo de material das ferramentas e armaduras. */
const PREFIX_MATERIAL: [string, ItemMaterial][] = [
  ['diamond_', 'gem'],
  ['golden_', 'metal'],
  ['iron_', 'metal'],
  ['stone_', 'stone'],
  ['wooden_', 'matte'],
  ['leather_', 'soft'],
];

/** Itens que a regra genérica erraria. */
const ITEM_MATERIAL: Record<string, ItemMaterial> = {
  minecart: 'metal',
  flint_and_steel: 'metal',
  arrow: 'stone',
  bone: 'stone',
  flint: 'stone',
  coal: 'stone',
  charcoal: 'stone',
  slime_ball: 'soft',
  ender_pearl: 'gem',
  snowball: 'soft',
  clay_ball: 'matte',
};

/** Material de um item pelo nome e pela silhueta. */
export function itemMaterialOf(name: string, shape: string): ItemMaterial {
  const direct = ITEM_MATERIAL[name];
  if (direct !== undefined) return direct;
  for (let i = 0; i < PREFIX_MATERIAL.length; i++) {
    if (name.startsWith(PREFIX_MATERIAL[i][0])) return PREFIX_MATERIAL[i][1];
  }
  return SHAPE_MATERIAL[shape] ?? 'matte';
}
