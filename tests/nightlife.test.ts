/**
 * O critério de aceite do M5 (doc 14): *"a primeira noite é assustadora e
 * justa"*.
 *
 * Este arquivo joga a noite inteira pela `Session` — mobs, combate, armadura,
 * explosão e cama — sem GL nem DOM. É o teste que pega erro de fiação entre os
 * sistemas novos e o loop de sobrevivência que já existia.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Session } from '../src/game/session';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, makeStack } from '../src/data/items';
import { ARMOR_START } from '../src/game/inventory';
import { FLAG_PERSISTENT, FLAG_TAMED } from '../src/entity/mobstore';
import { MOB_BY_NAME } from '../src/data/mobs';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
const ZOMBIE = MOB_BY_NAME.get('zombie')!.id;
const COW = MOB_BY_NAME.get('cow')!.id;
const CREEPER = MOB_BY_NAME.get('creeper')!.id;

/**
 * Aleatório determinístico para os testes de mob (doc 15 §6, 2026-09-13).
 *
 * `Mobs`, `MobStore` e `MobSpawner` sorteiam yaw de nascimento, cooldown de
 * passeio, drops, despawn e domesticação. Com `Math.random` a suíte completa
 * falhava de vez em quando **sem reproduzir isolada** — o tipo de teste que
 * acaba ignorado. Semear aqui torna cada arquivo reproduzível.
 */
function seeded(seed = 20260913): () => number {
  const rng = new Rng(seed);
  return () => rng.nextFloat();
}

function harness() {
  const world = new World(2026);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
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
  const sounds: string[] = [];
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ },
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
    onSound: (name) => sounds.push(name),
  }, { maxMobs: 20, simulationDistance: 3 });
  // Determinismo: ver `seeded` abaixo e doc 15 §6.
  session.mobs.random = seeded();
  session.spawner.random = seeded(77);
  // Meia-noite: é quando o marco acontece.
  session.dayNight.time = 18000;
  return { world, player, session, sounds };
}

describe('atacar mobs', () => {
  it('a espada mata a vaca e o couro cai no chão', () => {
    const { player, session } = harness();
    const sword = ITEM_BY_NAME.get('iron_sword')!;
    session.inventory.set(0, makeStack(sword.id, 1));
    session.mobs.spawn(COW, 10.0, GROUND_Y + 1, 8.5);

    // A vaca entra em pânico e corre ao levar o primeiro golpe, então o teste
    // persegue: sem isso ele mediria a fuga, não o combate.
    // A mira aponta um pouco para baixo: a vaca tem 1,4 de altura e os olhos
    // do jogador ficam em 1,62 — um raio horizontal passa por cima dela.
    player.yaw = Math.PI / 2;
    let swings = 0;
    for (let t = 0; t < 200 && session.mobs.count > 0; t++) {
      const store = session.mobs.store;
      player.setPosition(store.x[0] - 1.2, GROUND_Y + 1, store.z[0]);
      if (session.attackAlong(0.894, -0.447, 0)) swings++;
      session.tick();
    }

    expect(session.mobs.count).toBe(0);
    expect(swings).toBeGreaterThan(0);
    expect(session.items.active).toBeGreaterThan(0);
  });

  it('o golpe empurra o mob para longe', () => {
    const { session } = harness();
    session.mobs.spawn(ZOMBIE, 10.0, GROUND_Y + 1, 8.5);
    const before = session.mobs.store.x[0];

    session.attackAlong(1, 0, 0);
    session.tick();
    expect(session.mobs.store.x[0]).toBeGreaterThan(before);
  });

  it('sem mob na frente, o ataque não acontece', () => {
    const { session } = harness();
    expect(session.attackAlong(1, 0, 0)).toBe(false);
  });

  it('a espada perde durabilidade ao acertar', () => {
    const { session } = harness();
    const sword = ITEM_BY_NAME.get('iron_sword')!;
    session.inventory.set(0, makeStack(sword.id, 1));
    session.mobs.spawn(ZOMBIE, 10.0, GROUND_Y + 1, 8.5);

    session.attackAlong(1, 0, 0);
    expect(session.inventory.get(0)?.damage).toBe(1);
  });
});

