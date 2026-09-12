/**
 * Baú duplo, livro de receitas e inventário criativo
 * (pendências P5, P6 e P7 do M4).
 *
 * Os três são interface, mas o que decide se funcionam é lógica pura: para onde
 * vai o índice 30 de um baú duplo, quais receitas dá para fazer com o que está
 * na mochila, e em que aba cai cada item. É isso que está aqui.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, ITEMS, itemDef, makeStack } from '../src/data/items';
import { Container, DoubleChestView } from '../src/game/container';
import { RecipeBook } from '../src/game/crafting';
import { CRAFT_START } from '../src/game/inventory';
import { tabOf } from '../src/ui/containers/creative';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
const chestState = makeState(BLOCK_BY_NAME.get('chest')!.id);
const benchState = makeState(BLOCK_BY_NAME.get('crafting_table')!.id);

function harness() {
  const world = new World(31);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      chunk.recomputeHeightMap();
      for (const section of chunk.sections) {
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
      }
      world.addChunk(chunk);
    }
  }

  const player = new Player(8.5, GROUND_Y + 1, 8.5);
  const screens: string[] = [];
  const session = new Session(world, player, {
    onOpenScreen: (kind) => screens.push(kind),
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
  });
  return { world, player, session, screens };
}

/** Aponta o jogador para o bloco em `(x, y, z)` e usa o item na mão. */
function useBlockAt(h: ReturnType<typeof harness>, x: number, y: number, z: number): boolean {
  h.player.setPosition(x + 0.5, y + 1, z + 0.5);
  h.player.pitch = Math.PI / 2 - 0.01;
  h.session.interaction.updateTarget();
  return h.session.useHeld();
}

describe('baú duplo (P6)', () => {
  it('a visão soma os dois baús e encaminha o índice', () => {
    const left = new Container('chest', 27, 0, 64, 0);
    const right = new Container('chest', 27, 1, 64, 0);
    const view = new DoubleChestView(left, right);

    expect(view.size).toBe(54);
    expect(view.kind).toBe('double_chest');

    view.set(2, makeStack(ITEM_BY_NAME.get('coal')!.id, 5));
    view.set(30, makeStack(ITEM_BY_NAME.get('diamond')!.id, 1));

    expect(left.get(2)?.count).toBe(5);
    expect(right.get(3)?.item).toBe(ITEM_BY_NAME.get('diamond')!.id);
    expect(view.get(30)?.item).toBe(ITEM_BY_NAME.get('diamond')!.id);
    // O que está no segundo baú não aparece no primeiro.
    expect(left.get(3)).toBeNull();
  });

  it('a visão reconhece os dois baús como seus', () => {
    const left = new Container('chest', 27, 0, 64, 0);
    const right = new Container('chest', 27, 1, 64, 0);
    const other = new Container('chest', 27, 9, 64, 9);
    const view = new DoubleChestView(left, right);

    expect(view.contains(left)).toBe(true);
    expect(view.contains(right)).toBe(true);
    expect(view.contains(other)).toBe(false);
  });

  it('dois baús colados abrem 54 slots', () => {
    const h = harness();
    h.world.setBlock(8, GROUND_Y, 8, chestState, 'player');
    h.world.setBlock(9, GROUND_Y, 8, chestState, 'player');

    expect(useBlockAt(h, 8, GROUND_Y, 8)).toBe(true);
    expect(h.session.openScreen).toBe('chest');
    expect(h.session.openContainer?.size).toBe(54);
  });

  it('abrir pela direita ou pela esquerda mostra a mesma ordem', () => {
    const h = harness();
    h.world.setBlock(8, GROUND_Y, 8, chestState, 'player');
    h.world.setBlock(9, GROUND_Y, 8, chestState, 'player');

    useBlockAt(h, 8, GROUND_Y, 8);
    h.session.openContainer?.set(0, makeStack(ITEM_BY_NAME.get('coal')!.id, 1));
    h.session.closeScreen();

    useBlockAt(h, 9, GROUND_Y, 8);
    expect(h.session.openContainer?.get(0)?.item).toBe(ITEM_BY_NAME.get('coal')!.id);
  });

  it('baú sozinho continua com 27', () => {
    const h = harness();
    h.world.setBlock(8, GROUND_Y, 8, chestState, 'player');
    expect(useBlockAt(h, 8, GROUND_Y, 8)).toBe(true);
    expect(h.session.openContainer?.size).toBe(27);
  });

  it('quebrar uma metade fecha a tela e dropa só o conteúdo dela', () => {
    const h = harness();
    h.world.setBlock(8, GROUND_Y, 8, chestState, 'player');
    h.world.setBlock(9, GROUND_Y, 8, chestState, 'player');
    useBlockAt(h, 8, GROUND_Y, 8);

    const coal = ITEM_BY_NAME.get('coal')!.id;
    h.session.openContainer?.set(0, makeStack(coal, 4));   // baú da esquerda
    h.session.openContainer?.set(27, makeStack(coal, 7));  // baú da direita

    const before = h.session.items.active;
    h.world.setBlock(8, GROUND_Y, 8, AIR, 'player');
    // A sessão só reage pelo `Interaction`; aqui simula-se a quebra direta.
    h.session.interaction.onBlockBroken?.(8, GROUND_Y, 8, chestState);

    expect(h.session.openScreen).toBe('none');
    expect(h.session.items.active).toBeGreaterThan(before);
    // O outro baú continua existindo com o que era dele.
    expect(h.session.containerAt(9, GROUND_Y, 8)?.get(0)?.count).toBe(7);
  });
});

