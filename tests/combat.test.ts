/**
 * Combate: armadura, dano de ataque, explosão (doc 05 §2–§3, doc 07 §6).
 *
 * São fórmulas puras — dá para verificar cada número da tabela do doc sem
 * mundo, sem GL e sem DOM, que é o único jeito de garantir que "armadura de
 * diamante" signifique o que o doc diz que significa.
 */
import { describe, expect, it } from 'vitest';
import {
  armorDurabilityCost, armorSlotOf, armorTotals, attackCooldownOf, attackDamageOf,
  reduceByArmor,
} from '../src/game/combat';
import { explosionDamage } from '../src/game/explosion';
import { ARMOR_MATERIALS, ITEM_BY_NAME, itemDef, makeStack } from '../src/data/items';
import { ARMOR_START, INVENTORY_SIZE, Inventory } from '../src/game/inventory';
import { Survival } from '../src/game/survival';

function emptySlots(): (ReturnType<typeof makeStack> | null)[] {
  return new Array(INVENTORY_SIZE).fill(null);
}

function equip(names: string[]): (ReturnType<typeof makeStack> | null)[] {
  const slots = emptySlots();
  for (const name of names) {
    const item = ITEM_BY_NAME.get(name)!;
    slots[armorSlotOf(item.id)] = makeStack(item.id, 1);
  }
  return slots;
}

describe('tabela de armadura (doc 05 §3)', () => {
  it('cada material soma os pontos da tabela', () => {
    const expected: Record<string, number> = { leather: 7, golden: 11, iron: 15, diamond: 20 };
    const out = { defense: 0, toughness: 0, protection: 0 };
    for (const material of ARMOR_MATERIALS) {
      const set = ['helmet', 'chestplate', 'leggings', 'boots']
        .map((piece) => `${material.name}_${piece}`);
      armorTotals(equip(set), out);
      expect(out.defense, material.name).toBe(expected[material.name]);
    }
  });

  it('a durabilidade do peitoral bate com o doc', () => {
    const expected: Record<string, number> = { leather: 80, golden: 112, iron: 240, diamond: 528 };
    for (const material of ARMOR_MATERIALS) {
      const item = ITEM_BY_NAME.get(`${material.name}_chestplate`)!;
      expect(itemDef(item.id)?.durability, material.name).toBe(expected[material.name]);
    }
  });

  it('bota dura menos que peitoral no mesmo material', () => {
    const boots = itemDef(ITEM_BY_NAME.get('iron_boots')!.id)?.durability ?? 0;
    const chest = itemDef(ITEM_BY_NAME.get('iron_chestplate')!.id)?.durability ?? 0;
    expect(boots).toBeLessThan(chest);
  });

  it('só diamante tem resistência (toughness)', () => {
    const out = { defense: 0, toughness: 0, protection: 0 };
    armorTotals(equip(['diamond_chestplate']), out);
    expect(out.toughness).toBe(2);
    armorTotals(equip(['iron_chestplate']), out);
    expect(out.toughness).toBe(0);
  });
});

describe('redução de dano', () => {
  it('sem armadura o dano passa inteiro', () => {
    expect(reduceByArmor(10, 0, 0)).toBe(10);
  });

  it('usa a fórmula com toughness, não a aproximação', () => {
    // O doc 05 §3 dá as duas. A implementada é a de toughness, que com
    // toughness = 0 vira `armor − damage/2`: com 20 de armadura, um golpe de 5
    // vira 1,5 — e não 1, que é o que a aproximação simples daria.
    expect(reduceByArmor(5, 20, 0)).toBeCloseTo(1.5, 5);
  });

  it('golpe muito forte cai no piso de armor/5', () => {
    // Sem o piso, `armor − damage/2` ficaria negativo e a armadura sumiria
    // justamente contra o que mais machuca.
    expect(reduceByArmor(100, 20, 0)).toBeCloseTo(84, 5);
  });

  it('golpe forte fura a armadura sem resistência mais que com ela', () => {
    const withTough = reduceByArmor(30, 20, 8);
    const without = reduceByArmor(30, 20, 0);
    expect(withTough).toBeLessThan(without);
  });

  it('nunca deixa o dano negativo nem maior que o original', () => {
    for (const defense of [0, 3, 7, 11, 15, 20]) {
      for (const damage of [1, 4, 9, 20, 49]) {
        const result = reduceByArmor(damage, defense, 0);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(damage);
      }
    }
  });

  it('a armadura entra no dano de mob e não no de fome nem no void', () => {
    const survival = new Survival();
    survival.armor = 20;

    survival.damage(10, 'mob');
    const afterMob = survival.health;
    expect(afterMob).toBeGreaterThan(10);

    survival.health = 20;
    survival.invulnerable = 0;
    survival.damage(10, 'void', true);
    expect(survival.health).toBe(10);
  });
});

