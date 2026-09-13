/**
 * Reprodução de animais (M6): alimentar, cruzar, o filhote e o crescimento.
 *
 * Mesmo mundo plano dos testes de mob — o que importa aqui é o estado dos
 * bichos, não o terreno.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { BREED_COOLDOWN, GROW_TICKS, LOVE_TICKS, Mobs } from '../src/entity/mobs';
import { MobStore } from '../src/entity/mobstore';
import { MOB_BY_NAME, mobDef } from '../src/data/mobs';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
const COW = MOB_BY_NAME.get('cow')!.id;
const PIG = MOB_BY_NAME.get('pig')!.id;

function flatWorld(): World {
  const world = new World(77);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      chunk.recomputeHeightMap();
      for (let sy = 0; sy < chunk.sections.length; sy++) {
        chunk.sections[sy].blockLight = new Uint8Array(2048);
        chunk.sections[sy].skyLight = new Uint8Array(2048);
        if (sy > GROUND_Y >> 4) chunk.sections[sy].skyLight!.fill(0xff);
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/**
 * Aleatório determinístico para os testes de mob (doc 15 §6, 2026-09-13).
 *
 * `Mobs`, `MobStore` e `MobSpawner` sorteiam yaw de nascimento, cooldown de
 * passeio, drops, despawn e teleporte. Com `Math.random` a suíte completa
 * falhava de vez em quando **sem reproduzir isolada** — o tipo de teste que
 * acaba ignorado. Semear aqui torna cada arquivo reproduzível.
 */
function seeded(seed = 20260913): () => number {
  const rng = new Rng(seed);
  return () => rng.nextFloat();
}

function harness(): { mobs: Mobs; xp: number[] } {
  const xp: number[] = [];
  const mobs = new Mobs(flatWorld(), {
    onDrop: () => {},
    onXp: (amount) => xp.push(amount),
    onSound: () => {},
    onHitPlayer: () => {},
    onExplode: () => {},
    onBreakBlock: () => {},
    onArrow: () => {},
  }, 32);
  mobs.random = seeded();
  return { mobs, xp };
}

const PLAYER = { x: 0, y: GROUND_Y + 1, z: 0, eyeY: GROUND_Y + 2.6, held: -1, alive: true };

/** Duas vacas coladas, prontas para cruzar. */
function pair(mobs: Mobs): [number, number] {
  const a = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
  const b = mobs.spawn(COW, 3, GROUND_Y + 1, 2);
  return [a, b];
}

describe('alimentar', () => {
  it('o item certo coloca o adulto no amor', () => {
    const { mobs } = harness();
    const cow = mobs.spawn(COW, 2, GROUND_Y + 1, 2);

    expect(mobs.tryFeed(cow, 'wheat')).toBe('love');
    expect(mobs.store.loveTicks[cow]).toBe(LOVE_TICKS);
  });

  it('o item errado não é consumido', () => {
    const { mobs } = harness();
    const cow = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
    expect(mobs.tryFeed(cow, 'carrot')).toBe('none');
    expect(mobs.store.loveTicks[cow]).toBe(0);
  });

  it('cada bicho tem o seu item (doc 07 §2)', () => {
    const { mobs } = harness();
    const pig = mobs.spawn(PIG, 2, GROUND_Y + 1, 2);
    expect(mobs.tryFeed(pig, 'wheat')).toBe('none');
    expect(mobs.tryFeed(pig, 'carrot')).toBe('love');
  });

  it('quem já está no amor ou em cooldown recusa sem gastar o item', () => {
    const { mobs } = harness();
    const cow = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
    mobs.tryFeed(cow, 'wheat');
    expect(mobs.tryFeed(cow, 'wheat')).toBe('wait');

    mobs.store.loveTicks[cow] = 0;
    mobs.store.breedCooldown[cow] = 10;
    expect(mobs.tryFeed(cow, 'wheat')).toBe('wait');
  });

  it('alimentar filhote apressa o crescimento', () => {
    const { mobs } = harness();
    const calf = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
    mobs.store.makeBaby(calf, GROW_TICKS);

    expect(mobs.tryFeed(calf, 'wheat')).toBe('grow');
    expect(mobs.store.growTicks[calf]).toBeLessThan(GROW_TICKS);
    expect(mobs.store.isBaby(calf)).toBe(true);
  });
});

