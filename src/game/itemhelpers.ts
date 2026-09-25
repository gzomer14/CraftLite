/**
 * Pequenas operações de mão que mais de um uso de item faz (2026-09-24, M16):
 * trocar o item da mão por outro, gastar deixando o resto, e o raio que
 * enxerga fluido. Saíram de `itemuse.ts` quando os usos do M16
 * (`journeyuses.ts`) passaram a precisar delas também.
 */

import { ITEM_BY_NAME, itemDef, type ItemStack } from '../data/items';
import { raycast, type RayHit } from '../world/raycast';
import type { ItemUseContext } from './itemuse';

export function itemIdOf(name: string): number {
  return ITEM_BY_NAME.get(name)?.id ?? -1;
}

/**
 * Troca uma unidade do item na mão por outro item (balde vazio ↔ cheio).
 * No criativo a mão não muda — é a regra de "não gasta item" do doc 06 §9.
 */
export function swapHeld(ctx: ItemUseContext, held: ItemStack, next: string): void {
  if (ctx.player.mode === 'creative') return;
  const id = itemIdOf(next);
  if (id < 0) return;
  if (held.count === 1) {
    ctx.inventory.set(ctx.inventory.selected, { item: id, count: 1, damage: 0 });
    return;
  }
  ctx.inventory.consumeHeld();
  const left = ctx.inventory.give(id, 1, 0, 0);
  if (left > 0) ctx.drop({ item: id, count: left, damage: 0 }, ctx.player.x, ctx.player.y + 1, ctx.player.z);
}

/** Raio da mira que **enxerga fluido** — o do balde vazio. */
export function fluidRay(ctx: ItemUseContext): RayHit {
  const p = ctx.player;
  return raycast(
    ctx.world, p.x, p.y + p.eyeHeight, p.z, ctx.aim[0], ctx.aim[1], ctx.aim[2], p.reach,
    { fluids: true, replaceable: true },
  );
}

/**
 * Gasta um do item na mão e devolve o resto (tigela, balde) no lugar, como o
 * gênero faz: o ensopado vira tigela na mesma casinha.
 */
export function consumeWithRemainder(ctx: ItemUseContext, held: ItemStack): void {
  if (ctx.player.mode === 'creative') return;
  const restName = itemDef(held.item)?.remainder;
  const rest = restName === undefined ? -1 : itemIdOf(restName);
  if (rest >= 0 && held.count === 1) {
    ctx.inventory.set(ctx.inventory.selected, { item: rest, count: 1, damage: 0 });
    return;
  }
  ctx.inventory.consumeHeld();
  if (rest >= 0) {
    const left = ctx.inventory.give(rest, 1, 0, 0);
    if (left > 0) ctx.drop({ item: rest, count: left, damage: 0 }, ctx.player.x, ctx.player.y + 1, ctx.player.z);
  }
}
