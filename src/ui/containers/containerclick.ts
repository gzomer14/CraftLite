/**
 * Clique num slot de contêiner (baú, fornalha, bancada, mesa): pegar, pôr,
 * dividir, juntar e o shift-clique que manda para o inventário (doc 08 §3.5).
 *
 * Saiu de `screen.ts` em 2026-09-22 (M13): é regra de inventário, não de
 * tela, e é testável sem DOM.
 */

import { itemDef } from '../../data/items';
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
): void {
if (container === null) return;

  const slot = container.get(index);

  if (shift) {
    if (slot === null) return;
    const leftover = inventory.give(slot.item, slot.count, slot.damage, slot.ench ?? 0);
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
      inventory.cursor = { item: slot.item, count: take, damage: slot.damage };
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
      container.set(index, { item: cursor.item, count: 1, damage: cursor.damage });
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