describe('livro de receitas (P5)', () => {
  const book = new RecipeBook();

  it('toda receita vira uma entrada com resultado e células', () => {
    const entries = book.entries();
    expect(entries.length).toBe(book.size);
    for (const entry of entries) {
      expect(entry.resultItem).toBeGreaterThan(0);
      expect(entry.resultCount).toBeGreaterThan(0);
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
      expect(entry.cells.length).toBe(entry.width * entry.height);
    }
  });

  it('a entrada da bancada é 2×2 de tábua', () => {
    const bench = ITEM_BY_NAME.get('crafting_table')!.id;
    const entry = book.entries().find((e) => e.resultItem === bench);
    expect(entry).toBeDefined();
    expect(entry?.width).toBe(2);
    expect(entry?.height).toBe(2);
    for (const cell of entry?.cells ?? []) {
      expect(cell).not.toBeNull();
      expect(cell?.includes(ITEM_BY_NAME.get('oak_planks')!.id)).toBe(true);
    }
  });

  it('receita sem forma vira uma linha de ingredientes', () => {
    const planks = ITEM_BY_NAME.get('oak_planks')!.id;
    const entry = book.entries().find((e) => e.resultItem === planks && e.shapeless);
    expect(entry).toBeDefined();
    expect(entry?.cells.length).toBeGreaterThan(0);
  });

  it('a mesma lista é reusada entre chamadas', () => {
    expect(book.entries()).toBe(book.entries());
  });

  it('preencher a grade tira os ingredientes do inventário', () => {
    const h = harness();
    const planks = ITEM_BY_NAME.get('oak_planks')!;
    h.session.inventory.set(0, makeStack(planks.id, 8));

    const entry = h.session.recipes.entries()
      .find((e) => e.resultItem === ITEM_BY_NAME.get('crafting_table')!.id);
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(h.session.autoFillRecipe(entry)).toBe(true);
    // 4 tábuas saíram da pilha e foram para as 4 células da grade 2×2.
    expect(h.session.inventory.get(0)?.count).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(h.session.inventory.get(CRAFT_START + i)?.item).toBe(planks.id);
    }
    // E o resultado já aparece.
    expect(h.session.inventory.get(45)?.item).toBe(ITEM_BY_NAME.get('crafting_table')!.id);
  });

  it('sem ingrediente, nada sai do lugar', () => {
    const h = harness();
    const entry = h.session.recipes.entries()
      .find((e) => e.resultItem === ITEM_BY_NAME.get('crafting_table')!.id);
    if (entry === undefined) return;

    expect(h.session.autoFillRecipe(entry)).toBe(false);
    for (let i = 0; i < 4; i++) expect(h.session.inventory.get(CRAFT_START + i)).toBeNull();
  });

  it('receita 3×3 não cabe na grade 2×2 do inventário', () => {
    const h = harness();
    const iron = ITEM_BY_NAME.get('iron_ingot')!;
    h.session.inventory.set(0, makeStack(iron.id, 9));

    const entry = h.session.recipes.entries()
      .find((e) => e.resultItem === ITEM_BY_NAME.get('iron_block')!.id);
    expect(entry?.width).toBe(3);
    if (entry === undefined) return;
    expect(h.session.autoFillRecipe(entry)).toBe(false);
    expect(h.session.inventory.get(0)?.count).toBe(9);
  });

  it('na bancada, a receita 3×3 entra', () => {
    const h = harness();
    const iron = ITEM_BY_NAME.get('iron_ingot')!;
    h.session.inventory.set(0, makeStack(iron.id, 9));
    h.world.setBlock(8, GROUND_Y, 8, benchState, 'player');
    useBlockAt(h, 8, GROUND_Y, 8);
    expect(h.session.openScreen).toBe('crafting');

    const entry = h.session.recipes.entries()
      .find((e) => e.resultItem === ITEM_BY_NAME.get('iron_block')!.id);
    if (entry === undefined) return;

    expect(h.session.autoFillRecipe(entry)).toBe(true);
    expect(h.session.inventory.get(0)).toBeNull();
    expect(h.session.bench.get(4)?.item).toBe(iron.id);
  });
});

describe('abas do criativo (P7)', () => {
  it('cada tipo de item cai na aba esperada', () => {
    const tab = (name: string): string => tabOf(itemDef(ITEM_BY_NAME.get(name)!.id)!);
    expect(tab('stone')).toBe('blocks');
    expect(tab('iron_pickaxe')).toBe('tools');
    expect(tab('iron_sword')).toBe('combat');
    expect(tab('diamond_chestplate')).toBe('combat');
    expect(tab('bread')).toBe('food');
    expect(tab('stick')).toBe('materials');
  });

  it('todo item cai em exatamente uma aba conhecida', () => {
    const known = new Set(['blocks', 'tools', 'combat', 'food', 'materials']);
    for (const item of ITEMS) {
      if (item === undefined) continue;
      expect(known.has(tabOf(item)), item.name).toBe(true);
    }
  });

  it('as abas cobrem o catálogo inteiro', () => {
    let total = 0;
    for (const item of ITEMS) if (item !== undefined) total++;
    const counts = new Map<string, number>();
    for (const item of ITEMS) {
      if (item === undefined) continue;
      const tab = tabOf(item);
      counts.set(tab, (counts.get(tab) ?? 0) + 1);
    }
    let sum = 0;
    for (const value of counts.values()) sum += value;
    expect(sum).toBe(total);
    expect(counts.get('blocks') ?? 0).toBeGreaterThan(50);
  });
});
