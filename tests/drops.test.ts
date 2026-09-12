/**
 * Drops de bloco. A regra "dropa a si mesmo" com tabela só para exceções é o
 * que mantém a tabela pequena; os testes garantem que as exceções valem e que
 * a ferramenta certa é exigida.
 */
import { describe, expect, it } from 'vitest';
import { rollDrops } from '../src/game/drops';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, itemId, type ToolSpec } from '../src/data/items';

const SEED = 4242;
const tool = (name: string): ToolSpec => ITEM_BY_NAME.get(name)!.tool!;
const state = (name: string): number => makeState(BLOCK_BY_NAME.get(name)!.id);

function drops(block: string, held?: string, x = 1, y = 2, z = 3): { item: number; count: number }[] {
  return rollDrops(state(block), held === undefined ? undefined : tool(held), SEED, x, y, z)
    .map((s) => ({ item: s.item, count: s.count }));
}

describe('regra padrão', () => {
  it('terra dropa terra', () => {
    expect(drops('dirt')).toEqual([{ item: itemId('dirt'), count: 1 }]);
  });

  it('tábuas dropam a si mesmas', () => {
    expect(drops('oak_planks')).toEqual([{ item: itemId('oak_planks'), count: 1 }]);
  });
});

describe('exceções da tabela', () => {
  it('pedra dropa pedregulho', () => {
    expect(drops('stone', 'wooden_pickaxe')).toEqual([{ item: itemId('cobblestone'), count: 1 }]);
  });

  it('grama dropa terra', () => {
    expect(drops('grass_block')).toEqual([{ item: itemId('dirt'), count: 1 }]);
  });

  it('minério de carvão dropa carvão', () => {
    expect(drops('coal_ore', 'wooden_pickaxe')).toEqual([{ item: itemId('coal'), count: 1 }]);
  });

  it('minério de ferro dropa ferro bruto', () => {
    expect(drops('iron_ore', 'stone_pickaxe')).toEqual([{ item: itemId('raw_iron'), count: 1 }]);
  });

  it('argila dropa 4 bolas', () => {
    expect(drops('clay')).toEqual([{ item: itemId('clay_ball'), count: 4 }]);
  });

  it('vidro não dropa nada', () => {
    expect(drops('glass')).toEqual([]);
  });

  it('bedrock não dropa nada', () => {
    expect(drops('bedrock', 'diamond_pickaxe')).toEqual([]);
  });
});

describe('ferramenta obrigatória', () => {
  it('pedra à mão não dropa', () => {
    expect(drops('stone')).toEqual([]);
  });

  it('ferro com picareta de madeira não dropa', () => {
    expect(drops('iron_ore', 'wooden_pickaxe')).toEqual([]);
  });

  it('diamante com picareta de pedra não dropa', () => {
    expect(drops('diamond_ore', 'stone_pickaxe')).toEqual([]);
  });

  it('diamante com picareta de ferro dropa', () => {
    expect(drops('diamond_ore', 'iron_pickaxe')).toEqual([{ item: itemId('diamond'), count: 1 }]);
  });
});

describe('determinismo', () => {
  it('a mesma posição dá sempre o mesmo drop', () => {
    const a = drops('gravel', undefined, 10, 20, 30);
    const b = drops('gravel', undefined, 10, 20, 30);
    expect(a).toEqual(b);
  });

  it('posições diferentes variam', () => {
    // Cascalho dropa sílex 10% das vezes; em 200 posições deve sair alguma vez.
    let flint = 0;
    for (let i = 0; i < 200; i++) {
      if (drops('gravel', undefined, i, 40, 7).some((d) => d.item === itemId('flint'))) flint++;
    }
    expect(flint).toBeGreaterThan(5);
    expect(flint).toBeLessThan(50);
  });

  it('faixas de contagem ficam dentro do declarado', () => {
    for (let i = 0; i < 100; i++) {
      const result = drops('redstone_ore', 'iron_pickaxe', i, 12, 5);
      if (result.length === 0) continue;
      expect(result[0].count).toBeGreaterThanOrEqual(4);
      expect(result[0].count).toBeLessThanOrEqual(5);
    }
  });
});

describe('drops com chance', () => {
  it('folhas quase sempre não dropam nada', () => {
    let withDrop = 0;
    for (let i = 0; i < 300; i++) {
      if (drops('oak_leaves', undefined, i, 70, 3).length > 0) withDrop++;
    }
    // 5% de muda + 2% de maçã ≈ 7% das vezes.
    expect(withDrop).toBeGreaterThan(5);
    expect(withDrop).toBeLessThan(60);
  });
});
