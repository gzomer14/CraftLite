/**
 * Clique num slot de contêiner (baú, fornalha, bancada, mesa): pegar, pôr,
 * dividir, juntar e o shift-clique que manda para o inventário (doc 08 §3.5).
 *
 * Saiu de `screen.ts` em 2026-09-22 (M13): é regra de inventário, não de
 * tela, e é testável sem DOM.
 */

import { itemDef, type ItemStack } from '../../data/items';
import { Furnace, type ContainerView } from '../../game/container';
import type { ClickButton, Inventory } from '../../game/inventory';
import type { ScreenKind } from './screen';

/**
 * Clique num slot do contêiner. O inventário do jogador é a fonte da verdade
 * do cursor, então a troca acontece manualmente aqui.
 */
export function clickContainer(
inventory: Inventory, container: ContainerView | null, kind: ScreenKind,
index: number, button: ClickButton, shift: boolean,
onFurnaceOutput?: (furnace: Furnace, item: number) => void,
onAnvilTake?: () => ItemStack | null,
): void {
if (container === null) return;

  const slot = container.get(index);

  // Resultado da bigorna (M15): só sai, e só se a bancada deixar (níveis).
  if (kind === 'anvil' && index === 2) {
    if (slot === null || inventory.cursor !== null) return;
    const taken = onAnvilTake?.() ?? null;
    if (taken === null) return;
    if (shift) {
      const left = inventory.giveStack(taken);
      if (left > 0) inventory.cursor = { ...taken, count: left };
    } else {
      inventory.cursor = taken;
    }
    return;
  }

  if (shift) {
    if (slot === null) return;
    const leftover = inventory.giveStack(slot);
    if (leftover === slot.count) return;
    if (kind === 'furnace' && index === 2 && container instanceof Furnace) {
      onFurnaceOutput?.(container, slot.item);
    }
    slot.count = leftover;
    container.set(index, slot.count > 0 ? slot : null);
    return;
  }

  const cursor = inventory.cursor;

  // Saída da fornalha só sai, nunca entra — e leva junto o XP guardado.
  if (kind === 'furnace' && index === 2) {
    if (slot === null || cursor !== null) return;
    inventory.cursor = slot;
    container.set(index, null);
    if (container instanceof Furnace) onFurnaceOutput?.(container, slot.item);
    return;
  }

  if (cursor === null) {
    if (slot === null) return;
    if (button === 'right') {
      const take = Math.ceil(slot.count / 2);
      // Cópia inteira: a cópia à mão perdia o encantamento (corrigido no M15).
      inventory.cursor = { ...slot, count: take };
      slot.count -= take;
      container.set(index, slot.count > 0 ? slot : null);
    } else {
      inventory.cursor = slot;
      container.set(index, null);
    }
    return;
  }

  if (slot === null) {
    if (button === 'right') {
      container.set(index, { ...cursor, count: 1 });
      cursor.count--;
      if (cursor.count <= 0) inventory.cursor = null;
    } else {
      container.set(index, cursor);
      inventory.cursor = null;
    }
    return;
  }

  if (slot.item === cursor.item && slot.damage === cursor.damage) {
    const max = itemDef(slot.item)?.maxStack ?? 64;
    const moved = button === 'right' ? Math.min(1, max - slot.count) : Math.min(cursor.count, max - slot.count);
    if (moved <= 0) return;
    slot.count += moved;
    cursor.count -= moved;
    if (cursor.count <= 0) inventory.cursor = null;
    container.set(index, slot);
    return;
  }

  container.set(index, cursor);
  inventory.cursor = slot;
}
