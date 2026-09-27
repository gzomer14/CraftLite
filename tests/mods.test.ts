/**
 * Mods (M21): o que um mod acrescenta, e — o ponto do marco — o que ele
 * **não** muda.
 *
 * As tabelas de `src/data/` se montam na avaliação do módulo, lendo
 * `globalThis.__CRAFTLITE_MODS__` (`mods/active.ts`). Cada caso aqui recarrega
 * os módulos (`vi.resetModules`) com o global do jeito que o boot o deixaria:
 * ausente (o `index.html` subiu o jogo direto), vazio, ou com o mod de exemplo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import exemplo from '../src/mods/exemplo/mod';
import { acceptMods, modProblems } from '../src/mods/validate';
import { MOD_BLOCK_FIRST, MOD_BLOCK_LAST, MOD_ITEM_FIRST, type ModDef } from '../src/mods/types';
import { MOD_CATALOG, MODS_STORAGE_KEY } from '../src/mods/catalog';
import { MOD_LOADERS } from '../src/mods/loaders';

type Global = { __CRAFTLITE_MODS__?: readonly ModDef[] };

/** Recarrega o jogo com os mods do jeito que o boot os deixaria. */
async function loadGame(mods: readonly ModDef[] | undefined) {
  vi.resetModules();
  const g = globalThis as Global;
  if (mods === undefined) delete g.__CRAFTLITE_MODS__;
  else g.__CRAFTLITE_MODS__ = mods;
  const [blocks, items, recipes, smelting, textures, itemart, layers, blockinfo] = await Promise.all([
    import('../src/data/blocks'),
    import('../src/data/items'),
    import('../src/data/recipes'),
    import('../src/data/smelting'),
    import('../src/data/textures'),
    import('../src/data/itemart'),
    import('../src/render/layers'),
    import('../src/world/mesh/blockinfo'),
  ]);
  delete g.__CRAFTLITE_MODS__;
  return { blocks, items, recipes, smelting, textures, itemart, layers, blockinfo };
}

type Game = Awaited<ReturnType<typeof loadGame>>;

/** Uma linha de tabela sem as funções (texturas têm `ops`), para comparar. */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

function sameVanilla(a: Game, b: Game): void {
  const blockIds = a.blocks.BLOCKS.length;
  for (let id = 0; id < blockIds; id++) {
    expect(plain(b.blocks.BLOCKS[id]), `bloco ${id}`).toEqual(plain(a.blocks.BLOCKS[id]));
  }
  for (let id = 0; id < a.items.ITEMS.length; id++) {
    // Os itens dos blocos de mod têm o id do bloco (faixa de blocos de mod).
    if (id >= MOD_BLOCK_FIRST && id <= MOD_BLOCK_LAST) continue;
    expect(plain(b.items.ITEMS[id]), `item ${id}`).toEqual(plain(a.items.ITEMS[id]));
  }
  expect(plain(b.recipes.RECIPES.slice(0, a.recipes.RECIPES.length))).toEqual(plain(a.recipes.RECIPES));
  expect(plain(b.smelting.SMELTING.slice(0, a.smelting.SMELTING.length))).toEqual(plain(a.smelting.SMELTING));
  expect(b.textures.TEXTURE_NAMES.slice(0, a.textures.TEXTURE_NAMES.length)).toEqual(a.textures.TEXTURE_NAMES);
  // As camadas do jogo não mudam de número: o atlas e o worker concordam.
  const la = a.layers.buildLayerIndex();
  const lb = b.layers.buildLayerIndex();
  for (const [name, info] of la.byName) expect(lb.byName.get(name), name).toEqual(info);
  for (const name of Object.keys(a.itemart.ITEM_ART)) {
    expect(b.itemart.ITEM_ART[name], name).toEqual(a.itemart.ITEM_ART[name]);
  }
}

afterEach(() => {
  delete (globalThis as Global).__CRAFTLITE_MODS__;
});