describe('ataque', () => {
  it('mão vazia faz 1 de dano', () => {
    expect(attackDamageOf(null)).toBe(1);
  });

  it('a espada segue a coluna de dano do doc 05 §2', () => {
    const expected: Record<string, number> = {
      wooden: 4, golden: 4, stone: 5, iron: 6, diamond: 7,
    };
    for (const material of Object.keys(expected)) {
      const sword = ITEM_BY_NAME.get(`${material}_sword`)!;
      expect(attackDamageOf(makeStack(sword.id, 1)), material).toBe(expected[material]);
    }
  });

  it('material melhor bate mais forte com a mesma ferramenta', () => {
    const wood = ITEM_BY_NAME.get('wooden_pickaxe')!;
    const diamond = ITEM_BY_NAME.get('diamond_pickaxe')!;
    expect(attackDamageOf(makeStack(diamond.id, 1)))
      .toBeGreaterThan(attackDamageOf(makeStack(wood.id, 1)));
  });

  it('espada bate mais rápido que machado', () => {
    const sword = makeStack(ITEM_BY_NAME.get('iron_sword')!.id, 1);
    const axe = makeStack(ITEM_BY_NAME.get('iron_axe')!.id, 1);
    expect(attackCooldownOf(sword)).toBeLessThan(attackCooldownOf(axe));
    // 1.6 ataques/s = 12,5 ticks.
    expect(attackCooldownOf(sword)).toBe(13);
  });

  it('a mão vazia é a mais rápida de todas', () => {
    expect(attackCooldownOf(null)).toBe(5);
  });

  it('cada peça perde durabilidade proporcional ao golpe, no mínimo 1', () => {
    expect(armorDurabilityCost(1)).toBe(1);
    expect(armorDurabilityCost(12)).toBe(3);
  });
});

describe('slots de armadura', () => {
  it('capacete só entra no slot da cabeça', () => {
    const inventory = new Inventory();
    const helmet = ITEM_BY_NAME.get('iron_helmet')!;
    inventory.cursor = makeStack(helmet.id, 1);

    // Slot das botas recusa.
    expect(inventory.click(ARMOR_START + 3, 'left')).toBe(false);
    expect(inventory.click(ARMOR_START, 'left')).toBe(true);
    expect(inventory.get(ARMOR_START)?.item).toBe(helmet.id);
  });

  it('bloco nenhum entra em slot de armadura', () => {
    const inventory = new Inventory();
    inventory.cursor = makeStack(ITEM_BY_NAME.get('dirt')!.id, 1);
    expect(inventory.click(ARMOR_START, 'left')).toBe(false);
    expect(inventory.get(ARMOR_START)).toBe(null);
  });

  it('shift+clique equipa a peça direto', () => {
    const inventory = new Inventory();
    const boots = ITEM_BY_NAME.get('diamond_boots')!;
    inventory.set(0, makeStack(boots.id, 1));
    expect(inventory.click(0, 'left', { shift: true })).toBe(true);
    expect(inventory.get(ARMOR_START + 3)?.item).toBe(boots.id);
  });

  it('tirar a peça do slot continua funcionando', () => {
    const inventory = new Inventory();
    const helmet = ITEM_BY_NAME.get('iron_helmet')!;
    inventory.set(ARMOR_START, makeStack(helmet.id, 1));
    expect(inventory.click(ARMOR_START, 'left')).toBe(true);
    expect(inventory.cursor?.item).toBe(helmet.id);
  });
});

describe('explosão', () => {
  it('o creeper (força 3) mata quem está abraçado nele', () => {
    // Doc 07 §2: dano até 49.
    const damage = explosionDamage(3, 0, 3.9);
    expect(damage).toBeGreaterThanOrEqual(45);
    expect(damage).toBeLessThanOrEqual(55);
  });

  it('o dano cai com a distância e zera na borda', () => {
    const near = explosionDamage(3, 1, 3.9);
    const far = explosionDamage(3, 3, 3.9);
    expect(near).toBeGreaterThan(far);
    expect(explosionDamage(3, 3.9, 3.9)).toBe(0);
    expect(explosionDamage(3, 10, 3.9)).toBe(0);
  });
});
