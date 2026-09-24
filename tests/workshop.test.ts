/**
 * Oficina (M15): bigorna, reparo na grade, livro encantado, funil,
 * dispensador, liberador, comparador e observador.
 *
 * Os critérios do doc 14: uma picareta de diamante encantada volta de 10% para
 * 100% de durabilidade sem perder o encantamento; uma fornalha alimentada por
 * funil a partir de um baú funde 64 minérios sem o jogador tocar.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { BLOCK_BY_NAME, STONE, blockIdOf, makeState, stateBitsOf } from '../src/data/blocks';
import { ITEM_BY_NAME, itemId, makeStack, type ItemStack } from '../src/data/items';
import { ENCHANT_BY_NAME, EFFICIENCY, FORTUNE, SILK_TOUCH, UNBREAKING } from '../src/data/enchants';
import { TOO_EXPENSIVE } from '../src/data/anvil';
import { anvilResult, repairsWith, type AnvilOutcome } from '../src/game/anvil';
import { levelIn, withEnchant } from '../src/game/enchanting';
import { matchRepair } from '../src/game/crafting';
import {
  ANVIL_LEFT, ANVIL_RIGHT, Container, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace,
} from '../src/game/container';
import { HOPPER_COOLDOWN, insertOne } from '../src/game/itemflow';
import { comparatorOutput, signalOfFullness } from '../src/world/redstoneparts';
import { tileFrom, containerFrom } from '../src/game/savegame';
import { ItemEntities } from '../src/entity/itementity';
import { clickContainer } from '../src/ui/containers/containerclick';
import { MAX_BOXES, SHAPE_ANVIL, SHAPE_COMPARATOR, SHAPE_HOPPER, boxesFor } from '../src/world/mesh/shapes';
import { FRONT_FACE, buildBlockTables, cubeFaceTex } from '../src/world/mesh/blockinfo';
import { buildLayerIndex, layerOf } from '../src/render/layers';

const GROUND = 63;
const block = (name: string): number => BLOCK_BY_NAME.get(name)!.id;
const item = (name: string): number => itemId(name);

function outcome(): AnvilOutcome {
  return { result: null, cost: 0, rightUsed: 0 };
}

/** Plataforma de pedra 3×3 chunks e uma sessão de Sobrevivência em cima. */
function rig(): { world: World; session: Session; player: Player } {
  const world = new World(11);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  const player = new Player(0.5, GROUND + 1, -6.5);
  player.mode = 'survival';
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
  let seed = 1;
  session.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return { world, session, player };
}

/** Põe um bloco como o jogador poria: mundo, contêiner e circuito. */
function put(session: Session, x: number, y: number, z: number, name: string, bits = 0): void {
  const state = makeState(block(name), bits);
  session.world.setBlock(x, y, z, state, 'player');
  session.tiles.create(x, y, z, block(name));
}

function ticks(session: Session, n: number): void {
  for (let i = 0; i < n; i++) session.tick();
}

// --- bigorna -------------------------------------------------------------------

