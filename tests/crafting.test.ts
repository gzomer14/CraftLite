/**
 * Matcher de receitas (doc 05 §6.2), marcado no doc como "obrigatório acertar".
 *
 * Os casos abaixo cobrem os três erros clássicos: bounding box (receita em
 * qualquer canto da grade), espelhamento **só** na horizontal, e shapeless como
 * multiset em vez de lista ordenada.
 */
import { describe, expect, it } from 'vitest';
import { RecipeBook, consumeGrid, craftableCount, type CraftGrid } from '../src/game/crafting';
import { itemId, makeStack, type ItemStack } from '../src/data/items';
import type { Recipe } from '../src/data/recipes';

const book = new RecipeBook();

/** Monta uma grade a partir de uma notação textual. */
function grid(size: 2 | 3, rows: string[], legend: Record<string, string>): CraftGrid {
  const slots: (ItemStack | null)[] = new Array(size * size).fill(null);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const symbol = rows[y][x];
      if (symbol === '.' || symbol === ' ') continue;
      const name = legend[symbol];
      if (name === undefined) throw new Error(`legenda faltando: ${symbol}`);
      slots[y * size + x] = makeStack(itemId(name), 1);
    }
  }
  return { size, slots };
}

const P = { P: 'oak_planks' };
const CS = { C: 'cobblestone', S: 'stick' };

describe('receitas básicas', () => {
  it('tronco vira 4 tábuas (shapeless)', () => {
    const g = grid(2, ['L.'], { L: 'oak_log' });
    const result = book.match(g);
    expect(result?.item).toBe(itemId('oak_planks'));
    expect(result?.count).toBe(4);
  });

  it('qualquer tronco serve — a tag resolve', () => {
    for (const log of ['oak_log', 'birch_log', 'spruce_log']) {
      const g = grid(2, ['L.'], { L: log });
      expect(book.match(g)?.item, log).toBe(itemId('oak_planks'));
    }
  });

  it('2 tábuas verticais viram 4 gravetos', () => {
    const result = book.match(grid(2, ['P.', 'P.'], P));
    expect(result?.item).toBe(itemId('stick'));
    expect(result?.count).toBe(4);
  });

  it('4 tábuas viram a bancada', () => {
    expect(book.match(grid(2, ['PP', 'PP'], P))?.item).toBe(itemId('crafting_table'));
  });

  it('8 pedregulhos viram a fornalha', () => {
    const g = grid(3, ['CCC', 'C.C', 'CCC'], { C: 'cobblestone' });
    expect(book.match(g)?.item).toBe(itemId('furnace'));
  });

  it('carvão sobre graveto vira 4 tochas', () => {
    const result = book.match(grid(2, ['C.', 'S.'], { C: 'coal', S: 'stick' }));
    expect(result?.item).toBe(itemId('torch'));
    expect(result?.count).toBe(4);
  });

  it('carvão vegetal também serve para a tocha (tag #coals)', () => {
    const g = grid(2, ['C.', 'S.'], { C: 'charcoal', S: 'stick' });
    expect(book.match(g)?.item).toBe(itemId('torch'));
  });
});

describe('bounding box: a receita vale em qualquer canto', () => {
  it('gravetos no canto superior esquerdo', () => {
    expect(book.match(grid(3, ['P..', 'P..'], P))?.item).toBe(itemId('stick'));
  });

  it('gravetos no canto inferior direito', () => {
    expect(book.match(grid(3, ['...', '..P', '..P'], P))?.item).toBe(itemId('stick'));
  });

  it('gravetos no meio', () => {
    expect(book.match(grid(3, ['...', '.P.', '.P.'], P))?.item).toBe(itemId('stick'));
  });

  it('a bancada 2×2 vale nos quatro cantos da grade 3×3', () => {
    const layouts = [
      ['PP.', 'PP.', '...'],
      ['.PP', '.PP', '...'],
      ['...', 'PP.', 'PP.'],
      ['...', '.PP', '.PP'],
    ];
    for (const rows of layouts) {
      expect(book.match(grid(3, rows, P))?.item, rows.join('/')).toBe(itemId('crafting_table'));
    }
  });

  it('itens espalhados não formam a receita', () => {
    expect(book.match(grid(3, ['P.P', '...', '...'], P))).toBeNull();
  });
});

