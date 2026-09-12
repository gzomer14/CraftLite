/**
 * Flood fill de luz (doc 02 §5.3).
 *
 * Critério de aceite do M2 (doc 14): **colocar uma tocha atualiza a luz em
 * menos de 16 ms.** O teste de tempo no fim deste arquivo é o que trava isso.
 */
import { describe, expect, it } from 'vitest';
import { Lighting } from '../src/world/lighting';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, makeState, STONE } from '../src/data/blocks';

const TORCH = BLOCK_BY_NAME.get('torch')!.id;
const GLOWSTONE = BLOCK_BY_NAME.get('glowstone')!.id;

/**
 * Mundo maciço de pedra: o pior caso para propagação (nada passa).
 *
 * Aloca os arrays de luz explicitamente. Sem isso, `getSkyLight` cai no
 * fallback de 15 usado para chunk não carregado e os testes de céu medem o
 * fallback em vez da propagação.
 */
function solidWorld(radius = 1): World {
  const world = new World(1);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 80; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
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
  // Céu aberto acima da rocha, por voxel — é o que a geração real produz.
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      for (let y = 81; y < 128; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            world.setSkyLight(cx * 16 + x, y, cz * 16 + z, 15);
          }
        }
      }
    }
  }
  return world;
}

/** Cava uma sala de ar dentro do maciço. */
function carveRoom(world: World, x0: number, y0: number, z0: number, size: number): void {
  for (let y = y0; y < y0 + size; y++) {
    for (let z = z0; z < z0 + size; z++) {
      for (let x = x0; x < x0 + size; x++) world.setBlock(x, y, z, AIR, 'gen');
    }
  }
}

describe('luz de bloco', () => {
  it('a tocha ilumina o próprio bloco com o nível de emissão', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 4, 40, 4, 8);

    const state = makeState(TORCH);
    world.setBlock(6, 42, 6, state, 'player');
    lighting.onBlockChanged(6, 42, 6, AIR, state);

    expect(world.getBlockLight(6, 42, 6)).toBe(14);
  });

  it('decai 1 por bloco de distância', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);

    const state = makeState(TORCH);
    world.setBlock(8, 42, 8, state, 'player');
    lighting.onBlockChanged(8, 42, 8, AIR, state);

    expect(world.getBlockLight(9, 42, 8)).toBe(13);
    expect(world.getBlockLight(10, 42, 8)).toBe(12);
    expect(world.getBlockLight(11, 42, 8)).toBe(11);
  });

  it('chega a zero no alcance da emissão', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);
    const state = makeState(TORCH);
    world.setBlock(1, 42, 8, state, 'player');
    lighting.onBlockChanged(1, 42, 8, AIR, state);
    expect(world.getBlockLight(15, 42, 8)).toBe(0);
  });

  it('não atravessa parede sólida', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);
    for (let y = 40; y < 56; y++) {
      for (let z = 0; z < 16; z++) world.setBlock(10, y, z, makeState(STONE), 'gen');
    }
    const state = makeState(TORCH);
    world.setBlock(8, 42, 8, state, 'player');
    lighting.onBlockChanged(8, 42, 8, AIR, state);

    expect(world.getBlockLight(9, 42, 8)).toBe(13);
    expect(world.getBlockLight(11, 42, 8)).toBe(0);
  });

  it('passa por um vão na parede, contornando', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);
    // Parede em x = 10 com um único vão em (10, 42, 8).
    for (let y = 40; y < 56; y++) {
      for (let z = 0; z < 16; z++) {
        if (z === 8 && y === 42) continue;
        world.setBlock(10, y, z, makeState(STONE), 'gen');
      }
    }
    const state = makeState(TORCH);
    world.setBlock(8, 42, 8, state, 'player');
    lighting.onBlockChanged(8, 42, 8, AIR, state);

    // Atravessa o vão…
    expect(world.getBlockLight(11, 42, 8)).toBe(11);
    // …e do outro lado só chega contornando, com o custo do caminho.
    expect(world.getBlockLight(11, 42, 2)).toBe(5);
  });

  it('remover a tocha apaga tudo que dependia dela', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);

    const state = makeState(TORCH);
    world.setBlock(8, 42, 8, state, 'player');
    lighting.onBlockChanged(8, 42, 8, AIR, state);
    expect(world.getBlockLight(11, 42, 8)).toBe(11);

    world.setBlock(8, 42, 8, AIR, 'player');
    lighting.onBlockChanged(8, 42, 8, state, AIR);

    expect(world.getBlockLight(8, 42, 8)).toBe(0);
    expect(world.getBlockLight(11, 42, 8)).toBe(0);
  });

  it('remover uma de duas tochas mantém a luz da outra', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);

    const state = makeState(TORCH);
    world.setBlock(4, 42, 8, state, 'player');
    lighting.onBlockChanged(4, 42, 8, AIR, state);
    world.setBlock(12, 42, 8, state, 'player');
    lighting.onBlockChanged(12, 42, 8, AIR, state);

    world.setBlock(4, 42, 8, AIR, 'player');
    lighting.onBlockChanged(4, 42, 8, state, AIR);

    // A segunda tocha continua acesa e reilumina a região.
    expect(world.getBlockLight(12, 42, 8)).toBe(14);
    expect(world.getBlockLight(8, 42, 8)).toBe(10);
    expect(world.getBlockLight(4, 42, 8)).toBe(6);
  });

  it('glowstone emite 15', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);
    const state = makeState(GLOWSTONE);
    world.setBlock(8, 42, 8, state, 'player');
    lighting.onBlockChanged(8, 42, 8, AIR, state);
    expect(world.getBlockLight(8, 42, 8)).toBe(15);
  });

  it('colocar um bloco sólido bloqueia a luz que passava', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);

    const torch = makeState(TORCH);
    world.setBlock(4, 42, 8, torch, 'player');
    lighting.onBlockChanged(4, 42, 8, AIR, torch);
    const before = world.getBlockLight(10, 42, 8);
    expect(before).toBeGreaterThan(0);

    // Parede fechando a passagem.
    for (let y = 40; y < 56; y++) {
      for (let z = 0; z < 16; z++) {
        const stone = makeState(STONE);
        world.setBlock(7, y, z, stone, 'player');
        lighting.onBlockChanged(7, y, z, AIR, stone);
      }
    }
    expect(world.getBlockLight(10, 42, 8)).toBe(0);
  });

  it('marca as sections afetadas como sujas', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 0, 40, 0, 16);
    const scratch: number[] = [];
    world.takeDirtySections(scratch);

    const state = makeState(TORCH);
    world.setBlock(8, 42, 8, state, 'player');
    lighting.onBlockChanged(8, 42, 8, AIR, state);
    expect(world.dirtyCount).toBeGreaterThan(0);
  });
});