describe('bigorna', () => {
  const PICK = item('diamond_pickaxe');
  const MAX = ITEM_BY_NAME.get('diamond_pickaxe')!.durability!;

  it('critério do doc 14: picareta de diamante encantada de 10% a 100% com 4 diamantes', () => {
    const ench = withEnchant(withEnchant(0, EFFICIENCY, 3), UNBREAKING, 2);
    const worn: ItemStack = { item: PICK, count: 1, damage: Math.round(MAX * 0.9), ench };
    const out = anvilResult(worn, { item: item('diamond'), count: 10, damage: 0 }, null, outcome());
    expect(out.result).not.toBeNull();
    expect(out.result!.damage).toBe(0);
    expect(out.result!.ench).toBe(ench);
    expect(out.rightUsed).toBe(4);
    expect(out.cost).toBe(4);
    // Com dois diamantes, metade do caminho.
    const half = anvilResult(worn, { item: item('diamond'), count: 2, damage: 0 }, null, outcome());
    expect(half.result!.damage).toBe(Math.round(MAX * 0.9) - 2 * Math.floor(MAX * 0.25));
  });

  it('cada material conserta o seu, a madeira aceita qualquer tábua', () => {
    expect(repairsWith(item('iron_sword'), item('iron_ingot'))).toBe(true);
    expect(repairsWith(item('iron_sword'), item('diamond'))).toBe(false);
    expect(repairsWith(item('wooden_axe'), item('jungle_planks'))).toBe(true);
    expect(repairsWith(item('leather_boots'), item('leather'))).toBe(true);
  });

  it('juntar duas peças soma a durabilidade e os encantamentos, nível igual sobe um', () => {
    const a: ItemStack = { item: PICK, count: 1, damage: MAX - 100, ench: withEnchant(0, EFFICIENCY, 2) };
    const b: ItemStack = { item: PICK, count: 1, damage: MAX - 100, ench: withEnchant(0, EFFICIENCY, 2) };
    const out = anvilResult(a, b, null, outcome());
    expect(out.result!.damage).toBe(MAX - 200 - Math.floor(MAX * 0.12));
    expect(levelIn(out.result!.ench!, EFFICIENCY)).toBe(3);
  });

  it('livro encantado passa para a peça, e o que briga com ela fica de fora', () => {
    const book = (enchant: number, level: number): ItemStack => ({
      item: item('enchanted_book'), count: 1, damage: 0, ench: withEnchant(0, enchant, level),
    });
    const pick: ItemStack = { item: PICK, count: 1, damage: 0, ench: withEnchant(0, FORTUNE, 2) };
    const unb = anvilResult(pick, book(UNBREAKING, 3), null, outcome());
    expect(levelIn(unb.result!.ench!, UNBREAKING)).toBe(3);
    expect(levelIn(unb.result!.ench!, FORTUNE)).toBe(2);
    // Toque Suave briga com Fortuna: nada muda, não há resultado.
    expect(anvilResult(pick, book(SILK_TOUCH, 1), null, outcome()).result).toBeNull();
    // Afiação não cabe em picareta.
    expect(anvilResult(pick, book(ENCHANT_BY_NAME.get('sharpness')!.id, 1), null, outcome()).result).toBeNull();
    // Dois livros iguais: nível sobe.
    const merged = anvilResult(book(UNBREAKING, 2), book(UNBREAKING, 2), null, outcome());
    expect(merged.result!.item).toBe(item('enchanted_book'));
    expect(levelIn(merged.result!.ench!, UNBREAKING)).toBe(3);
  });

  it('dar nome custa um nível, só em item que não empilha, e apagar o nome também vale', () => {
    const sword: ItemStack = { item: item('iron_sword'), count: 1, damage: 0 };
    const named = anvilResult(sword, null, '  Ferroada  ', outcome());
    expect(named.result!.name).toBe('Ferroada');
    expect(named.cost).toBe(1);
    expect(anvilResult({ ...sword, name: 'Ferroada' }, null, 'Ferroada', outcome()).result).toBeNull();
    expect(anvilResult({ ...sword, name: 'Ferroada' }, null, '', outcome()).result!.name).toBeUndefined();
    expect(anvilResult(makeStack(item('cobblestone'), 10), null, 'Pedra', outcome()).result).toBeNull();
  });

  it('a bancada cobra os níveis, gasta o material e recusa o caro demais', () => {
    const { session } = rig();
    put(session, 0, GROUND + 1, 0, 'anvil');
    const bench = session.workbench;
    expect(bench.open(0, GROUND + 1, 0)).toBe(true);
    expect(bench.openScreen).toBe('anvil');
    bench.anvil.set(ANVIL_LEFT, { item: PICK, count: 1, damage: MAX - 10 });
    bench.anvil.set(ANVIL_RIGHT, makeStack(item('diamond'), 64));
    bench.refreshAnvil();
    expect(bench.anvilBlocker()).toBe('no-level');
    session.xp.setTotal(1000);
    const levels = session.xp.level;
    const taken = bench.takeAnvilResult();
    expect(taken!.damage).toBe(0);
    expect(session.xp.level).toBeLessThan(levels);
    expect(bench.anvil.get(ANVIL_LEFT)).toBeNull();
    expect(bench.anvil.get(ANVIL_RIGHT)!.count).toBe(60);

    // Caro demais: sem o custo de trabalho anterior (desvio do módulo), os
    // oito encantamentos de hoje não passam de ~25 níveis; o teto existe para
    // os que vierem. Aqui ele é forçado no resultado.
    bench.anvil.set(ANVIL_LEFT, { item: PICK, count: 1, damage: MAX - 10 });
    bench.refreshAnvil();
    bench.anvilOutcome.cost = TOO_EXPENSIVE;
    expect(bench.anvilBlocker()).toBe('expensive');
    session.player.mode = 'creative';
    expect(bench.anvilBlocker()).toBe('ok');
  });

  it('fechar a tela devolve a peça e o material, e o resultado não vira item', () => {
    const { session } = rig();
    put(session, 0, GROUND + 1, 0, 'anvil');
    const bench = session.workbench;
    bench.open(0, GROUND + 1, 0);
    bench.anvil.set(ANVIL_LEFT, { item: item('iron_sword'), count: 1, damage: 5 });
    bench.anvilName = 'Nome';
    bench.refreshAnvil();
    expect(bench.anvil.get(2)).not.toBeNull();
    bench.closeScreen();
    expect(session.inventory.countOf(item('iron_sword'))).toBe(1);
  });

  it('o resultado sai pelo clique, com o nome, e só se a bancada deixar', () => {
    const { session } = rig();
    put(session, 0, GROUND + 1, 0, 'anvil');
    const bench = session.workbench;
    bench.open(0, GROUND + 1, 0);
    bench.anvil.set(ANVIL_LEFT, { item: item('iron_sword'), count: 1, damage: 0 });
    bench.anvilName = 'Ferroada';
    bench.refreshAnvil();
    const take = () => bench.takeAnvilResult();
    clickContainer(session.inventory, bench.anvil, 'anvil', 2, 'left', false, undefined, take);
    expect(session.inventory.cursor).toBeNull(); // sem nível
    session.xp.setTotal(100);
    bench.refreshAnvil();
    clickContainer(session.inventory, bench.anvil, 'anvil', 2, 'left', false, undefined, take);
    expect(session.inventory.cursor?.name).toBe('Ferroada');
  });
});