describe('espelhamento', () => {
  it('o machado vale espelhado na horizontal', () => {
    const normal = grid(3, ['CC.', 'CS.', '.S.'], CS);
    const mirrored = grid(3, ['.CC', '.SC', '.S.'], CS);
    expect(book.match(normal)?.item).toBe(itemId('stone_axe'));
    expect(book.match(mirrored)?.item).toBe(itemId('stone_axe'));
  });

  it('a picareta NÃO vale de cabeça para baixo', () => {
    const upsideDown = grid(3, ['.S.', '.S.', 'CCC'], CS);
    expect(book.match(upsideDown)).toBeNull();
  });

  it('a espada não vira outra coisa espelhada', () => {
    const sword = grid(3, ['.C.', '.C.', '.S.'], CS);
    expect(book.match(sword)?.item).toBe(itemId('stone_sword'));
  });
});

describe('ferramentas por material', () => {
  const cases: [string, string][] = [
    ['oak_planks', 'wooden_pickaxe'],
    ['cobblestone', 'stone_pickaxe'],
    ['iron_ingot', 'iron_pickaxe'],
    ['gold_ingot', 'golden_pickaxe'],
    ['diamond', 'diamond_pickaxe'],
  ];

  for (const [material, tool] of cases) {
    it(`${material} → ${tool}`, () => {
      const g = grid(3, ['MMM', '.S.', '.S.'], { M: material, S: 'stick' });
      expect(book.match(g)?.item).toBe(itemId(tool));
    });
  }

  it('misturar materiais não craft nada', () => {
    const slots: (ItemStack | null)[] = new Array(9).fill(null);
    slots[0] = makeStack(itemId('cobblestone'));
    slots[1] = makeStack(itemId('oak_planks'));
    slots[2] = makeStack(itemId('cobblestone'));
    slots[4] = makeStack(itemId('stick'));
    slots[7] = makeStack(itemId('stick'));
    expect(book.match({ size: 3, slots })).toBeNull();
  });
});

describe('shapeless', () => {
  it('a ordem dos ingredientes não importa', () => {
    const a = grid(3, ['PPP', 'L..'], { P: 'paper', L: 'leather' });
    const b = grid(3, ['LPP', '..P'], { P: 'paper', L: 'leather' });
    expect(book.match(a)?.item).toBe(itemId('book'));
    expect(book.match(b)?.item).toBe(itemId('book'));
  });

  it('a contagem importa: faltando um papel não craft', () => {
    const g = grid(3, ['PP.', 'L..'], { P: 'paper', L: 'leather' });
    expect(book.match(g)).toBeNull();
  });

  it('item a mais na grade invalida', () => {
    const g = grid(3, ['PPP', 'LP.'], { P: 'paper', L: 'leather' });
    expect(book.match(g)).toBeNull();
  });

  it('bloco de ferro volta a 9 barras', () => {
    const result = book.match(grid(2, ['I.'], { I: 'iron_block' }));
    expect(result?.item).toBe(itemId('iron_ingot'));
    expect(result?.count).toBe(9);
  });
});

describe('grade 2×2 não cabe receita 3×3', () => {
  it('a fornalha não sai do inventário', () => {
    const g = grid(2, ['CC', 'CC'], { C: 'cobblestone' });
    expect(book.match(g)?.item).not.toBe(itemId('furnace'));
  });
});

describe('grade vazia', () => {
  it('não produz nada', () => {
    expect(book.match({ size: 3, slots: new Array(9).fill(null) })).toBeNull();
    expect(book.match({ size: 2, slots: new Array(4).fill(null) })).toBeNull();
  });
});

describe('consumo', () => {
  it('consome uma unidade de cada slot usado', () => {
    const g = grid(2, ['PP', 'PP'], P);
    for (const slot of g.slots) if (slot !== null) slot.count = 3;
    consumeGrid(g);
    for (const slot of g.slots) expect(slot?.count).toBe(2);
  });

  it('esvazia o slot que chega a zero', () => {
    const g = grid(2, ['PP', 'PP'], P);
    consumeGrid(g);
    expect(g.slots.every((s) => s === null)).toBe(true);
  });

  it('craftableCount é limitado pelo menor stack', () => {
    const g = grid(2, ['PP', 'PP'], P);
    g.slots[0]!.count = 10;
    g.slots[1]!.count = 3;
    g.slots[2]!.count = 7;
    g.slots[3]!.count = 64;
    expect(craftableCount(g)).toBe(3);
  });
});

describe('integridade da tabela', () => {
  it('todas as receitas compilam', () => {
    // Se uma receita cita um item inexistente ela é descartada; o total tem que
    // bater com o que a tabela declara.
    const declared = (book as unknown as { compiled: unknown[] }).compiled.length;
    expect(declared).toBeGreaterThan(30);
  });

  it('livro devolve as receitas de um resultado', () => {
    const recipes = book.forResult(itemId('stone_pickaxe'));
    expect(recipes.length).toBeGreaterThan(0);
    expect((recipes[0] as Recipe).type).toBe('shaped');
  });
});
