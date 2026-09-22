/**
 * Cores do jogo: corante, lã e cama (doc 14 — M8).
 *
 * **Uma tabela, três famílias.** A cor é a única coisa que muda entre uma lã
 * vermelha e uma azul, entre uma cama vermelha e uma azul, e entre os dois
 * corantes que as tingem. Descrever a cor uma vez e derivar bloco, item,
 * textura e receita dela é o que permite acrescentar uma cor nova mexendo em
 * **uma linha** — a regra nº 3 do projeto aplicada a conteúdo.
 *
 * **Dezesseis desde o M13 (2026-09-22).** Até lá eram oito, porque cada cor
 * custava quatro camadas de atlas (a lã e as três da cama) e o doc 02 §3 fecha
 * em 256. Agora lã e cama são **um desenho cinza tingido no shader** pela cor
 * da tabela (`data/tints.ts`): a cor deixou de custar camada, e as dezesseis
 * saem por menos do que as oito custavam.
 */

import type { Rgb } from '../render/texgen';

export interface DyeDef {
  /** Sufixo usado em `<cor>_wool`, `bed_<cor>` e `<cor>_dye`. */
  name: string;
  display: string;
  /** Adjetivo concordando com "Lã" (feminino) e "Cama" (feminino). */
  feminine: string;
  /** Cor da lã. */
  wool: Rgb;
  /** Colcha da cama — a mesma cor, um tom abaixo, para o pano ler como pano. */
  quilt: Rgb;
  /** Vinco da colcha: mais escuro ainda. */
  shade: Rgb;
  /** Destaque da dobra de cima. */
  highlight: Rgb;
}

/**
 * As dezesseis cores. **Não reordene nem insira no meio**: o id dos blocos de
 * lã e cama sai desta ordem (`data/blocks.ts`), a cor da ovelha é o índice
 * aqui (`entity/husbandry.ts`) e o tint do vértice também (`data/tints.ts`).
 * As oito do M8 vêm primeiro; as do M13, depois.
 */
export const DYES: readonly DyeDef[] = [
  {
    name: 'white', display: 'Branco', feminine: 'Branca',
    wool: [233, 236, 236], quilt: [222, 226, 226], shade: [166, 170, 170],
    highlight: [248, 250, 250],
  },
  {
    name: 'red', display: 'Vermelho', feminine: 'Vermelha',
    wool: [160, 40, 40], quilt: [196, 52, 52], shade: [108, 28, 28],
    highlight: [232, 96, 96],
  },
  {
    name: 'orange', display: 'Laranja', feminine: 'Laranja',
    wool: [216, 122, 38], quilt: [228, 134, 46], shade: [150, 80, 22],
    highlight: [246, 176, 96],
  },
  {
    name: 'yellow', display: 'Amarelo', feminine: 'Amarela',
    wool: [230, 198, 62], quilt: [236, 206, 74], shade: [166, 140, 34],
    highlight: [250, 232, 140],
  },
  {
    name: 'green', display: 'Verde', feminine: 'Verde',
    wool: [84, 136, 54], quilt: [94, 148, 60], shade: [52, 90, 34],
    highlight: [140, 190, 100],
  },
  {
    name: 'blue', display: 'Azul', feminine: 'Azul',
    wool: [58, 84, 168], quilt: [66, 94, 184], shade: [34, 52, 114],
    highlight: [116, 146, 226],
  },
  {
    name: 'purple', display: 'Roxo', feminine: 'Roxa',
    wool: [116, 58, 158], quilt: [128, 66, 172], shade: [74, 34, 104],
    highlight: [172, 116, 212],
  },
  {
    name: 'black', display: 'Preto', feminine: 'Preta',
    wool: [32, 32, 36], quilt: [40, 40, 46], shade: [18, 18, 22],
    highlight: [76, 76, 84],
  },
  // --- M13: as oito que faltavam para a paleta do gênero -------------------
  {
    name: 'light_gray', display: 'Cinza-claro', feminine: 'Cinza-clara',
    wool: [156, 156, 150], quilt: [168, 168, 162], shade: [110, 110, 106],
    highlight: [206, 206, 200],
  },
  {
    name: 'gray', display: 'Cinza', feminine: 'Cinza',
    wool: [72, 76, 80], quilt: [82, 86, 90], shade: [46, 48, 52],
    highlight: [120, 124, 128],
  },
  {
    name: 'brown', display: 'Marrom', feminine: 'Marrom',
    wool: [118, 76, 44], quilt: [130, 84, 50], shade: [80, 50, 28],
    highlight: [168, 120, 84],
  },
  {
    name: 'pink', display: 'Rosa', feminine: 'Rosa',
    wool: [232, 142, 170], quilt: [240, 152, 180], shade: [170, 96, 120],
    highlight: [250, 196, 214],
  },
  {
    name: 'lime', display: 'Verde-limão', feminine: 'Verde-limão',
    wool: [126, 196, 42], quilt: [136, 206, 50], shade: [84, 140, 26],
    highlight: [184, 232, 110],
  },
  {
    name: 'cyan', display: 'Ciano', feminine: 'Ciano',
    wool: [22, 138, 144], quilt: [28, 150, 156], shade: [12, 92, 98],
    highlight: [90, 196, 200],
  },
  {
    name: 'light_blue', display: 'Azul-claro', feminine: 'Azul-clara',
    wool: [60, 176, 218], quilt: [70, 186, 226], shade: [36, 120, 156],
    highlight: [136, 214, 240],
  },
  {
    name: 'magenta', display: 'Magenta', feminine: 'Magenta',
    wool: [190, 70, 180], quilt: [202, 80, 192], shade: [130, 42, 124],
    highlight: [230, 140, 222],
  },
];