describe('cruzar', () => {
  it('dois no amor e colados fazem um filhote', () => {
    const { mobs, xp } = harness();
    const [a, b] = pair(mobs);
    mobs.tryFeed(a, 'wheat');
    mobs.tryFeed(b, 'wheat');

    for (let t = 0; t < 20; t++) mobs.tick(PLAYER);

    expect(mobs.count).toBe(3);
    let babies = 0;
    for (let i = 0; i < mobs.store.active; i++) {
      if (mobs.store.isBaby(i)) babies++;
    }
    expect(babies).toBe(1);
    expect(xp.length).toBeGreaterThan(0);
  });

  it('os pais saem do amor e entram em cooldown', () => {
    const { mobs } = harness();
    const [a, b] = pair(mobs);
    mobs.tryFeed(a, 'wheat');
    mobs.tryFeed(b, 'wheat');
    mobs.breed(a, b);

    expect(mobs.store.loveTicks[a]).toBe(0);
    expect(mobs.store.loveTicks[b]).toBe(0);
    expect(mobs.store.breedCooldown[a]).toBe(BREED_COOLDOWN);
  });

  it('um sozinho no amor não gera nada', () => {
    const { mobs } = harness();
    const [a] = pair(mobs);
    mobs.tryFeed(a, 'wheat');

    for (let t = 0; t < 40; t++) mobs.tick(PLAYER);
    expect(mobs.count).toBe(2);
  });

  it('espécies diferentes não cruzam', () => {
    const { mobs } = harness();
    const cow = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
    const pig = mobs.spawn(PIG, 2.5, GROUND_Y + 1, 2);
    mobs.tryFeed(cow, 'wheat');
    mobs.tryFeed(pig, 'carrot');

    for (let t = 0; t < 40; t++) mobs.tick(PLAYER);
    expect(mobs.count).toBe(2);
  });

  it('o amor tem prazo', () => {
    const { mobs } = harness();
    const cow = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
    mobs.tryFeed(cow, 'wheat');
    for (let t = 0; t < LOVE_TICKS + 1; t++) mobs.tick(PLAYER);
    expect(mobs.store.loveTicks[cow]).toBe(0);
  });
});

describe('filhote', () => {
  it('nasce com metade do tamanho e vira adulto no prazo', () => {
    const store = new MobStore(8);
    const calf = store.spawn(COW, 0, 0, 0);
    store.makeBaby(calf, 5);

    expect(store.scale[calf]).toBe(MobStore.BABY_SCALE);
    expect(store.height(calf)).toBeCloseTo(mobDef(COW).height * 0.5);

    for (let t = 0; t < 4; t++) expect(store.tickGrowth(calf)).toBe(false);
    expect(store.tickGrowth(calf)).toBe(true);
    expect(store.isBaby(calf)).toBe(false);
    expect(store.scale[calf]).toBe(1);
  });

  it('não dropa carne nem couro', () => {
    const drops: number[] = [];
    const mobs = new Mobs(flatWorld(), {
      onDrop: (item) => drops.push(item),
      onXp: () => {},
      onSound: () => {},
      onHitPlayer: () => {},
      onExplode: () => {},
      onBreakBlock: () => {},
      onArrow: () => {},
    }, 8);
    mobs.random = seeded();
    const calf = mobs.spawn(COW, 2, GROUND_Y + 1, 2);
    mobs.store.makeBaby(calf, GROW_TICKS);

    expect(mobs.damage(calf, 100, 'player')).toBe(true);
    expect(drops).toHaveLength(0);
  });

  it('o slot reaproveitado não herda o estado do filhote', () => {
    const store = new MobStore(4);
    const calf = store.spawn(COW, 0, 0, 0);
    store.makeBaby(calf, GROW_TICKS);
    store.loveTicks[calf] = 100;
    store.removeAt(calf);

    const fresh = store.spawn(COW, 1, 0, 1);
    expect(store.isBaby(fresh)).toBe(false);
    expect(store.loveTicks[fresh]).toBe(0);
    expect(store.scale[fresh]).toBe(1);
  });
});
