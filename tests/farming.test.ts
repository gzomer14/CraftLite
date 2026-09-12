/**
 * Agricultura (M6): arar, plantar, crescer, molhar e colher.
 *
 * O mundo é uma plataforma de terra com céu aberto — o mínimo para a plantação
 * ter luz e suporte. O aleatório do crescimento é injetado, então nada aqui
 * depende de sorte.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Growth, MAX_MOISTURE, SWEEP_TICKS, isGrowing } from '../src/world/growth';
import { plantSeed, tillSoil } from '../src/game/farming';
import { rollDrops } from '../src/game/drops';
import { CROPS, cropOfSeed, cropOfState, isRipe } from '../src/data/crops';
import {
  BLOCK_BY_NAME, DIRT, FARMLAND, WATER, blockIdOf, makeState, stateBitsOf,
} from '../src/data/blocks';
import { ITEM_BY_NAME, makeStack } from '../src/data/items';

const GROUND_Y = 63;
const dirt = makeState(DIRT);
const WHEAT = BLOCK_BY_NAME.get('wheat')!.id;

const HOE = makeStack(ITEM_BY_NAME.get('iron_hoe')!.id);
const SEEDS = makeStack(ITEM_BY_NAME.get('wheat_seeds')!.id, 3);
const CARROT = makeStack(ITEM_BY_NAME.get('carrot')!.id, 3);
const SHOVEL = makeStack(ITEM_BY_NAME.get('iron_shovel')!.id);

/** Uma plataforma de terra com luz do céu cheia por cima. */
function dirtWorld(): World {
  const world = new World(4242);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, dirt);
        }
      }
      chunk.recomputeHeightMap();
      for (let sy = 0; sy < chunk.sections.length; sy++) {
        const section = chunk.sections[sy];
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
        if (sy >= GROUND_Y >> 4) section.skyLight.fill(0xff);
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Terra arada em (0, GROUND_Y, 0) com o registro já ligado. */
function farm(random = (): number => 0): { world: World; growth: Growth; broken: number[] } {
  const world = dirtWorld();
  const broken: number[] = [];
  const growth = new Growth(world, { onCropBroken: (_x, _y, _z, state) => broken.push(state) });
  growth.random = random;
  growth.attach();
  return { world, growth, broken };
}

/** Roda `ticks` do crescimento. */
function run(growth: Growth, ticks: number): void {
  for (let i = 0; i < ticks; i++) growth.tick();
}

describe('arar e plantar', () => {
  it('a enxada transforma terra em terra arada seca', () => {
    const { world } = farm();
    expect(tillSoil(world, 0, GROUND_Y, 0, HOE)).toBe(true);
    const state = world.getBlock(0, GROUND_Y, 0);
    expect(blockIdOf(state)).toBe(FARMLAND);
    expect(stateBitsOf(state)).toBe(0);
  });

  it('só a enxada ara — pá não serve', () => {
    const { world } = farm();
    expect(tillSoil(world, 0, GROUND_Y, 0, SHOVEL)).toBe(false);
    expect(tillSoil(world, 0, GROUND_Y, 0, null)).toBe(false);
    expect(blockIdOf(world.getBlock(0, GROUND_Y, 0))).toBe(DIRT);
  });

  it('não ara com bloco em cima', () => {
    const { world } = farm();
    world.setBlock(0, GROUND_Y + 1, 0, makeState(1), 'player');
    expect(tillSoil(world, 0, GROUND_Y, 0, HOE)).toBe(false);
  });

  it('a semente pega na terra arada e nasce na idade 0', () => {
    const { world } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    expect(plantSeed(world, 0, GROUND_Y, 0, SEEDS)).toBe(true);

    const state = world.getBlock(0, GROUND_Y + 1, 0);
    expect(blockIdOf(state)).toBe(WHEAT);
    expect(stateBitsOf(state)).toBe(0);
  });

  it('a semente não pega em terra comum', () => {
    const { world } = farm();
    expect(plantSeed(world, 0, GROUND_Y, 0, SEEDS)).toBe(false);
  });

  it('cenoura é semente e comida: plantada na terra arada, virou cenoura', () => {
    const { world } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    expect(plantSeed(world, 0, GROUND_Y, 0, CARROT)).toBe(true);
    expect(cropOfState(world.getBlock(0, GROUND_Y + 1, 0))?.block).toBe('carrots');
  });

  it('toda plantação declara semente e bloco existentes', () => {
    for (const crop of CROPS) {
      expect(BLOCK_BY_NAME.get(crop.block)).toBeDefined();
      const seed = ITEM_BY_NAME.get(crop.seed);
      expect(seed).toBeDefined();
      expect(cropOfSeed(seed!.id)).toBe(crop);
    }
  });
});

describe('crescimento', () => {
  it('avança até a idade máxima e para', () => {
    const { world, growth } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    plantSeed(world, 0, GROUND_Y, 0, SEEDS);

    // Duas posições registradas: a terra e a planta.
    expect(growth.registered).toBe(2);
    run(growth, SWEEP_TICKS * 40);

    const state = world.getBlock(0, GROUND_Y + 1, 0);
    expect(stateBitsOf(state)).toBe(7);
    expect(isRipe(state)).toBe(true);
  });

  it('não cresce sem luz', () => {
    const { world, growth } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    plantSeed(world, 0, GROUND_Y, 0, SEEDS);
    for (let y = GROUND_Y; y < GROUND_Y + 3; y++) world.setSkyLight(0, y, 0, 0);

    run(growth, SWEEP_TICKS * 20);
    expect(stateBitsOf(world.getBlock(0, GROUND_Y + 1, 0))).toBe(0);
  });

  it('sorte ruim não faz a planta andar', () => {
    const { world, growth } = farm(() => 1);
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    plantSeed(world, 0, GROUND_Y, 0, SEEDS);
    run(growth, SWEEP_TICKS * 20);
    expect(stateBitsOf(world.getBlock(0, GROUND_Y + 1, 0))).toBe(0);
  });

  it('respeita o orçamento por tick', () => {
    const { world, growth } = farm();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) tillSoil(world, x, GROUND_Y, z, HOE);
    }
    expect(growth.registered).toBe(256);
    growth.tick();
    expect(growth.lastVisited).toBeLessThanOrEqual(16);
  });
});

