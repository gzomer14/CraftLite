/**
 * Hotbar: 9 slots e o item na mão.
 *
 * No M2 ela é preenchida com blocos de teste. O inventário completo de 46
 * slots, com todas as interações do doc 08 §3.5, é entregável do M4 — mas a
 * hotbar já é a fatia [27..35] daquele inventário, então a API não muda.
 */

import { makeStack, type ItemStack } from '../data/items';
import { HOTBAR_SLOTS } from '../ui/hud';

export class Hotbar {
  readonly slots: (ItemStack | null)[] = new Array(HOTBAR_SLOTS).fill(null);
  private selected = 0;

  get selectedIndex(): number {
    return this.selected;
  }

  select(index: number): void {
    this.selected = ((index % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
  }

  /** Avança `delta` slots, com wrap — usado pela roda do mouse. */
  scroll(delta: number): void {
    this.select(this.selected + delta);
  }

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = stack;
  }

  /** Consome uma unidade do slot ativo; esvazia quando chega a zero. */
  consumeHeld(): void {
    const stack = this.slots[this.selected];
    if (stack === null) return;
    stack.count--;
    if (stack.count <= 0) this.slots[this.selected] = null;
  }

  /**
   * Guarda um item, empilhando no primeiro slot compatível.
   * Devolve o que não coube.
   */
  give(item: number, count: number): number {
    let remaining = count;
    for (let i = 0; i < HOTBAR_SLOTS && remaining > 0; i++) {
      const stack = this.slots[i];
      if (stack !== null && stack.item === item && stack.count < 64) {
        const room = 64 - stack.count;
        const moved = Math.min(room, remaining);
        stack.count += moved;
        remaining -= moved;
      }
    }
    for (let i = 0; i < HOTBAR_SLOTS && remaining > 0; i++) {
      if (this.slots[i] !== null) continue;
      const moved = Math.min(64, remaining);
      this.slots[i] = makeStack(item, moved);
      remaining -= moved;
    }
    return remaining;
  }

  /** Coloca o bloco na mão, se já não estiver (pick block do doc 06 §9). */
  pickBlock(item: number): void {
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (this.slots[i]?.item === item) {
        this.select(i);
        return;
      }
    }
    this.slots[this.selected] = makeStack(item, 1);
  }
}
