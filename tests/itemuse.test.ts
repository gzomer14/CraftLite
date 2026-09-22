/**
 * Uso de item como dado (M13) e os itens do M11 que dependem dele: balde,
 * leite, tesoura, corante, ovo e bola de neve — mais os bichos que dão coisa
 * (`entity/husbandry.ts`).
 *
 * Antes de 2026-09-22 o balde era craftável e não fazia nada, a tesoura não
 * existia, a ovelha era sempre branca e a galinha não punha ovo.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { MobStore } from '../src/entity/mobstore';
import {
  COLOR_MASK, SHEARED, isSheared, rollSheepColor, tickHusbandry, woolColorOf,
} from '../src/entity/husbandry';
import { ITEM_USES } from '../src/game/itemuse';
import { EFFECT_BY_NAME } from '../src/data/effects';
import { AIR, BLOCK_BY_NAME, LAVA, WATER, blockIdOf, makeState } from '../src/data/blocks';
import { ITEMS, itemId, makeStack } from '../src/data/items';
import { MOB_BY_NAME, mobDef } from '../src/data/mobs';
import { DYES } from '../src/data/dyes';
import { makeFluid } from '../src/world/fluids';
import { rollDrops } from '../src/game/drops';

const STONE = BLOCK_BY_NAME.get('stone')!.id;

function harness(): { world: World; player: Player; session: Session } {
  const world = new World(5);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) chunk.setBlock(x, 63, z, makeState(STONE));
      }
      world.addChunk(chunk);
    }
  }
  // Olha para baixo, para o chão logo à frente.
  const player = new Player(8.5, 64, 8.5);
  player.mode = 'survival';
  player.pitch = Math.PI / 2 - 0.05;
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
  return { world, player, session };
}

function hold(session: Session, item: string, count = 1): void {
  session.inventory.set(0, makeStack(itemId(item), count));
  session.inventory.select(0);
  // No jogo, o `main.ts` atualiza a mira a cada quadro; aqui, antes de usar.
  session.interaction.updateTarget();
}

describe('a tabela', () => {
  it('todo `use` de item tem ação registrada', () => {
    for (const def of ITEMS) {
      if (def?.use === undefined) continue;
      expect(ITEM_USES[def.use], def.name).toBeDefined();
    }
  });

  it('balde, balde cheio, ovo, bola de neve e corante têm ação', () => {
    for (const name of ['bucket', 'water_bucket', 'lava_bucket', 'milk_bucket', 'egg', 'snowball', 'shears', 'red_dye']) {
      expect(ITEMS[itemId(name)]?.use, name).toBeDefined();
    }
  });
});

describe('balde', () => {
  it('pega uma fonte de água e devolve o balde cheio; despeja e volta vazio', () => {
    const { world, session } = harness();
    // Uma fonte no chão, onde o jogador olha.
    world.setBlock(8, 63, 8, makeFluid(WATER, 0), 'gen');
    hold(session, 'bucket');
    expect(session.useHeld()).toBe(true);
    expect(world.getBlock(8, 63, 8)).toBe(makeState(AIR));
    expect(session.inventory.held?.item).toBe(itemId('water_bucket'));

    // Pedra de volta no buraco, e despeja por cima.
    world.setBlock(8, 63, 8, makeState(STONE), 'gen');
    for (let i = 0; i < 5; i++) session.tick();
    session.interaction.updateTarget();
    expect(session.useHeld()).toBe(true);
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(WATER);
    expect(session.inventory.held?.item).toBe(itemId('bucket'));
  });

  it('não pega água corrente', () => {
    const { world, session } = harness();
    world.setBlock(8, 63, 8, makeFluid(WATER, 3), 'gen');
    hold(session, 'bucket');
    session.useHeld();
    expect(session.inventory.held?.item).toBe(itemId('bucket'));
  });

  it('pega lava e a lava queima na fornalha como o doc 05 §5 manda', () => {
    const { world, session } = harness();
    world.setBlock(8, 63, 8, makeFluid(LAVA, 0), 'gen');
    hold(session, 'bucket');
    session.useHeld();
    expect(session.inventory.held?.item).toBe(itemId('lava_bucket'));
    expect(ITEMS[itemId('lava_bucket')]?.fuel).toBe(20000);
  });

  it('no criativo o balde não muda de estado na mão', () => {
    const { world, player, session } = harness();
    player.mode = 'creative';
    world.setBlock(8, 63, 8, makeFluid(WATER, 0), 'gen');
    hold(session, 'bucket');
    session.useHeld();
    expect(session.inventory.held?.item).toBe(itemId('bucket'));
  });

  it('leite tira os efeitos', () => {
    const { session } = harness();
    session.survival.effects.add(EFFECT_BY_NAME.get('hunger')!.id, 1, 600, session.survival);
    hold(session, 'milk_bucket');
    session.useHeld();
    expect(session.survival.effects.active).toBe(0);
    expect(session.inventory.held?.item).toBe(itemId('bucket'));
  });
});

describe('arremesso', () => {
  it('ovo e bola de neve saem da mão como projétil', () => {
    const { session } = harness();
    hold(session, 'egg', 3);
    session.useHeld();
    expect(session.projectiles.active).toBe(1);
    expect(session.inventory.held?.count).toBe(2);
    // O ritmo é o de colocar: segurar o botão não despeja a pilha num tick.
    session.useHeld();
    expect(session.projectiles.active).toBe(1);
  });

  it('um ovo em oito choca um pintinho', () => {
    const { player, session } = harness();
    session.random = () => 0.01;
    player.pitch = 0.3;
    hold(session, 'egg');
    session.useHeld();
    for (let i = 0; i < 40; i++) session.tick();
    const chicken = MOB_BY_NAME.get('chicken')!.id;
    let babies = 0;
    const store = session.mobs.store;
    for (let i = 0; i < store.active; i++) if (store.type[i] === chicken && store.isBaby(i)) babies++;
    expect(babies).toBe(1);
  });
});

describe('ovelha', () => {
  const sheep = MOB_BY_NAME.get('sheep')!;

  it('nasce branca em 85% das vezes e de cor no resto, cobrindo todas as cores', () => {
    expect(rollSheepColor(0)).toBe(0);
    expect(rollSheepColor(0.84)).toBe(0);
    const seen = new Set<number>();
    for (let r = 0.85; r < 1; r += 0.001) seen.add(rollSheepColor(r));
    expect(seen.size).toBe(DYES.length - 1);
    expect(seen.has(0)).toBe(false);
  });

  it('tesoura tosquia uma vez, solta a lã da cor, e a lã volta pastando', () => {
    const { session } = harness();
    const store = session.mobs.store;
    const i = session.mobs.spawn(sheep.id, 8.5, 64, 11.5, 2);
    hold(session, 'shears');
    const used = ITEM_USES.shears.onMob!(
      session.useContext, session.inventory.held!, i,
    );
    expect(used).toBe(true);
    expect(isSheared(store.variant[i])).toBe(true);
    expect(woolColorOf(store.variant[i])).toBe(2);
    expect(session.items.active).toBeGreaterThan(0);
    expect(ITEM_USES.shears.onMob!(
      session.useContext, session.inventory.held!, i,
    ), 'já tosquiada').toBe(false);
  });

  it('pastar: tosquiada sobre grama volta a ter lã e a grama vira terra', () => {
    const world = new World(1);
    const chunk = new ChunkColumn(0, 0);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) chunk.setBlock(x, 63, z, makeState(BLOCK_BY_NAME.get('grass_block')!.id));
    }
    world.addChunk(chunk);
    const store = new MobStore(4);
    const i = store.spawn(sheep.id, 4.5, 64, 4.5, SHEARED | 3);
    store.onGround[i] = 1;
    tickHusbandry(store, i, mobDef(sheep.id), world, () => 0, { onDrop: () => {}, onSound: () => {} });
    expect(isSheared(store.variant[i])).toBe(false);
    expect(store.variant[i] & COLOR_MASK).toBe(3);
    expect(blockIdOf(world.getBlock(4, 63, 4))).toBe(BLOCK_BY_NAME.get('dirt')!.id);
  });

  it('corante pinta a ovelha e se gasta; na mesma cor, não', () => {
    const { session } = harness();
    const i = session.mobs.spawn(sheep.id, 8.5, 64, 11.5, 0);
    hold(session, 'blue_dye', 2);
    const ctx = session.useContext;
    expect(ITEM_USES.dye_sheep.onMob!(ctx, session.inventory.held!, i)).toBe(true);
    const blue = DYES.findIndex((d) => d.name === 'blue');
    expect(woolColorOf(session.mobs.store.variant[i])).toBe(blue);
    expect(session.inventory.held?.count).toBe(1);
    expect(ITEM_USES.dye_sheep.onMob!(ctx, session.inventory.held!, i)).toBe(false);
  });

  it('morrendo, dá a lã da cor dela', () => {
    const { session } = harness();
    const drops: number[] = [];
    const i = session.mobs.spawn(sheep.id, 8.5, 64, 11.5, 1);
    const origSpawn = session.items.spawn.bind(session.items);
    session.items.spawn = (x, y, z, stack) => { drops.push(stack.item); return origSpawn(x, y, z, stack); };
    session.mobs.damage(i, 100, 'player');
    const red = `${DYES[1].name}_wool`;
    expect(drops).toContain(itemId(red));
  });
});

describe('galinha e vaca', () => {
  it('a galinha põe ovo dentro da janela da tabela', () => {
    const chicken = MOB_BY_NAME.get('chicken')!;
    const lays = chicken.traits.lays!;
    const store = new MobStore(2);
    const world = new World(1);
    world.addChunk(new ChunkColumn(0, 0));
    const i = store.spawn(chicken.id, 4, 64, 4);
    const eggs: number[] = [];
    const events = { onDrop: (item: number) => { eggs.push(item); }, onSound: () => {} };
    for (let t = 0; t <= lays.maxTicks + 1; t++) tickHusbandry(store, i, chicken, world, () => 0.5, events);
    expect(eggs).toEqual([itemId('egg')]);
  });

  it('balde na vaca vira balde de leite; no bezerro, não', () => {
    const { session } = harness();
    const cow = MOB_BY_NAME.get('cow')!;
    const i = session.mobs.spawn(cow.id, 8.5, 64, 11.5);
    hold(session, 'bucket');
    const ctx = session.useContext;
    expect(ITEM_USES.fill_bucket.onMob!(ctx, session.inventory.held!, i)).toBe(true);
    expect(session.inventory.held?.item).toBe(itemId('milk_bucket'));
    const calf = session.mobs.spawn(cow.id, 9.5, 64, 11.5);
    session.mobs.store.makeBaby(calf, 100);
    hold(session, 'bucket');
    expect(ITEM_USES.fill_bucket.onMob!(ctx, session.inventory.held!, calf)).toBe(false);
  });
});

describe('tesoura em bloco', () => {
  it('folha sai inteira na tesoura, e não como muda', () => {
    const shears = ITEMS[itemId('shears')]!.tool;
    const leaves = makeState(BLOCK_BY_NAME.get('oak_leaves')!.id);
    const drops = rollDrops(leaves, shears, 1, 0, 0, 0);
    expect(drops.map((d) => d.item)).toEqual([itemId('oak_leaves')]);
  });
});

describe('enderman', () => {
  it('pega terra do chão e põe de volta noutro lugar; pedra ele não pega', () => {
    const enderman = MOB_BY_NAME.get('enderman')!;
    const world = new World(1);
    const chunk = new ChunkColumn(0, 0);
    const dirt = BLOCK_BY_NAME.get('dirt')!.id;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        chunk.setBlock(x, 62, z, makeState(STONE));
        chunk.setBlock(x, 63, z, makeState(x < 8 ? dirt : STONE));
      }
    }
    world.addChunk(chunk);
    const store = new MobStore(2);
    const events = { onDrop: () => {}, onSound: () => {} };
    // Sorteio 0: a chance passa e o alvo é (x−2, y−1, z−2), que é terra.
    const i = store.spawn(enderman.id, 4.5, 64, 4.5);
    tickHusbandry(store, i, enderman, world, () => 0, events);
    expect(store.carried[i]).toBe(makeState(dirt));
    expect(world.getBlock(2, 63, 2)).toBe(makeState(AIR));
    // Põe: o sorteio agora cai numa célula de ar sobre chão firme.
    store.x[i] = 12.5; store.z[i] = 12.5; store.y[i] = 65;
    tickHusbandry(store, i, enderman, world, () => 0, events);
    expect(store.carried[i]).toBe(0);
    expect(world.getBlock(10, 64, 10)).toBe(makeState(dirt));

    // Sobre pedra, não pega nada.
    const j = store.spawn(enderman.id, 12.5, 64, 12.5);
    tickHusbandry(store, j, enderman, world, () => 0, events);
    expect(store.carried[j]).toBe(0);
  });
});

describe('lista de usos (M13)', () => {
  it('sai dos campos da tabela, na ordem de tentativa', () => {
    expect(ITEMS[itemId('carrot')]?.uses).toEqual(['plant', 'eat']);
    expect(ITEMS[itemId('bow')]?.uses).toEqual(['charge']);
    expect(ITEMS[itemId('shield')]?.uses).toEqual(['charge']);
    expect(ITEMS[itemId('boat')]?.uses).toEqual(['place_boat']);
    expect(ITEMS[itemId('minecart')]?.uses).toEqual(['place_minecart']);
    expect(ITEMS[itemId('flint_and_steel')]?.uses).toEqual(['ignite']);
    expect(ITEMS[itemId('iron_hoe')]?.uses).toEqual(['till']);
    expect(ITEMS[itemId('bread')]?.uses).toEqual(['eat']);
    expect(ITEMS[itemId('stone')]?.uses).toEqual([]);
  });

  it('todo uso listado tem ação', () => {
    for (const def of ITEMS) {
      for (const use of def?.uses ?? []) expect(ITEM_USES[use], `${def?.name}: ${use}`).toBeDefined();
    }
  });

  it('a cenoura planta na terra arada e, mirando pedra, vira comida', () => {
    const { world, session } = harness();
    world.setBlock(8, 63, 8, makeState(BLOCK_BY_NAME.get('farmland')!.id), 'gen');
    session.survival.hunger = 10;
    hold(session, 'carrot', 2);
    session.useHeld();
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(BLOCK_BY_NAME.get('carrots')!.id);
    expect(session.inventory.held?.count).toBe(1);
    // Mirando pedra, o clique continua gastando: agora é mordida.
    world.setBlock(8, 63, 8, makeState(STONE), 'gen');
    world.setBlock(8, 64, 8, makeState(AIR), 'gen');
    for (let i = 0; i < 5; i++) session.tick();
    session.interaction.updateTarget();
    for (let i = 0; i < 40; i++) session.useHeld();
    expect(session.survival.hunger).toBe(13);
  });
});
