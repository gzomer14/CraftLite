/**
 * Estado do uso de item: espera entre cliques e contagem de segurar (M13).
 * As ações em si estão em `game/itemuse.ts`.
 */

import { itemDef, type ItemStack } from '../data/items';
import {
  ITEM_USES, USE_COOLDOWN, usesOf, type ItemUseBase, type ItemUseContext,
} from './itemuse';

/**
 * Quem usa o item na mão: guarda a espera entre cliques e a contagem de
 * segurar, e percorre a lista de usos do item (M13).
 *
 * Saiu da `Session` junto com os `try*`: é estado do **uso**, não da sessão.
 */
export class ItemUser {
  readonly context: ItemUseContext;
  /** Ticks seguidos com o botão apertado no mesmo item. */
  private holdTicks = 0;
  /** Item em que `holdTicks` está contando; trocar de item zera. */
  private holdItem = -1;
  /** Ticks até o próximo uso de clique. */
  private cooldown = 0;

  constructor(base: ItemUseBase) {
    this.context = {
      ...base,
      holdTicks: () => this.holdTicks,
      resetHold: () => { this.holdTicks = 0; },
    };
  }

  tick(): void {
    if (this.cooldown > 0) this.cooldown--;
  }

  /**
   * Os usos do item na mão, na ordem da tabela (`ItemDef.uses`): o primeiro
   * que aceitar gasta o clique.
   */
  use(held: ItemStack | null): boolean {
    if (held === null) return false;
    const uses = usesOf(held);
    for (let i = 0; i < uses.length; i++) {
      const handler = ITEM_USES[uses[i]];
      if (handler.use === undefined) continue;
      if (handler.hold === true) {
        if (held.item !== this.holdItem) {
          this.holdItem = held.item;
          this.holdTicks = 0;
        }
        this.holdTicks++;
        if (handler.use(this.context, held)) return true;
        this.holdTicks = 0;
        continue;
      }
      if (this.cooldown > 0) return true;
      if (handler.use(this.context, held)) {
        this.cooldown = USE_COOLDOWN;
        return true;
      }
    }
    return false;
  }

  /** Item num bicho (tesoura, balde na vaca, corante na ovelha). */
  onMob(held: ItemStack, mob: number): boolean {
    const uses = usesOf(held);
    for (let i = 0; i < uses.length; i++) {
      const onMob = ITEM_USES[uses[i]].onMob;
      if (onMob === undefined) continue;
      if (this.cooldown > 0) return true;
      if (onMob(this.context, held, mob)) {
        this.cooldown = USE_COOLDOWN;
        return true;
      }
    }
    return false;
  }

  /** Soltou o botão: dispara o arco com a carga que tiver, baixa o escudo. */
  release(held: ItemStack | null): void {
    const ticks = this.holdTicks;
    this.holdTicks = 0;
    if (held === null || ticks <= 0 || held.item !== this.holdItem) return;
    const uses = usesOf(held);
    for (let i = 0; i < uses.length; i++) {
      const handler = ITEM_USES[uses[i]];
      if (handler.hold === true && handler.release !== undefined) {
        handler.release(this.context, held, ticks);
      }
    }
  }

  /** Ticks segurando **este** item, ou 0. */
  private heldTicks(held: ItemStack | null): number {
    return held !== null && held.item === this.holdItem ? this.holdTicks : 0;
  }

  /** 0..1 da carga do arco, para o HUD e para a animação. */
  chargeProgress(held: ItemStack | null): number {
    const def = held === null ? undefined : itemDef(held.item);
    if (def?.charge !== 'bow') return 0;
    return Math.min(1, this.heldTicks(held) / (def.chargeTicks ?? 20));
  }

  /** true se o escudo está levantado agora (doc 14 — M6). */
  isBlocking(held: ItemStack | null): boolean {
    if (this.heldTicks(held) <= 0 || held === null) return false;
    return itemDef(held.item)?.charge === 'shield';
  }

  /** 0..1 da mordida em curso. */
  eatProgress(held: ItemStack | null): number {
    const food = held === null ? undefined : itemDef(held.item)?.food;
    if (food === undefined) return 0;
    return this.heldTicks(held) / food.eatTicks;
  }
}