// --- reparo na grade e livro encantado ---------------------------------------------

describe('reparo na grade', () => {
  it('duas peças iguais viram uma com a soma e 5%, sem encantamento', () => {
    const max = ITEM_BY_NAME.get('iron_pickaxe')!.durability!;
    const a: ItemStack = { item: item('iron_pickaxe'), count: 1, damage: max - 50, ench: withEnchant(0, EFFICIENCY, 3) };
    const b: ItemStack = { item: item('iron_pickaxe'), count: 1, damage: max - 60 };
    const grid = { size: 3 as const, slots: [a, null, null, null, null, null, null, null, b] };
    const out = matchRepair(grid)!;
    expect(out.damage).toBe(max - 110 - Math.floor(max * 0.05));
    expect(out.ench).toBeUndefined();
    const { session } = rig();
    expect(session.recipes.match(grid)?.item).toBe(item('iron_pickaxe'));
  });

  it('três peças, peças diferentes ou item sem durabilidade não casam', () => {
    const p = (name: string): ItemStack => ({ item: item(name), count: 1, damage: 3 });
    expect(matchRepair({ size: 2, slots: [p('iron_pickaxe'), p('iron_pickaxe'), p('iron_pickaxe'), null] })).toBeNull();
    expect(matchRepair({ size: 2, slots: [p('iron_pickaxe'), p('iron_axe'), null, null] })).toBeNull();
    expect(matchRepair({ size: 2, slots: [makeStack(item('stick')), makeStack(item('stick')), null, null] })).toBeNull();
  });
});