describe('luz do céu', () => {
  it('céu aberto tem nível 15 e a rocha fica escura', () => {
    const world = solidWorld();
    expect(world.getSkyLight(8, 100, 8)).toBe(15);
    expect(world.getSkyLight(8, 40, 8)).toBe(0);
  });

  it('quebrar o teto deixa a luz do céu descer', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    carveRoom(world, 4, 70, 4, 8);
    expect(world.getSkyLight(8, 75, 8)).toBe(0);

    // Abre um poço do teto (y=80) até a sala (topo em y=77).
    for (let y = 80; y >= 78; y--) {
      const previous = world.getBlock(8, y, 8);
      world.setBlock(8, y, 8, AIR, 'player');
      lighting.onBlockChanged(8, y, 8, previous, AIR);
    }
    expect(world.getSkyLight(8, 79, 8)).toBeGreaterThan(0);
    expect(world.getSkyLight(8, 78, 8)).toBeGreaterThan(0);
  });

  it('a luz do céu desce sem perder nível em queda livre', () => {
    const world = solidWorld();
    const lighting = new Lighting(world);
    // Poço vertical do céu até y=40.
    for (let y = 80; y >= 40; y--) {
      const previous = world.getBlock(8, y, 8);
      world.setBlock(8, y, 8, AIR, 'player');
      lighting.onBlockChanged(8, y, 8, previous, AIR);
    }
    // Descer não custa nível: o fundo do poço recebe 15.
    expect(world.getSkyLight(8, 40, 8)).toBe(15);
  });
});

describe('orçamento de tempo', () => {
  /**
   * Este é o critério de aceite do M2 no doc 14. 16 ms é um frame inteiro a
   * 60 FPS — na prática queremos muito menos, porque o frame tem mais o que
   * fazer, mas o limite do doc é este.
   */
  it('colocar uma tocha em sala grande custa menos de 16 ms', () => {
    const world = solidWorld(1);
    const lighting = new Lighting(world);
    carveRoom(world, 0, 30, 0, 16);

    const state = makeState(TORCH);
    // Aquece o JIT.
    for (let i = 0; i < 5; i++) {
      world.setBlock(8, 32, 8, state, 'player');
      lighting.onBlockChanged(8, 32, 8, AIR, state);
      world.setBlock(8, 32, 8, AIR, 'player');
      lighting.onBlockChanged(8, 32, 8, state, AIR);
    }

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      world.setBlock(8, 32, 8, state, 'player');
      const t0 = performance.now();
      lighting.onBlockChanged(8, 32, 8, AIR, state);
      samples.push(performance.now() - t0);
      world.setBlock(8, 32, 8, AIR, 'player');
      lighting.onBlockChanged(8, 32, 8, state, AIR);
    }
    samples.sort((a, b) => a - b);
    const median = samples[10];
    console.log(`  tocha: ${median.toFixed(3)} ms (mediana de 20)`);
    expect(median).toBeLessThan(16);
  });

  it('remover a tocha também cabe no orçamento', () => {
    const world = solidWorld(1);
    const lighting = new Lighting(world);
    carveRoom(world, 0, 30, 0, 16);
    const state = makeState(TORCH);

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      world.setBlock(8, 32, 8, state, 'player');
      lighting.onBlockChanged(8, 32, 8, AIR, state);
      world.setBlock(8, 32, 8, AIR, 'player');
      const t0 = performance.now();
      lighting.onBlockChanged(8, 32, 8, state, AIR);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    console.log(`  remover tocha: ${samples[10].toFixed(3)} ms (mediana de 20)`);
    expect(samples[10]).toBeLessThan(16);
  });
});
