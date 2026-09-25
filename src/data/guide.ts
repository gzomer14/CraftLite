/**
 * A primeira hora guiada (M17): do primeiro tronco à picareta de pedra.
 *
 * Doc 14, M17: *"dica contextual e não tutorial em pop-up"*. Cada passo é uma
 * frase na linha de objetivo do HUD, e some quando o jogador **tem** o que o
 * passo pedia — ou quando a conquista correspondente de `data/achievements.ts`
 * já saiu. Nada trava, nada pausa: quem já sabe jogar passa por cima das
 * dicas sem notar, porque cada uma cai assim que o item aparece na mochila.
 *
 * A frase é uma só por passo, com três lacunas para o **gesto** — `{0}`
 * quebrar, `{1}` usar, `{2}` abrir a mochila —, que `ui/objectiveline.ts`
 * preenche com o do teclado, do toque (modo A ou B) ou do controle na mão.
 * Uma frase por forma de jogar seriam quatro traduções de cada passo.
 *
 * Passo novo é uma linha aqui e uma chave `guide.<id>` em `data/strings`.
 */

import type { StringKey } from './strings/pt';

export interface GuideStep {
  id: string;
  /**
   * Passo feito quando a mochila tem um destes itens (nome, ou `#tag` de
   * `data/recipes.ts`)…
   */
  has: readonly string[];
  /** …ou quando esta conquista já saiu. */
  achievement?: string;
  text: StringKey;
}

/**
 * Na ordem. O progresso **só anda para a frente** (`game/guide.ts`): gastar as
 * tábuas na bancada não traz de volta a dica das tábuas.
 */
export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'log', has: ['#logs'], achievement: 'get_wood', text: 'guide.log' },
  { id: 'planks', has: ['#planks'], achievement: 'benchmarking', text: 'guide.planks' },
  { id: 'table', has: ['crafting_table'], achievement: 'benchmarking', text: 'guide.table' },
  { id: 'pickaxe', has: ['wooden_pickaxe'], achievement: 'time_to_mine', text: 'guide.pickaxe' },
  { id: 'cobble', has: ['cobblestone'], text: 'guide.cobble' },
  { id: 'stone_pickaxe', has: ['stone_pickaxe'], text: 'guide.stone_pickaxe' },
];
