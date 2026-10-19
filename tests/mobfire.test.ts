/**
 * Fogo nos mobs e a chama à vista (M23).
 *
 * Até o M23 só sol e lava acendiam um mob, nada o apagava, e nem mob nem
 * jogador mostravam a chama.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { MOB_BY_NAME } from '../src/data/mobs';
import { Mobs } from '../src/entity/mobs';
import { environmentHarm } from '../src/entity/mobrules';
import { emitBurningMobs } from '../src/game/ambient';
import { Survival } from '../src/game/survival';

const GROUND = 63;
const id = (name: string): number => BLOCK_BY_NAME.get(name)!.id;

function flatWorld(): World {
  const world = new World(7);
  const stone = makeState(id('stone'));
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y < GROUND; y++) {
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

function mobsIn(world: World): Mobs {
  const mobs = new Mobs(world, {
    onDrop: () => {}, onXp: () => {}, onSound: () => {}, onHitPlayer: () => {},
    onExplode: () => {}, onBreakBlock: () => {}, onArrow: () => {},
  }, 8);
  mobs.random = () => 0.5;
  return mobs;
}

describe('fogo nos mobs', () => {
  it('o bloco de fogo acende o mob e fere, como o jogador', () => {
    const world = flatWorld();
    world.setBlock(2, GROUND, 2, makeState(id('fire')), 'player');
    const mobs = mobsIn(world);
    const cow = mobs.spawn(MOB_BY_NAME.get('cow')!.id, 2.5, GROUND, 2.5);
    let harm = 0;
    for (let t = 0; t < 20; t++) harm += environmentHarm(mobs.store, cow, world, false, 0, t);
    expect(mobs.store.fireTicks[cow], 'saiu do fogo ainda ardendo').toBeGreaterThan(0);
    expect(harm).toBeGreaterThan(0);
  });

  it('a água apaga — inclusive o zumbi que pegou fogo no sol', () => {
    const world = flatWorld();
    world.setBlock(4, GROUND, 4, makeState(id('water')), 'player');
    const mobs = mobsIn(world);
    const zombie = mobs.spawn(MOB_BY_NAME.get('zombie')!.id, 4.5, GROUND, 4.5);
    mobs.store.fireTicks[zombie] = 120;
    // Dia de céu aberto: sem a água ele queimaria de novo a cada tick.
    const harm = environmentHarm(mobs.store, zombie, world, true, 15, 0);
    expect(mobs.store.fireTicks[zombie]).toBe(0);
    expect(harm).toBe(0);
  });

  it('quem é imune ao fogo não acende no fogo', () => {
    const world = flatWorld();
    world.setBlock(6, GROUND, 6, makeState(id('fire')), 'player');
    const mobs = mobsIn(world);
    const blaze = mobs.spawn(MOB_BY_NAME.get('blaze')!.id, 6.5, GROUND, 6.5);
    expect(environmentHarm(mobs.store, blaze, world, false, 0, 0)).toBe(0);
    expect(mobs.store.fireTicks[blaze]).toBe(0);
  });
});

describe('a chama à vista', () => {
  it('o mob em chamas solta fagulha; o apagado e o longe, não', () => {
    const world = flatWorld();
    const mobs = mobsIn(world);
    const burning = mobs.spawn(MOB_BY_NAME.get('zombie')!.id, 1.5, GROUND, 1.5);
    mobs.spawn(MOB_BY_NAME.get('cow')!.id, 3.5, GROUND, 3.5);
    mobs.store.fireTicks[burning] = 40;
    const points: number[][] = [];
    const n = emitBurningMobs(mobs.store, 0, 0, (x, y, z) => points.push([x, y, z]));
    expect(n).toBe(2);
    for (const [x, y] of points) {
      expect(Math.abs(x - 1.5)).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(GROUND);
    }
    expect(emitBurningMobs(mobs.store, 500, 500, () => {}), 'longe demais para ver').toBe(0);
  });

  it('o jogador sabe que está em chamas, e a água tira', () => {
    const survival = new Survival();
    const base = { submerged: false, inLava: false, inWater: false, suffocating: false, y: 70 };
    survival.tick({ ...base, onFire: true });
    expect(survival.burning).toBe(true);
    survival.tick({ ...base, onFire: false, inWater: true });
    expect(survival.burning).toBe(false);
  });
});