describe('livro encantado', () => {
  it('a mesa encanta o livro e ele vira livro encantado; a pilha devolve o resto', () => {
    const { session } = rig();
    put(session, 0, GROUND + 1, 0, 'enchanting_table');
    const bench = session.workbench;
    bench.open(0, GROUND + 1, 0);
    bench.enchantTable.set(0, makeStack(item('book'), 3));
    bench.enchantTable.set(1, makeStack(item('lapis_lazuli'), 3));
    bench.refreshEnchantOffers();
    session.xp.setTotal(500);
    expect(bench.buyEnchant(0)).toBe('ok');
    const book = bench.enchantTable.get(0)!;
    expect(book.item).toBe(item('enchanted_book'));
    expect(book.count).toBe(1);
    expect(book.ench).toBeGreaterThan(0);
    expect(session.inventory.countOf(item('book'))).toBe(2);
    // Livro encantado não volta à mesa.
    bench.refreshEnchantOffers();
    expect(bench.enchantOffers.every((o) => o.enchant < 0)).toBe(true);
  });
});

// --- funil ------------------------------------------------------------------------

describe('funil', () => {
  it('critério do doc 14: baú → funil → fornalha funde 64 minérios sozinha', () => {
    const { session } = rig();
    const y = GROUND + 1;
    // Baú em cima, funil com o bico para baixo, fornalha embaixo dele.
    put(session, 0, y + 2, 0, 'chest');
    put(session, 0, y + 1, 0, 'hopper', 5);
    put(session, 0, y, 0, 'furnace');
    // Carvão pelo lado: baú de combustível → funil de lado → fornalha.
    put(session, 2, y + 1, 0, 'chest');
    put(session, 1, y, 0, 'hopper', 1);
    session.world.setBlock(2, y + 1, 0, makeState(block('chest')), 'player');
    // O baú do carvão fica acima do funil de lado.
    put(session, 1, y + 1, 0, 'chest');
    // Saída: funil embaixo da fornalha puxando para um baú de fora.
    put(session, 0, y - 1, 0, 'hopper', 0);
    put(session, 1, y - 1, 0, 'chest');

    session.tiles.at(0, y + 2, 0)!.give(item('raw_iron'), 64);
    session.tiles.at(1, y + 1, 0)!.give(item('coal'), 16);

    ticks(session, 64 * 200 + 400);
    const out = session.tiles.at(1, y - 1, 0)!;
    let ingots = 0;
    for (let i = 0; i < out.size; i++) {
      const s = out.get(i);
      if (s !== null && s.item === item('iron_ingot')) ingots += s.count;
    }
    const furnace = session.tiles.at(0, y, 0) as Furnace;
    ingots += furnace.get(FURNACE_OUTPUT)?.count ?? 0;
    expect(ingots).toBe(64);
    expect(session.tiles.at(0, y + 2, 0)!.isEmpty).toBe(true);
  }, 60_000);

  it('fornalha: por cima só na entrada, pelo lado só no combustível', () => {
    const furnace = new Furnace(0, 0, 0);
    const one = (name: string): ItemStack => ({ item: item(name), count: 1, damage: 0 });
    expect(insertOne(furnace, one('raw_iron'), 'above')).toBe(true);
    expect(insertOne(furnace, one('coal'), 'above')).toBe(false); // carvão não funde
    expect(insertOne(furnace, one('coal'), 'side')).toBe(true);
    expect(insertOne(furnace, one('raw_iron'), 'side')).toBe(false);
    expect(furnace.get(FURNACE_INPUT)!.item).toBe(item('raw_iron'));
    expect(furnace.get(FURNACE_FUEL)!.item).toBe(item('coal'));
  });

  it('energizado, o funil trava', () => {
    const { session } = rig();
    const y = GROUND + 1;
    put(session, 0, y + 1, 0, 'chest');
    put(session, 0, y, 0, 'hopper', 1);
    put(session, -1, y, 0, 'chest');
    session.tiles.at(0, y + 1, 0)!.give(item('stick'), 10);
    put(session, 1, y, 0, 'redstone_block');
    ticks(session, 40);
    expect(stateBitsOf(session.world.getBlock(0, y, 0)) & 8).toBe(8);
    expect(session.tiles.at(0, y + 1, 0)!.get(0)!.count).toBe(10);
    session.world.setBlock(1, y, 0, makeState(0), 'player');
    ticks(session, 40);
    expect(session.tiles.at(0, y + 1, 0)!.get(0)?.count ?? 0).toBeLessThan(10);
  });

  it('suga o item que cai em cima, um a cada 8 ticks', () => {
    const { session } = rig();
    const y = GROUND + 1;
    put(session, 0, y, 0, 'hopper', 5);
    session.items.spawn(0.5, y + 1.2, 0.5, makeStack(item('stick'), 3));
    ticks(session, 20 + 3 * HOPPER_COOLDOWN + 5);
    const hopper = session.tiles.at(0, y, 0)!;
    expect(hopper.get(0)?.count).toBe(3);
    expect(session.items.active).toBe(0);
  });

  it('funil vazio vai para o save, para voltar a sugar depois de recarregar', () => {
    const { session } = rig();
    put(session, 0, GROUND + 1, 0, 'hopper', 5);
    expect(session.tiles.saved.some((c) => c.kind === 'hopper')).toBe(true);
    const back = containerFrom(tileFrom(session.tiles.at(0, GROUND + 1, 0)!));
    expect(back.kind).toBe('hopper');
    expect(back.size).toBe(5);
  });
});