describe('levar dano de mob', () => {
  it('o zumbi encostado tira vida e empurra', () => {
    const { player, session } = harness();
    session.mobs.spawn(ZOMBIE, 9.2, GROUND_Y + 1, 8.5);

    for (let t = 0; t < 120; t++) {
      session.tick();
      player.tick(session.world, {
        forward: 0, strafe: 0, jump: false, sneak: false, sprint: false,
      });
    }
    expect(session.survival.health).toBeLessThan(20);
    // Foi empurrado para longe do zumbi (que está em +X).
    expect(player.x).toBeLessThan(9.2);
  });

  it('a armadura de ferro segura parte do dano', () => {
    const naked = harness();
    naked.session.mobs.spawn(ZOMBIE, 9.0, GROUND_Y + 1, 8.5);
    for (let t = 0; t < 80; t++) naked.session.tick();
    const damageWithout = 20 - naked.session.survival.health;

    const armored = harness();
    for (const piece of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
      const item = ITEM_BY_NAME.get(piece)!;
      const slot = ARMOR_START + ['helmet', 'chestplate', 'leggings', 'boots'].indexOf(
        piece.replace('iron_', ''),
      );
      armored.session.inventory.set(slot, makeStack(item.id, 1));
    }
    armored.session.tick();
    expect(armored.session.armorPoints).toBe(15);

    armored.session.mobs.spawn(ZOMBIE, 9.0, GROUND_Y + 1, 8.5);
    for (let t = 0; t < 80; t++) armored.session.tick();
    const damageWith = 20 - armored.session.survival.health;

    expect(damageWith).toBeLessThan(damageWithout);
  });

  it('a peça equipada gasta durabilidade ao levar dano', () => {
    const { session } = harness();
    const helmet = ITEM_BY_NAME.get('iron_helmet')!;
    session.inventory.set(ARMOR_START, makeStack(helmet.id, 1));
    session.tick();

    session.mobs.spawn(ZOMBIE, 9.0, GROUND_Y + 1, 8.5);
    for (let t = 0; t < 80; t++) session.tick();
    expect(session.inventory.get(ARMOR_START)?.damage).toBeGreaterThan(0);
  });

  it('no criativo o mob não machuca', () => {
    const { player, session } = harness();
    player.mode = 'creative';
    session.mobs.spawn(ZOMBIE, 9.0, GROUND_Y + 1, 8.5);
    for (let t = 0; t < 120; t++) session.tick();
    expect(session.survival.health).toBe(20);
  });
});

describe('domar o lobo', () => {
  it('o osso doma, consome o item e o lobo para de ser hostil', () => {
    const { player, session } = harness();
    const bone = ITEM_BY_NAME.get('bone')!;
    session.inventory.set(0, makeStack(bone.id, 4));
    const wolf = MOB_BY_NAME.get('wolf')!.id;
    session.mobs.spawn(wolf, 10.0, GROUND_Y + 1, 8.5);
    player.yaw = Math.PI / 2;

    // O lobo tem 0,85 de altura e os olhos ficam em 1,62: a mira desce forte.
    let tamed = false;
    for (let t = 0; t < 60 && !tamed; t++) {
      session.inventory.set(0, makeStack(bone.id, 4));
      expect(session.useOnMob(0.82, -0.57, 0)).toBe(true);
      tamed = session.mobs.store.hasFlag(0, FLAG_TAMED);
      // O osso some da mão a cada tentativa.
      expect(session.inventory.get(0)?.count).toBe(3);
    }
    expect(tamed).toBe(true);
    expect(session.mobs.store.hasFlag(0, FLAG_PERSISTENT)).toBe(true);
    expect(session.mobs.store.health[0]).toBe(20);
  });

  it('item errado não doma e o clique segue o caminho normal', () => {
    const { session } = harness();
    session.inventory.set(0, makeStack(ITEM_BY_NAME.get('dirt')!.id, 4));
    session.mobs.spawn(MOB_BY_NAME.get('wolf')!.id, 10.0, GROUND_Y + 1, 8.5);
    expect(session.useOnMob(0.82, -0.57, 0)).toBe(false);
    expect(session.inventory.get(0)?.count).toBe(4);
  });

  it('lobo domado não persegue o dono nem depois de apanhar', () => {
    const { session } = harness();
    const wolf = session.mobs.spawn(MOB_BY_NAME.get('wolf')!.id, 10.0, GROUND_Y + 1, 8.5);
    session.mobs.store.setFlag(wolf, FLAG_TAMED, true);

    session.mobs.damage(wolf, 1, 'player');
    for (let t = 0; t < 60; t++) session.tick();
    expect(session.mobs.store.hasTarget[0]).toBe(0);
  });
});