describe('sem mod ligado, o jogo é o de antes', () => {
  it('global ausente e lista vazia dão exatamente as mesmas tabelas', async () => {
    const absent = await loadGame(undefined);
    const empty = await loadGame([]);
    expect(empty.blocks.BLOCKS.length).toBe(absent.blocks.BLOCKS.length);
    expect(empty.items.ITEMS.length).toBe(absent.items.ITEMS.length);
    expect(empty.recipes.RECIPES.length).toBe(absent.recipes.RECIPES.length);
    expect(empty.textures.TEXTURE_NAMES).toEqual(absent.textures.TEXTURE_NAMES);
    sameVanilla(absent, empty);
  });

  it('nenhum id do jogo cai nas faixas reservadas a mod', async () => {
    const game = await loadGame(undefined);
    expect(game.blocks.BLOCKS.length).toBeLessThanOrEqual(MOD_BLOCK_FIRST);
    expect(game.items.ITEMS.length).toBeLessThanOrEqual(MOD_ITEM_FIRST);
    expect(game.blocks.BLOCK_BY_NAME.size).toBeGreaterThan(100);
    for (const name of game.blocks.BLOCK_BY_NAME.keys()) expect(name).not.toContain(':');
    // Item de bloco tem o id do bloco: a faixa de blocos de mod é livre também
    // na tabela de itens.
    for (let id = MOD_BLOCK_FIRST; id <= MOD_BLOCK_LAST; id++) expect(game.items.ITEMS[id]).toBeUndefined();
  });

  it('as tabelas do mesher têm o tamanho de antes', async () => {
    const game = await loadGame(undefined);
    const tables = game.blockinfo.buildBlockTables(game.layers.buildLayerIndex());
    expect(tables.renderLayer.length).toBe(game.blocks.BLOCKS.length);
  });

  it('a Session sem mod roda o tick do protótipo, sem embrulho', async () => {
    vi.resetModules();
    const { attachModSystems } = await import('../src/mods/systems');
    const tick = (): void => undefined;
    const session = { tick } as unknown as Parameters<typeof attachModSystems>[0];
    attachModSystems(session);
    expect(session.tick).toBe(tick);
  });

  it('mundo jogado sem mod não ganha o campo `mods`', async () => {
    vi.resetModules();
    const { missingMods, modsToRecord } = await import('../src/mods/worldmods');
    expect(modsToRecord()).toBeUndefined();
    expect(missingMods(undefined)).toEqual([]);
    expect(missingMods(['exemplo'])).toEqual(['exemplo']);
  });
});

describe('com o mod de exemplo', () => {
  it('as linhas do jogo continuam idênticas', async () => {
    sameVanilla(await loadGame(undefined), await loadGame([exemplo]));
  });

  it('o bloco, o item, a arte, a textura e as receitas entram nas faixas do mod', async () => {
    const game = await loadGame([exemplo]);
    const crystal = game.blocks.BLOCK_BY_NAME.get('exemplo:cristal_luz');
    expect(crystal?.id).toBe(MOD_BLOCK_FIRST);
    expect(crystal?.emission).toBe(15);
    // O bloco vira item com o mesmo id, como todo bloco do jogo.
    expect(game.items.ITEM_BY_NAME.get('exemplo:cristal_luz')?.placesBlock).toBe(MOD_BLOCK_FIRST);
    expect(game.items.ITEM_BY_NAME.get('exemplo:fragmento')?.id).toBe(MOD_ITEM_FIRST);
    expect(game.itemart.SHAPES['exemplo:shard']).toHaveLength(16);
    expect(game.itemart.ITEM_ART['exemplo:fragmento']?.shape).toBe('exemplo:shard');
    const index = game.layers.buildLayerIndex();
    const tables = game.blockinfo.buildBlockTables(index);
    expect(tables.texSide[MOD_BLOCK_FIRST]).toBe(index.byName.get('exemplo:block/cristal_luz')?.layer);
    expect(tables.emission[MOD_BLOCK_FIRST]).toBe(15);
  });

  it('vidro e redstone dão fragmentos; quatro fragmentos, o cristal', async () => {
    const game = await loadGame([exemplo]);
    const { RecipeBook } = await import('../src/game/crafting');
    const book = new RecipeBook();
    const id = (name: string): number => game.items.itemId(name);
    const slots = new Array(4).fill(null);
    slots[0] = game.items.makeStack(id('glass'));
    slots[3] = game.items.makeStack(id('redstone'));
    expect(book.match({ size: 2, slots })).toMatchObject({ item: id('exemplo:fragmento'), count: 2 });
    const shard = (): unknown => game.items.makeStack(id('exemplo:fragmento'));
    expect(book.match({ size: 2, slots: [shard(), shard(), shard(), shard()] as never }))
      .toMatchObject({ item: MOD_BLOCK_FIRST, count: 1 });
  });

  it('o bloco do mod vai para o save e volta', async () => {
    await loadGame([exemplo]);
    const { ChunkColumn } = await import('../src/world/chunk');
    const { serializeChunk, deserializeChunk } = await import('../src/save/serialize');
    const { makeState } = await import('../src/data/blocks');
    const chunk = new ChunkColumn(0, 0);
    chunk.setBlock(3, 70, 4, makeState(MOD_BLOCK_FIRST));
    const back = deserializeChunk(serializeChunk(chunk));
    expect(back.getBlock(3, 70, 4) & 0x3ff).toBe(MOD_BLOCK_FIRST);
  });

  it('o tick do mod cura quem está em cima do cristal, meio coração a cada 2 s', async () => {
    vi.resetModules();
    (globalThis as Global).__CRAFTLITE_MODS__ = [exemplo];
    const { attachModSystems } = await import('../src/mods/systems');
    delete (globalThis as Global).__CRAFTLITE_MODS__;
    const heal = vi.fn();
    const base = vi.fn();
    const session = {
      tick: base,
      world: { getBlock: () => MOD_BLOCK_FIRST },
      player: { x: 0.5, y: 71, z: 0.5 },
      survival: { health: 10, heal },
      inventory: { giveStack: () => 0 },
    } as unknown as Parameters<typeof attachModSystems>[0];
    attachModSystems(session);
    for (let i = 0; i < 80; i++) session.tick();
    expect(base).toHaveBeenCalledTimes(80);
    expect(heal).toHaveBeenCalledTimes(2);
  });

  it('mundo jogado com o mod o guarda, e sem ele pede o mod', async () => {
    vi.resetModules();
    (globalThis as Global).__CRAFTLITE_MODS__ = [exemplo];
    const { missingMods, modsToRecord } = await import('../src/mods/worldmods');
    delete (globalThis as Global).__CRAFTLITE_MODS__;
    expect(modsToRecord()).toEqual(['exemplo']);
    expect(missingMods(['exemplo'])).toEqual([]);
  });
});