describe('umidade da terra arada', () => {
  it('molha com água perto e seca sem ela', () => {
    const { world, growth } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    world.setBlock(3, GROUND_Y, 0, makeState(WATER), 'player');

    run(growth, SWEEP_TICKS * 2);
    expect(stateBitsOf(world.getBlock(0, GROUND_Y, 0))).toBe(MAX_MOISTURE);

    world.setBlock(3, GROUND_Y, 0, makeState(DIRT), 'player');
    run(growth, SWEEP_TICKS * (MAX_MOISTURE + 1));
    expect(stateBitsOf(world.getBlock(0, GROUND_Y, 0))).toBe(0);
  });

  it('terra seca sem plantação volta a ser terra', () => {
    const { world, growth } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    run(growth, SWEEP_TICKS * 3);
    expect(blockIdOf(world.getBlock(0, GROUND_Y, 0))).toBe(DIRT);
  });

  it('terra plantada não desmancha, mesmo seca', () => {
    const { world, growth } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    plantSeed(world, 0, GROUND_Y, 0, SEEDS);
    run(growth, SWEEP_TICKS * 5);
    expect(blockIdOf(world.getBlock(0, GROUND_Y, 0))).toBe(FARMLAND);
  });
});

describe('colheita', () => {
  it('madura entrega trigo e sementes; verde devolve só a semente', () => {
    const { world } = farm();
    const ripe = makeState(WHEAT, 7);
    const young = makeState(WHEAT, 2);

    const harvested = rollDrops(ripe, undefined, 1, 0, GROUND_Y + 1, 0).map((s) => s.item);
    expect(harvested).toContain(ITEM_BY_NAME.get('wheat')!.id);
    expect(harvested).toContain(ITEM_BY_NAME.get('wheat_seeds')!.id);

    const pulled = rollDrops(young, undefined, 1, 0, GROUND_Y + 1, 0);
    expect(pulled).toHaveLength(1);
    expect(pulled[0].item).toBe(ITEM_BY_NAME.get('wheat_seeds')!.id);
    void world;
  });

  it('tirar a terra debaixo arranca a plantação na hora', () => {
    const { world, growth, broken } = farm();
    tillSoil(world, 0, GROUND_Y, 0, HOE);
    plantSeed(world, 0, GROUND_Y, 0, SEEDS);

    world.setBlock(0, GROUND_Y, 0, 0, 'player');

    expect(world.getBlock(0, GROUND_Y + 1, 0)).toBe(0);
    expect(broken).toHaveLength(1);
    expect(blockIdOf(broken[0])).toBe(WHEAT);
    expect(growth.registered).toBe(0);
  });
});

describe('registro de crescimento', () => {
  it('reconhece terra arada e plantação, e mais nada', () => {
    expect(isGrowing(makeState(FARMLAND))).toBe(true);
    expect(isGrowing(makeState(WHEAT, 3))).toBe(true);
    expect(isGrowing(makeState(DIRT))).toBe(false);
    expect(isGrowing(0)).toBe(false);
  });

  it('varre um chunk vindo do save e acha a roça', () => {
    const { world, growth } = farm();
    tillSoil(world, 5, GROUND_Y, 5, HOE);
    plantSeed(world, 5, GROUND_Y, 5, SEEDS);

    const fresh = new Growth(world);
    fresh.scanChunk(world.getChunk(0, 0)!);
    expect(fresh.registered).toBe(2);
    void growth;
  });

  it('esquece o que estava no chunk descarregado', () => {
    const { world, growth } = farm();
    tillSoil(world, 5, GROUND_Y, 5, HOE);
    expect(growth.registered).toBe(1);
    growth.forgetChunk(0, 0);
    expect(growth.registered).toBe(0);
    void world;
  });
});