describe('explosão de creeper', () => {
  it('abre cratera, machuca o jogador e solta alguns itens', () => {
    const { world, player, session } = harness();
    // Parede de pedra em volta para a cratera ter o que comer.
    for (let y = GROUND_Y + 1; y <= GROUND_Y + 3; y++) {
      for (let z = 6; z <= 10; z++) {
        for (let x = 6; x <= 10; x++) world.setBlock(x, y, z, stone, 'gen');
      }
    }
    player.setPosition(8.5, GROUND_Y + 4, 8.5);

    session.explodeAt(8.5, GROUND_Y + 2, 8.5, 3);

    expect(world.getBlock(8, GROUND_Y + 2, 8)).toBe(AIR);
    expect(session.survival.health).toBeLessThan(20);
    expect(world.dirtyCount).toBeGreaterThan(0);
  });

  it('a porta arrombada pelo mob some do mundo e não dropa item (doc 06 §10)', () => {
    const { world, session } = harness();
    const door = makeState(BLOCK_BY_NAME.get('oak_door')!.id);
    world.setBlock(9, GROUND_Y + 1, 8, door, 'gen');

    session.breakBlockByMob(9, GROUND_Y + 1, 8);

    expect(world.getBlock(9, GROUND_Y + 1, 8)).toBe(AIR);
    expect(session.items.active).toBe(0);
  });

  it('a explosão não atravessa parede grossa', () => {
    const { world, session } = harness();
    // Bloco isolado a 3 de distância, atrás de uma parede maciça.
    for (let y = GROUND_Y + 1; y <= GROUND_Y + 3; y++) {
      for (let z = 6; z <= 10; z++) world.setBlock(9, y, z, stone, 'gen');
    }
    const shielded = makeState(BLOCK_BY_NAME.get('bookshelf')!.id);
    world.setBlock(11, GROUND_Y + 2, 8, shielded, 'gen');

    session.explodeAt(7.5, GROUND_Y + 2, 8.5, 3);
    expect(world.getBlock(11, GROUND_Y + 2, 8)).toBe(shielded);
  });

  it('a rocha-mãe resiste', () => {
    const { world, session } = harness();
    const bedrock = makeState(BLOCK_BY_NAME.get('bedrock')!.id);
    world.setBlock(9, GROUND_Y, 8, bedrock, 'gen');
    session.explodeAt(9.5, GROUND_Y + 1, 8.5, 3);
    expect(world.getBlock(9, GROUND_Y, 8)).toBe(bedrock);
  });
});

describe('a noite inteira', () => {
  it('20 mobs e o jogador rodam 1200 ticks sem quebrar nada', () => {
    const { player, session } = harness();
    for (let i = 0; i < 20; i++) {
      session.mobs.spawn(
        i % 3 === 0 ? ZOMBIE : i % 3 === 1 ? COW : CREEPER,
        4.5 + (i % 5) * 3, GROUND_Y + 1, 4.5 + ((i / 5) | 0) * 3,
      );
    }

    const input = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false };
    expect(() => {
      for (let t = 0; t < 1200; t++) {
        player.tick(session.world, input);
        session.tick();
        if (session.survival.isDead) session.respawn(8, 8);
      }
    }).not.toThrow();

    // Sobrou mob vivo, e nenhum caiu para fora do mundo.
    const store = session.mobs.store;
    for (let i = 0; i < store.active; i++) {
      expect(store.y[i]).toBeGreaterThan(0);
      expect(Number.isFinite(store.x[i])).toBe(true);
    }
    expect(session.dayNight.time).toBe(18000 + 1200);
  });

  it('o pool de mobs não cresce sem limite', () => {
    const { session } = harness();
    const capacity = session.mobs.store.capacity;
    for (let i = 0; i < capacity + 50; i++) {
      session.mobs.spawn(COW, 8.5, GROUND_Y + 1, 8.5);
    }
    expect(session.mobs.count).toBe(capacity);
  });
});
