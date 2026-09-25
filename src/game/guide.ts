/**
 * Progresso da primeira hora guiada (M17). A tabela de passos está em
 * `data/guide.ts`; quem escreve a frase na tela é `ui/objectiveline.ts`.
 *
 * O estado é **um número**: quantos passos já foram feitos. Vai para o save do
 * jogador, porque recalcular do inventário ao voltar ao mundo traria a dica do
 * pedregulho de novo para quem gastou todo o pedregulho numa casa.
 *
 * O passo feito é o **mais adiantado** cuja condição vale agora, e não o
 * primeiro: quem começa com uma bancada de presente pula direto para a
 * picareta, e quem gastou as tábuas na bancada não volta à dica das tábuas.
 */

import { GUIDE_STEPS } from '../data/guide';
import { ITEM_BY_NAME } from '../data/items';
import { TAGS } from '../data/recipes';
import { ACHIEVEMENT_BY_NAME } from '../data/achievements';
import type { ItemStack } from '../data/items';

/** Ids de item de cada passo, resolvidos uma vez (as tags viram listas). */
const STEP_ITEMS: readonly (readonly number[])[] = GUIDE_STEPS.map((step) => {
  const ids: number[] = [];
  for (const entry of step.has) {
    const names = entry.startsWith('#') ? TAGS[entry.slice(1)] ?? [] : [entry];
    for (const name of names) {
      const id = ITEM_BY_NAME.get(name)?.id;
      if (id === undefined) throw new Error(`Passo ${step.id} pede item desconhecido: ${name}`);
      ids.push(id);
    }
  }
  return ids;
});

/** Bit da conquista de cada passo, ou 0. */
const STEP_ACHIEVEMENT_BIT: readonly number[] = GUIDE_STEPS.map((step) => {
  if (step.achievement === undefined) return 0;
  const def = ACHIEVEMENT_BY_NAME.get(step.achievement);
  if (def === undefined) throw new Error(`Passo ${step.id} pede conquista desconhecida`);
  return 1 << def.id;
});

export class Guide {
  /** Passos feitos, 0..`GUIDE_STEPS.length`. */
  private done = 0;

  get stepsDone(): number {
    return this.done;
  }

  /** true quando não sobra dica: a picareta de pedra já saiu. */
  get finished(): boolean {
    return this.done >= GUIDE_STEPS.length;
  }

  /** O passo à vista, ou −1 se acabou. */
  get current(): number {
    return this.finished ? -1 : this.done;
  }

  /** Restaura do save; valor estranho vira "nada feito", que só mostra dica. */
  restore(done: number | undefined): void {
    this.done = typeof done === 'number' && done >= 0
      ? Math.min(Math.floor(done), GUIDE_STEPS.length)
      : 0;
  }

  /**
   * Avança o que o estado do jogador já cumpre. Devolve true se andou.
   *
   * Sem alocação: percorre a mochila uma vez por passo à frente, e roda uma vez
   * por segundo, não por quadro.
   */
  update(slots: readonly (ItemStack | null)[], achievementMask: number): boolean {
    let reached = this.done;
    for (let step = GUIDE_STEPS.length - 1; step >= this.done; step--) {
      if (stepMet(step, slots, achievementMask)) {
        reached = step + 1;
        break;
      }
    }
    if (reached === this.done) return false;
    this.done = reached;
    return true;
  }
}

function stepMet(step: number, slots: readonly (ItemStack | null)[], mask: number): boolean {
  const bit = STEP_ACHIEVEMENT_BIT[step];
  if (bit !== 0 && (mask & bit) !== 0) return true;
  const ids = STEP_ITEMS[step];
  for (let i = 0; i < slots.length; i++) {
    const stack = slots[i];
    if (stack !== null && ids.includes(stack.item)) return true;
  }
  return false;
}
