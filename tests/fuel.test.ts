/**
 * Combustível e fundição do doc 05 §5 e §7.
 *
 * Até 2026-09-22 **nenhum bloco queimava**: o item de bloco é derivado da
 * tabela de blocos, e ela não tinha coluna de combustível. Tábua, tronco e
 * muda — os três primeiros combustíveis que um jogador tem na mão — não
 * entravam na fornalha. O bloco de carvão e a pedra lisa, também do doc, não
 * existiam.
 */
import { describe, expect, it } from 'vitest';
import { ITEM_BY_NAME } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { fuelTicks, smeltingOutput } from '../src/game/container';

const item = (name: string): number => {
  const def = ITEM_BY_NAME.get(name);
  if (def === undefined) throw new Error(name);
  return def.id;
};

describe('combustível (doc 05 §5)', () => {
  it('tábua e tronco queimam 300 ticks', () => {
    for (const wood of ['oak', 'birch', 'spruce', 'acacia', 'jungle']) {
      expect(fuelTicks(item(`${wood}_planks`)), `${wood}_planks`).toBe(300);
      expect(fuelTicks(item(`${wood}_log`)), `${wood}_log`).toBe(300);
    }
  });

  it('muda queima 100 ticks', () => {
    for (const wood of ['oak', 'birch', 'spruce', 'acacia', 'jungle']) {
      expect(fuelTicks(item(`${wood}_sapling`)), wood).toBe(100);
    }
  });

  it('bloco de carvão queima 16 000 ticks, dez vezes o carvão', () => {
    expect(fuelTicks(item('coal_block'))).toBe(16000);
    expect(fuelTicks(item('coal_block'))).toBe(fuelTicks(item('coal')) * 10);
  });

  it('pedra e terra não queimam', () => {
    expect(fuelTicks(item('stone'))).toBe(0);
    expect(fuelTicks(item('dirt'))).toBe(0);
  });

  it('bloco de carvão se faz com nove carvões e se desfaz em nove', () => {
    const make = RECIPES.find((r) => r.result.item === 'coal_block');
    const undo = RECIPES.find((r) => r.result.item === 'coal' && r.type === 'shapeless');
    expect(make).toBeDefined();
    expect(undo?.result.count).toBe(9);
  });
});

describe('fundição (doc 05 §7)', () => {
  it('pedregulho vira pedra, e pedra vira pedra lisa', () => {
    expect(smeltingOutput(item('cobblestone'))).toBe(item('stone'));
    expect(smeltingOutput(item('stone'))).toBe(item('smooth_stone'));
  });
});