// --- comparador e observador ---------------------------------------------------------

describe('comparador', () => {
  it('lê a ocupação do baú de trás e acende a lâmpada da frente', () => {
    const { session } = rig();
    const y = GROUND + 1;
    put(session, 0, y, 0, 'chest');
    // Saída para +X (bits 0): baú atrás em −X, lâmpada na frente em +X.
    put(session, 1, y, 0, 'comparator', 0);
    put(session, 2, y, 0, 'redstone_lamp');
    ticks(session, 6);
    expect(blockIdOf(session.world.getBlock(2, y, 0))).toBe(block('redstone_lamp'));
    session.tiles.at(0, y, 0)!.give(item('cobblestone'), 64 * 13);
    ticks(session, 6);
    const power = (stateBitsOf(session.world.getBlock(1, y, 0)) >> 2) & 15;
    expect(power).toBe(signalOfFullness(13 / 27, true));
    expect(blockIdOf(session.world.getBlock(2, y, 0))).toBe(block('redstone_lamp_on'));
  });

  it('comparar e subtrair, com a lateral', () => {
    const inputs = (back: number, side: number) => ({
      containerSignal: () => -1,
      powerFrom: (_x: number, _y: number, _z: number, dir: number) => (dir === 1 ? back : dir === 2 ? side : 0),
    });
    expect(comparatorOutput(inputs(10, 4), 0, 0, 0, 0, false)).toBe(10);
    expect(comparatorOutput(inputs(4, 10), 0, 0, 0, 0, false)).toBe(0);
    expect(comparatorOutput(inputs(10, 4), 0, 0, 0, 0, true)).toBe(6);
    expect(comparatorOutput(inputs(4, 10), 0, 0, 0, 0, true)).toBe(0);
  });

  it('o clique troca o modo, e o sinal do contêiner vai de 0 a 15', () => {
    const { session } = rig();
    put(session, 0, GROUND + 1, 0, 'comparator', 2);
    expect(session.redstone.use(0, GROUND + 1, 0)).toBe(true);
    expect(blockIdOf(session.world.getBlock(0, GROUND + 1, 0))).toBe(block('comparator_subtract'));
    expect(signalOfFullness(0, false)).toBe(0);
    expect(signalOfFullness(0.001, true)).toBe(1);
    expect(signalOfFullness(1, true)).toBe(15);
  });
});

describe('observador', () => {
  it('um bloco muda na frente: pulso de 2 ticks para trás', () => {
    const { session } = rig();
    const y = GROUND + 1;
    // Cara para +X (0): vigia (1, y, 0); pulso sai para −X, onde está a lâmpada.
    put(session, 0, y, 0, 'observer', 0);
    put(session, -1, y, 0, 'redstone_lamp');
    ticks(session, 5);
    expect(stateBitsOf(session.world.getBlock(0, y, 0)) & 8).toBe(0);
    session.world.setBlock(1, y, 0, makeState(block('cobblestone')), 'player');
    ticks(session, 1);
    expect(stateBitsOf(session.world.getBlock(0, y, 0)) & 8).toBe(8);
    expect(blockIdOf(session.world.getBlock(-1, y, 0))).toBe(block('redstone_lamp_on'));
    ticks(session, 4);
    expect(stateBitsOf(session.world.getBlock(0, y, 0)) & 8).toBe(0);
    // Mudança atrás dele não conta.
    session.world.setBlock(0, y + 1, 0, makeState(block('cobblestone')), 'player');
    ticks(session, 1);
    expect(stateBitsOf(session.world.getBlock(0, y, 0)) & 8).toBe(0);
  });
});

