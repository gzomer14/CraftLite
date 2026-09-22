/**
 * Areia e cascalho que caem (doc 03 §9, doc 04 §2.1).
 *
 * A flag `gravity` estava na tabela desde o M1 sem leitor nenhum: uma torre de
 * areia ficava de pé sem base. Os testes cobrem o que faz a queda parecer
 * certa — desabar em cascata, parar no sólido, atravessar água, respeitar a
 * tocha como apoio e quebrar nela quando cai por cima — e o que a mantém
 * barata: geração não dispara nada e a fila tem orçamento por tick.
 */
import { describe, expect, it } from 'vitest';
import { FallingBlocks, MAX_CHECKS_PER_TICK, isFreeForFalling } from '../src/world/falling';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, blockIdOf, makeState } from '../src/data/blocks';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const SAND = BLOCK_BY_NAME.get('sand')!.id;
const GRAVEL = BLOCK_BY_NAME.get('gravel')!.id;
const WATER = BLOCK_BY_NAME.get('water')!.id;
const TORCH = BLOCK_BY_NAME.get('torch')!.id;
const TALL_GRASS = BLOCK_BY_NAME.get('tall_grass')!.id;

/** Piso de pedra em y=63, chunks carregados. */
function makeWorld(): World {
  const world = new World(1);
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) chunk.setBlock(x, 63, z, makeState(STONE));
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

function setup(): { world: World; falling: FallingBlocks; broken: number[] } {
  const world = makeWorld();
  const broken: number[] = [];
  const falling = new FallingBlocks(world, {
    onBroken: (x, y, z, state) => { broken.push(x, y, z, blockIdOf(state)); },
  });
  falling.attach();
  return { world, falling, broken };
}

function run(falling: FallingBlocks, ticks: number): void {
  for (let i = 0; i < ticks; i++) falling.tick();
}

const id = (world: World, x: number, y: number, z: number): number =>
  blockIdOf(world.getBlock(x, y, z));

describe('a tabela', () => {
  it('areia, areia vermelha e cascalho têm gravidade; o resto do terreno não', () => {
    for (const name of ['sand', 'red_sand', 'gravel']) {
      expect(BLOCK_BY_NAME.get(name)?.gravity, name).toBe(true);
    }
    for (const name of ['dirt', 'stone', 'cobblestone', 'sandstone']) {
      expect(BLOCK_BY_NAME.get(name)?.gravity, name).toBe(false);
    }
  });

  it('ar, fluido, fogo e grama alta são livres; tocha e pedra não', () => {
    expect(isFreeForFalling(makeState(AIR))).toBe(true);
    expect(isFreeForFalling(makeState(WATER))).toBe(true);
    expect(isFreeForFalling(makeState(TALL_GRASS))).toBe(true);
    expect(isFreeForFalling(makeState(TORCH))).toBe(false);
    expect(isFreeForFalling(makeState(STONE))).toBe(false);
  });
});