/** Quantas cores existiam no M8: os ids de item delas vêm antes dos das novas. */
export const LEGACY_DYE_COUNT = 8;

export const DYE_BY_NAME: ReadonlyMap<string, DyeDef> = new Map(DYES.map((d) => [d.name, d]));

/**
 * De onde vem cada corante.
 *
 * Quatro saem de coisa que já existia no mundo e dois se misturam a partir
 * desses — é o que faz a paleta ter **economia** em vez de ser oito receitas
 * soltas. O preto sair do saco de tinta da lula e o branco do osso é o gênero;
 * o verde sair do cacto na fornalha também.
 */
export interface DyeSource {
  dye: string;
  /** Item que vira corante numa receita sem forma, ou `null` se é mistura. */
  from?: string;
  /** Duas cores que se misturam (`shapeless`). */
  mix?: readonly [string, string];
  /** true = sai da fornalha, não da bancada. */
  smelted?: boolean;
}

export const DYE_SOURCES: readonly DyeSource[] = [
  { dye: 'white', from: 'bone' },
  { dye: 'red', from: 'poppy' },
  { dye: 'yellow', from: 'dandelion' },
  { dye: 'blue', from: 'lapis_lazuli' },
  { dye: 'black', from: 'ink_sac' },
  { dye: 'green', from: 'cactus', smelted: true },
  { dye: 'orange', mix: ['red_dye', 'yellow_dye'] },
  { dye: 'purple', mix: ['red_dye', 'blue_dye'] },
  // M13: as misturas do gênero. O marrom do gênero vem do cacau, que não
  // existe sem selva; aqui ele é vermelho com verde, que é o que a tinta faz.
  { dye: 'gray', mix: ['black_dye', 'white_dye'] },
  { dye: 'light_gray', mix: ['gray_dye', 'white_dye'] },
  { dye: 'pink', mix: ['red_dye', 'white_dye'] },
  { dye: 'lime', mix: ['green_dye', 'white_dye'] },
  { dye: 'light_blue', mix: ['blue_dye', 'white_dye'] },
  { dye: 'cyan', mix: ['blue_dye', 'green_dye'] },
  { dye: 'magenta', mix: ['purple_dye', 'pink_dye'] },
  { dye: 'brown', mix: ['red_dye', 'green_dye'] },
];
