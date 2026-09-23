/**
 * Contadores do jogador (M10). A tabela é `data/stats.ts`; aqui só se soma.
 *
 * Um `Float64Array` por índice da tabela: somar é uma escrita, e o save é a
 * lista de números na ordem da tabela.
 */

import { STATS, STAT_INDEX, type StatName } from '../data/stats';

export class Stats {
  readonly values = new Float64Array(STATS.length);

  add(name: StatName, amount = 1): void {
    const index = STAT_INDEX.get(name);
    if (index !== undefined) this.values[index] += amount;
  }

  get(name: StatName): number {
    const index = STAT_INDEX.get(name);
    return index === undefined ? 0 : this.values[index];
  }

  /** Para o save: um número por linha da tabela, distância com duas casas. */
  snapshot(): number[] {
    return Array.from(this.values, (v) => Math.round(v * 100) / 100);
  }

  /** Save antigo não tem o campo; tabela maior que o save começa em zero. */
  restore(saved: readonly number[] | undefined): void {
    this.values.fill(0);
    if (saved === undefined) return;
    for (let i = 0; i < this.values.length && i < saved.length; i++) {
      const value = saved[i];
      if (Number.isFinite(value) && value > 0) this.values[i] = value;
    }
  }
}