describe('cair', () => {
  it('areia colocada no ar cai e pousa no chão', () => {
    const { world, falling } = setup();
    world.setBlock(2, 70, 2, makeState(SAND), 'player');
    falling.tick();
    expect(id(world, 2, 70, 2), 'saiu do mundo e virou entidade').toBe(AIR);
    expect(falling.active).toBe(1);
    run(falling, 60);
    expect(falling.active).toBe(0);
    expect(id(world, 2, 64, 2), 'pousou em cima da pedra').toBe(SAND);
  });

  it('uma torre desaba inteira quando a base é quebrada', () => {
    const { world, falling } = setup();
    // Base de pedra em y=64 segurando cinco de cascalho.
    world.setBlock(0, 64, 0, makeState(STONE), 'gen');
    for (let y = 65; y < 70; y++) world.setBlock(0, y, 0, makeState(GRAVEL), 'gen');
    run(falling, 5);
    expect(id(world, 0, 69, 0), 'com base, nada cai').toBe(GRAVEL);

    world.setBlock(0, 64, 0, makeState(AIR), 'player');
    run(falling, 200);
    for (let y = 64; y < 69; y++) expect(id(world, 0, y, 0), `y=${y}`).toBe(GRAVEL);
    expect(id(world, 0, 69, 0)).toBe(AIR);
  });

  it('quebrar ao lado solta areia pendurada', () => {
    const { world, falling } = setup();
    // Areia sobre o vão, de pé porque nasceu assim na geração.
    world.setBlock(4, 66, 4, makeState(SAND), 'gen');
    run(falling, 3);
    expect(id(world, 4, 66, 4)).toBe(SAND);
    // Mexer no vizinho é o que a acorda.
    world.setBlock(5, 66, 4, makeState(STONE), 'player');
    run(falling, 40);
    expect(id(world, 4, 64, 4)).toBe(SAND);
  });

  it('atravessa a água e para no fundo', () => {
    const { world, falling } = setup();
    for (let y = 64; y < 68; y++) world.setBlock(1, y, 1, makeState(WATER), 'gen');
    world.setBlock(1, 72, 1, makeState(SAND), 'player');
    run(falling, 80);
    expect(id(world, 1, 64, 1), 'substituiu a água do fundo').toBe(SAND);
    expect(id(world, 1, 72, 1)).toBe(AIR);
  });

  it('substitui a grama alta onde pousa', () => {
    const { world, falling } = setup();
    world.setBlock(3, 64, 3, makeState(TALL_GRASS), 'gen');
    world.setBlock(3, 68, 3, makeState(SAND), 'player');
    run(falling, 60);
    expect(id(world, 3, 64, 3)).toBe(SAND);
  });
});

describe('a tocha', () => {
  it('areia apoiada numa tocha fica parada', () => {
    const { world, falling } = setup();
    world.setBlock(6, 64, 6, makeState(TORCH), 'gen');
    world.setBlock(6, 65, 6, makeState(SAND), 'player');
    run(falling, 20);
    expect(id(world, 6, 65, 6)).toBe(SAND);
    expect(falling.active).toBe(0);
  });

  it('areia que cai em cima de uma tocha vira item e a tocha fica', () => {
    const { world, falling, broken } = setup();
    world.setBlock(7, 64, 7, makeState(TORCH), 'gen');
    // Suporte temporário acima da tocha; tirá-lo solta a areia.
    world.setBlock(7, 66, 7, makeState(STONE), 'gen');
    world.setBlock(7, 67, 7, makeState(SAND), 'gen');
    world.setBlock(7, 66, 7, makeState(AIR), 'player');
    run(falling, 60);
    expect(id(world, 7, 64, 7), 'a tocha continua').toBe(TORCH);
    expect(broken).toEqual([7, 64, 7, SAND]);
    expect(falling.active).toBe(0);
  });
});

describe('custo', () => {
  it('geração não dispara queda', () => {
    const { world, falling } = setup();
    world.setBlock(8, 90, 8, makeState(SAND), 'gen');
    expect(falling.queuedChecks).toBe(0);
    run(falling, 10);
    expect(id(world, 8, 90, 8)).toBe(SAND);
  });

  it('a fila respeita o orçamento por tick e não perde ninguém', () => {
    const { world, falling } = setup();
    // Uma camada de areia no ar, larga o bastante para estourar o orçamento.
    const n = MAX_CHECKS_PER_TICK + 20;
    for (let i = 0; i < n; i++) {
      world.setBlock(-16 + (i % 32), 80, -16 + Math.floor(i / 32), makeState(SAND), 'player');
    }
    falling.tick();
    expect(falling.active).toBeLessThanOrEqual(MAX_CHECKS_PER_TICK);
    run(falling, 200);
    let landed = 0;
    for (let i = 0; i < n; i++) {
      if (id(world, -16 + (i % 32), 64, -16 + Math.floor(i / 32)) === SAND) landed++;
    }
    expect(landed).toBe(n);
  });

  it('esvaziar (troca de dimensão) some com o que estava no ar', () => {
    const { world, falling } = setup();
    world.setBlock(0, 90, 0, makeState(SAND), 'player');
    falling.tick();
    expect(falling.active).toBe(1);
    falling.clear();
    expect(falling.active).toBe(0);
  });
});