describe('conferência de mod', () => {
  it('o mod de exemplo passa sem problema', () => {
    expect(modProblems(exemplo)).toEqual([]);
    expect(acceptMods([exemplo]).accepted).toEqual([exemplo]);
  });

  it('recusa nome sem prefixo, id fora da faixa e nome sem inglês', () => {
    const bad: ModDef = {
      id: 'ruim', version: 1, blockBase: 700, itemBase: 4096,
      blocks: [{ name: 'pedra', display: 'Pedra' }],
      items: [{ name: 'ruim:coisa', display: 'Coisa' }],
      en: {},
    };
    const problems = modProblems(bad).join('\n');
    expect(problems).toContain('prefixo');
    expect(problems).toContain('fora da faixa');
    expect(problems).toContain('inglês');
  });

  it('dois mods na mesma faixa: o segundo fica de fora, o primeiro entra', () => {
    const copy: ModDef = { ...exemplo, id: 'copia', blocks: [], items: [
      { name: 'copia:x', display: 'X' },
    ], itemShapes: {}, itemArt: {}, textures: undefined, recipes: [], en: { 'copia:x': 'X' } };
    const { accepted, problems } = acceptMods([exemplo, copy]);
    expect(accepted).toEqual([exemplo]);
    expect(problems.join('\n')).toContain('faixa de itens');
  });

  it('silhueta fora de 16×16 é recusada', () => {
    const shapes = { 'exemplo:torta': ['xx'] };
    expect(modProblems({ ...exemplo, itemShapes: shapes }).join('\n')).toContain('16×16');
  });
});

describe('catálogo, carregadores e boot contam a mesma história', () => {
  it('todo mod do catálogo tem carregador, e vice-versa', () => {
    expect(Object.keys(MOD_LOADERS).sort()).toEqual(MOD_CATALOG.map((info) => info.id).sort());
  });

  it('o carregador entrega o mod com o id do catálogo', async () => {
    for (const info of MOD_CATALOG) {
      const mod = (await MOD_LOADERS[info.id]()).default;
      expect(mod.id).toBe(info.id);
      expect(modProblems(mod)).toEqual([]);
    }
  });

  it('todos os mods do catálogo ligados juntos: nenhum recusado, e cabem no atlas', async () => {
    const all = await Promise.all(MOD_CATALOG.map(async (info) => (await MOD_LOADERS[info.id]()).default));
    const { accepted, problems } = acceptMods(all);
    expect(problems).toEqual([]);
    expect(accepted).toHaveLength(all.length);
    // O WebGL1 desenha num atlas 2D de 16×16 ladrilhos: 256 é teto duro.
    const game = await loadGame(accepted);
    expect(game.layers.buildLayerIndex().count).toBeLessThanOrEqual(256);
  });

  it('a chave de armazenamento é a mesma no index.html, no boot e no catálogo', () => {
    expect(readFileSync('index.html', 'utf8')).toContain(`localStorage.getItem('${MODS_STORAGE_KEY}')`);
    expect(readFileSync('src/mods/boot.ts', 'utf8')).toContain(`'${MODS_STORAGE_KEY}'`);
  });
});
