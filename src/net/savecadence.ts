/**
 * Quando o convidado manda o próprio save ao anfitrião (M23).
 *
 * Era só a cada 10 s: o convidado cuja ligação caía sem `BYE` voltava com o
 * inventário de até 10 s antes — o diamante recém-minerado sumia. Agora o
 * save também sai quando o inventário muda, conferido uma vez por segundo
 * (o teto: sem ele, quebrar bloco com a picareta mandaria um save por golpe).
 * A posição não entra na conta, senão andar já mandaria um por segundo.
 */

import type { ItemStack } from '../data/items';

/** Ticks entre os saves de sempre (10 s a 20 Hz). */
export const SAVE_EVERY = 200;
/** Ticks entre duas conferências do inventário (1 s). */
export const CHECK_EVERY = 20;

export class SaveCadence {
  private ticks = 0;
  /** Assinatura do último save; `-1` até a primeira conferência, que só anota. */
  private last = -1;

  /** true se o save deve sair neste tick. `slots` só é lido no tick de conferir. */
  tick(slots: readonly (ItemStack | null)[], level: number): boolean {
    this.ticks++;
    if (this.ticks % SAVE_EVERY === 0) {
      this.last = signature(slots, level);
      return true;
    }
    if (this.ticks % CHECK_EVERY !== 0) return false;
    const now = signature(slots, level);
    if (this.last === -1) this.last = now;
    if (now === this.last) return false;
    this.last = now;
    return true;
  }
}

/** Resumo do inventário em 32 bits (FNV-1a), sem alocar. */
export function signature(slots: readonly (ItemStack | null)[], level: number): number {
  let h = 0x811c9dc5 ^ level;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    h = Math.imul(h ^ (s === null ? 0xffff : s.item), 0x01000193);
    h = Math.imul(h ^ (s === null ? 0 : s.count | (s.damage << 8)), 0x01000193);
    h = Math.imul(h ^ (s?.ench ?? 0), 0x01000193);
  }
  return h >>> 0;
}
