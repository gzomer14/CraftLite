/**
 * A fogueira que assa (M26, doc 00 §3).
 *
 * É um contêiner de quatro casas, sem tela: a comida entra pelo clique
 * (`game/cozy.ts`), assa sozinha sem combustível em `CAMPFIRE_COOK_TICKS`, e
 * pula para fora já pronta. Quebrar a fogueira solta o que estava em cima,
 * pelo mesmo caminho do baú (`Tiles.remove`).
 *
 * O que ela assa sai da **fundição** (`data/smelting.ts`): toda receita cujo
 * resultado é comida. Peixe novo na fornalha já assa na fogueira, sem linha
 * nenhuma aqui.
 *
 * Apagada, a comida fica em cima e o relógio dela para; acesa de novo, volta
 * de onde parou.
 */

import { CAMPFIRE_COOK_TICKS, CAMPFIRE_SLOTS } from '../data/cozy';
import { ITEM_BY_NAME, itemDef, type ItemStack } from '../data/items';
import { SMELTING } from '../data/smelting';
import { Container } from './container';

/** Item cru → item assado. Montado na primeira consulta. */
let cooks: Map<number, number> | null = null;

/** O que a fogueira faz do item, ou −1 se ela não o assa. */
export function campfireResult(item: number): number {
  if (cooks === null) {
    cooks = new Map();
    for (const recipe of SMELTING) {
      if (recipe.input.startsWith('#')) continue;
      const input = ITEM_BY_NAME.get(recipe.input);
      const output = ITEM_BY_NAME.get(recipe.output);
      if (input === undefined || output === undefined || output.food === undefined) continue;
      cooks.set(input.id, output.id);
    }
  }
  return cooks.get(item) ?? -1;
}

export class Campfire extends Container {
  /** Ticks assando de cada casa. */
  readonly cookTicks = new Int32Array(CAMPFIRE_SLOTS);

  constructor(x: number, y: number, z: number) {
    super('campfire', CAMPFIRE_SLOTS, x, y, z);
  }

  /** Põe **um** item cru numa casa vazia. false se não assa ou não há casa. */
  place(item: number): boolean {
    if (campfireResult(item) < 0) return false;
    for (let i = 0; i < CAMPFIRE_SLOTS; i++) {
      if (this.slots[i] !== null) continue;
      this.cookTicks[i] = 0;
      this.set(i, { item, count: 1, damage: 0 });
      return true;
    }
    return false;
  }

  /**
   * Um tick. Acesa, cada casa anda um tick; a que chega ao ponto devolve o
   * assado por `out`, e a casa fica livre.
   */
  tick(lit: boolean, out: (stack: ItemStack) => void): void {
    if (!lit) return;
    for (let i = 0; i < CAMPFIRE_SLOTS; i++) {
      const stack = this.slots[i];
      if (stack === null) continue;
      if (++this.cookTicks[i] < CAMPFIRE_COOK_TICKS) continue;
      const result = campfireResult(stack.item);
      this.cookTicks[i] = 0;
      this.set(i, null);
      if (result >= 0 && itemDef(result) !== undefined) out({ item: result, count: 1, damage: 0 });
    }
  }
}