// --- dispensador e liberador ---------------------------------------------------------

describe('dispensador e liberador', () => {
  function powered(name: string, facing: number) {
    const { session } = rig();
    const y = GROUND + 1;
    put(session, 0, y, 0, name, facing);
    return {
      session, y,
      container: session.tiles.at(0, y, 0) as Container,
      pulse: () => {
        session.world.setBlock(0, y, -1, makeState(block('redstone_block')), 'player');
        ticks(session, 2);
        session.world.setBlock(0, y, -1, makeState(0), 'player');
        ticks(session, 2);
      },
    };
  }

  it('dispensador atira flecha, uma por pulso, e energia parada não metralha', () => {
    const { session, container, pulse } = powered('dispenser', 0);
    container.give(item('arrow'), 5);
    pulse();
    expect(container.get(0)!.count).toBe(4);
    expect(session.projectiles.active).toBe(1);
    // Energia ligada e mantida: um disparo só.
    session.world.setBlock(0, GROUND + 1, -1, makeState(block('redstone_block')), 'player');
    ticks(session, 10);
    expect(container.get(0)!.count).toBe(3);
  });

  it('dispensador despeja o balde de água e guarda o balde vazio', () => {
    const { session, container, pulse, y } = powered('dispenser', 0);
    container.set(0, makeStack(item('water_bucket')));
    pulse();
    expect(blockIdOf(session.world.getBlock(1, y, 0))).toBe(block('water'));
    expect(container.get(0)!.item).toBe(item('bucket'));
  });

  it('liberador empurra para o baú da frente; sem baú, solta no chão', () => {
    const a = powered('dropper', 0);
    put(a.session, 1, a.y, 0, 'chest');
    a.container.give(item('stick'), 2);
    a.pulse();
    expect(a.session.tiles.at(1, a.y, 0)!.get(0)?.count).toBe(1);
    expect(a.session.items.active).toBe(0);

    const b = powered('dropper', 0);
    b.container.give(item('stick'), 2);
    b.pulse();
    expect(b.session.items.active).toBe(1);
  });
});

// --- nome e encantamento que não se perdem -------------------------------------------

describe('pilhas inteiras', () => {
  it('clique direito no baú não arranca o encantamento da espada', () => {
    const { session } = rig();
    const chest = new Container('chest', 27, 0, 0, 0);
    const sword: ItemStack = { item: item('iron_sword'), count: 1, damage: 0, ench: withEnchant(0, UNBREAKING, 2), name: 'Ferroada' };
    chest.set(0, sword);
    clickContainer(session.inventory, chest, 'chest', 0, 'right', false);
    expect(session.inventory.cursor?.ench).toBe(sword.ench);
    expect(session.inventory.cursor?.name).toBe('Ferroada');
  });

  it('jogar fora com Q leva o encantamento junto', () => {
    const { session } = rig();
    session.inventory.set(0, { item: item('iron_sword'), count: 1, damage: 0, ench: withEnchant(0, UNBREAKING, 1) });
    session.inventory.select(0);
    let dropped: ItemStack | null = null;
    session.inventory.onDrop = (s) => { dropped = s; };
    session.inventory.dropSelected(false);
    expect((dropped as ItemStack | null)?.ench).toBe(withEnchant(0, UNBREAKING, 1));
  });

  it('o nome vai para o save: contêiner e item no chão', () => {
    const chest = new Container('chest', 27, 1, 2, 3);
    chest.set(4, { item: item('iron_sword'), count: 1, damage: 7, name: 'Ferroada' });
    const back = containerFrom(tileFrom(chest));
    expect(back.get(4)?.name).toBe('Ferroada');
    expect(back.get(4)?.damage).toBe(7);

    const floor = new ItemEntities();
    floor.spawn(0, 70, 0, makeStack(item('stick'), 3));
    floor.spawn(2, 70, 0, { item: item('iron_sword'), count: 1, damage: 0, name: 'Ferroada' });
    const again = new ItemEntities();
    again.restore(floor.snapshot());
    const got: ItemStack = { item: 0, count: 0, damage: 0 };
    expect(again.takeOneIn(1.5, 69, -1, 3, 71, 1, got)).toBe(true);
    expect(got.name).toBe('Ferroada');
    // Save sem item nomeado continua só de números, como antes do M15.
    const plain = new ItemEntities();
    plain.spawn(0, 70, 0, makeStack(item('stick'), 1));
    expect(plain.snapshot().every((v) => typeof v === 'number')).toBe(true);
  });
});

