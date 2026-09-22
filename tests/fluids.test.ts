/**
 * Água e lava (doc 03 §9).
 *
 * O módulo de fluidos existia desde o M4 **sem teste nenhum**. A avaliação de
 * 2026-09-22 achou nele um desvio do doc (lava corrente com água dava pedra, e
 * não pedregulho) e um atropelo que o doc não previa mas que o jogador sente:
 * a água, que anda seis vezes mais rápido, **apagava** a lava por onde
 * passava. Os testes cobrem as quatro regras de encontro e o básico que faz a
 * água parecer água — descer, espalhar até 7 e secar sem fonte.
 */
import { describe, expect, it } from 'vitest';
import { Fluids, fluidLevel, makeFluid } from '../src/world/fluids';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, LAVA, WATER, blockIdOf, makeState } from '../src/data/blocks';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const COBBLE = BLOCK_BY_NAME.get('cobblestone')!.id;
const OBSIDIAN = BLOCK_BY_NAME.get('obsidian')!.id;

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

function place(world: World, fluids: Fluids, x: number, y: number, z: number, state: number): void {
  world.setBlock(x, y, z, state, 'player');
  fluids.scheduleAround(x, y, z);
}

function run(fluids: Fluids, ticks: number): void {
  for (let i = 0; i < ticks; i++) fluids.tick();
}

const id = (world: World, x: number, y: number, z: number): number =>
  blockIdOf(world.getBlock(x, y, z));

describe('água', () => {
  it('espalha no chão até 7 blocos da fonte e para', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    place(world, fluids, 0, 64, 0, makeFluid(WATER, 0));
    run(fluids, 200);
    expect(id(world, 7, 64, 0)).toBe(WATER);
    expect(fluidLevel(world.getBlock(7, 64, 0))).toBe(7);
    expect(id(world, 8, 64, 0)).toBe(AIR);
  });

  it('desce antes de espalhar', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    // Um degrau: fonte em cima de um bloco, com o chão livre ao lado.
    world.setBlock(0, 64, 0, makeState(STONE), 'gen');
    place(world, fluids, 0, 65, 0, makeFluid(WATER, 0));
    run(fluids, 60);
    expect(id(world, 1, 64, 0), 'escorreu pela beirada').toBe(WATER);
  });

  it('seca quando a fonte some', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    place(world, fluids, 0, 64, 0, makeFluid(WATER, 0));
    run(fluids, 100);
    place(world, fluids, 0, 64, 0, makeState(AIR));
    run(fluids, 300);
    for (let x = 0; x <= 7; x++) expect(id(world, x, 64, 0), `x=${x}`).toBe(AIR);
  });
});

describe('água encontra lava (doc 03 §9)', () => {
  it('fonte de lava ao lado de água vira obsidiana', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    world.setBlock(0, 64, 0, makeFluid(LAVA, 0), 'gen');
    place(world, fluids, 1, 64, 0, makeFluid(WATER, 0));
    run(fluids, 80);
    expect(id(world, 0, 64, 0)).toBe(OBSIDIAN);
  });

  it('lava corrente ao lado de água vira pedregulho, não pedra', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    world.setBlock(0, 64, 0, makeFluid(LAVA, 2), 'gen');
    // Um apoio para a lava corrente não secar antes do encontro.
    world.setBlock(-1, 64, 0, makeFluid(LAVA, 1), 'gen');
    world.setBlock(-2, 64, 0, makeFluid(LAVA, 0), 'gen');
    place(world, fluids, 1, 64, 0, makeFluid(WATER, 0));
    run(fluids, 80);
    expect(id(world, 0, 64, 0)).toBe(COBBLE);
  });

  it('a água não apaga a lava ao chegar nela: faz obsidiana ou pedregulho', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    // Fonte de lava a três blocos de uma fonte de água, sem contato inicial.
    world.setBlock(3, 64, 0, makeFluid(LAVA, 0), 'gen');
    place(world, fluids, 0, 64, 0, makeFluid(WATER, 0));
    run(fluids, 200);
    const where = id(world, 3, 64, 0);
    expect(where, 'a fonte de lava não pode sumir sem deixar rastro').toBe(OBSIDIAN);
  });

  it('lava descendo sobre água vira pedra', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    world.setBlock(0, 64, 0, makeFluid(WATER, 0), 'gen');
    place(world, fluids, 0, 65, 0, makeFluid(LAVA, 0));
    run(fluids, 80);
    expect(id(world, 0, 64, 0)).toBe(STONE);
  });

  it('gerador de pedregulho: minerar o bloco faz outro nascer', () => {
    const world = makeWorld();
    const fluids = new Fluids(world);
    // Canal de 1 de largura: paredes de pedra em z=±1, fim do canal em x=1.
    for (let x = -3; x <= 1; x++) {
      world.setBlock(x, 64, 1, makeState(STONE), 'gen');
      world.setBlock(x, 64, -1, makeState(STONE), 'gen');
    }
    world.setBlock(-3, 64, 0, makeState(STONE), 'gen');
    world.setBlock(1, 64, 0, makeState(STONE), 'gen');
    // A lava corre primeiro, sozinha: fonte em x=−2, corrente até x=0.
    place(world, fluids, -2, 64, 0, makeFluid(LAVA, 0));
    run(fluids, 200);
    expect(id(world, 0, 64, 0)).toBe(LAVA);
    // Água num bolso ao lado da ponta do canal.
    world.setBlock(0, 64, 1, makeState(AIR), 'gen');
    world.setBlock(0, 64, 2, makeState(STONE), 'gen');
    world.setBlock(1, 64, 1, makeState(STONE), 'gen');
    world.setBlock(-1, 64, 1, makeState(STONE), 'gen');
    place(world, fluids, 0, 64, 1, makeFluid(WATER, 0));
    run(fluids, 100);
    expect(id(world, 0, 64, 0), 'a ponta da lava virou pedregulho').toBe(COBBLE);
    // Minera, espera, e o encontro acontece de novo.
    place(world, fluids, 0, 64, 0, makeState(AIR));
    run(fluids, 300);
    const cells = [id(world, -1, 64, 0), id(world, 0, 64, 0)];
    expect(cells, 'nasceu pedregulho de novo no canal').toContain(COBBLE);
    expect(id(world, -2, 64, 0), 'a fonte de lava continua').toBe(LAVA);
  });
});