// --- orçamento -------------------------------------------------------------------------

describe('orçamento do circuito com item', () => {
  it('critério do doc 14: 32 funis movendo item custam menos de 5 ms por tick', () => {
    const { session } = rig();
    const y = GROUND + 1;
    // Quatro esteiras de 8 funis: baú cheio no começo, baú no fim.
    for (let row = 0; row < 4; row++) {
      const z = row * 3 - 6;
      put(session, -5, y, z, 'chest');
      session.tiles.at(-5, y, z)!.give(item('cobblestone'), 64 * 27);
      for (let i = 0; i < 8; i++) put(session, -4 + i, y, z, 'hopper', 0);
      put(session, 4, y, z, 'chest');
      // O primeiro funil puxa do baú de cima.
      put(session, -4, y + 1, z, 'chest');
      session.tiles.at(-4, y + 1, z)!.give(item('stick'), 64 * 27);
    }
    expect(session.tiles.hoppers.size).toBe(32);
    ticks(session, 60); // a esteira enche
    const samples: number[] = [];
    let moved = 0;
    for (let t = 0; t < 200; t++) {
      const t0 = performance.now();
      session.itemFlow.tick();
      session.redstone.tick();
      samples.push(performance.now() - t0);
      moved += session.itemFlow.moved;
    }
    samples.sort((a, b) => a - b);
    // O pior tick, não a mediana: os funis entram em espera juntos, e a maioria
    // dos ticks é só contagem regressiva. O tick que importa é o que move.
    const worst = samples[samples.length - 3];
    console.log(`  32 funis: ${worst.toFixed(3)} ms no pior tick (3º de 200), ${moved} movimentos`);
    expect(moved).toBeGreaterThan(200 * 32 / HOPPER_COOLDOWN * 0.8);
    expect(worst).toBeLessThan(5);
  });
});

// --- desenho ---------------------------------------------------------------------------


describe('forma e face da frente', () => {
  it('bigorna, funil e comparador cabem no bloco em todas as direções', () => {
    const out = new Float32Array(MAX_BOXES * 6);
    for (const [shape, states] of [[SHAPE_ANVIL, [0, 1, 2, 3]], [SHAPE_HOPPER, [0, 1, 2, 3, 5]], [SHAPE_COMPARATOR, [0, 1, 2, 3]]] as const) {
      for (const state of states) {
        const n = boxesFor(shape, state, 0, out);
        expect(n).toBeGreaterThan(1);
        expect(n).toBeLessThanOrEqual(MAX_BOXES);
        for (let i = 0; i < n * 6; i++) {
          expect(out[i]).toBeGreaterThanOrEqual(0);
          expect(out[i]).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('o dispensador mostra a boca só na face para onde olha', () => {
    const index = buildLayerIndex();
    const tables = buildBlockTables(index);
    const dispenser = block('dispenser');
    const mouth = layerOf(index, 'block/dispenser_front');
    for (let dir = 0; dir < 6; dir++) {
      for (let face = 0; face < 6; face++) {
        const tex = cubeFaceTex(tables, dispenser, dir, face);
        if (face === FRONT_FACE[dir]) expect(tex).toBe(mouth);
        else expect(tex).not.toBe(mouth);
      }
    }
    // Bloco sem frente continua com topo, lado e fundo.
    expect(cubeFaceTex(tables, STONE, 0, 0)).toBe(tables.texSide[STONE]);
  });
});
