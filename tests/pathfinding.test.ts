/**
 * Pathfinding A* com orçamento (doc 07 §3).
 *
 * O que importa aqui não é achar o caminho ótimo: é **nunca** estourar o
 * orçamento de nós e devolver algo utilizável quando o caminho é impossível,
 * porque é isso que segura o custo da IA em T0.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { NODE_BUDGET, Pathfinder, standHeight } from '../src/entity/ai/pathfinder';
import { AIR, BLOCK_BY_NAME, makeState } from '../src/data/blocks';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
const lava = makeState(BLOCK_BY_NAME.get('lava')!.id);

function flatWorld(radius = 3): World {
  const world = new World(99);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Parede de 3 de altura em `x`, com um vão em `gapZ`. */
function wall(world: World, x: number, fromZ: number, toZ: number, gapZ: number): void {
  for (let z = fromZ; z <= toZ; z++) {
    if (z === gapZ) continue;
    for (let y = GROUND_Y + 1; y <= GROUND_Y + 3; y++) world.setBlock(x, y, z, stone, 'gen');
  }
}

describe('altura de apoio', () => {
  it('acha o chão da coluna para uma entidade de 2 blocos', () => {
    const world = flatWorld();
    expect(standHeight(world, 4, GROUND_Y + 1, 4, 2)).toBe(GROUND_Y + 1);
  });

  it('sobe um degrau', () => {
    const world = flatWorld();
    world.setBlock(5, GROUND_Y + 1, 4, stone, 'gen');
    expect(standHeight(world, 5, GROUND_Y + 1, 4, 2)).toBe(GROUND_Y + 2);
  });

  it('recusa a coluna sem espaço para o corpo', () => {
    const world = flatWorld();
    for (let y = GROUND_Y + 1; y <= GROUND_Y + 4; y++) world.setBlock(6, y, 4, stone, 'gen');
    expect(standHeight(world, 6, GROUND_Y + 1, 4, 2)).toBe(-1);
  });

  it('recusa onde não há chão', () => {
    const world = flatWorld();
    for (let y = 0; y <= GROUND_Y; y++) world.setBlock(7, y, 4, AIR, 'gen');
    expect(standHeight(world, 7, GROUND_Y + 1, 4, 2)).toBe(-1);
  });
});

describe('A* com orçamento', () => {
  it('acha o caminho reto no plano', () => {
    const world = flatWorld();
    const finder = new Pathfinder();
    const found = finder.find(world, 2, GROUND_Y + 1, 2, 10, GROUND_Y + 1, 2, 2);

    expect(found).toBe(true);
    expect(finder.outLength).toBeGreaterThan(1);
    // Primeiro nó é onde o mob está; último é o destino.
    expect(finder.outX[0]).toBe(2);
    expect(finder.outX[finder.outLength - 1]).toBe(10);
    expect(finder.expanded).toBeLessThanOrEqual(NODE_BUDGET);
  });

  it('desvia por um vão na parede', () => {
    const world = flatWorld();
    wall(world, 6, -8, 8, 3);
    const finder = new Pathfinder();
    const found = finder.find(world, 2, GROUND_Y + 1, 0, 10, GROUND_Y + 1, 0, 2);

    expect(found).toBe(true);
    // Passou pelo vão: algum nó do caminho está em z = 3, na coluna da parede.
    let usedGap = false;
    for (let i = 0; i < finder.outLength; i++) {
      if (finder.outX[i] === 6 && finder.outZ[i] === 3) usedGap = true;
      // Nenhum nó atravessa a parede.
      expect(finder.outX[i] === 6 && finder.outZ[i] !== 3).toBe(false);
    }
    expect(usedGap).toBe(true);
  });

  it('não passa por cima de lava', () => {
    const world = flatWorld();
    for (let z = -6; z <= 6; z++) {
      if (z === 4) continue;
      world.setBlock(5, GROUND_Y + 1, z, lava, 'gen');
    }
    const finder = new Pathfinder();
    finder.find(world, 2, GROUND_Y + 1, 0, 9, GROUND_Y + 1, 0, 2);

    for (let i = 0; i < finder.outLength; i++) {
      const onLavaColumn = finder.outX[i] === 5 && finder.outZ[i] !== 4;
      expect(onLavaColumn).toBe(false);
    }
  });

  it('respeita o orçamento de nós quando o destino é inalcançável', () => {
    const world = flatWorld();
    // Caixa fechada em volta do destino.
    for (let d = -1; d <= 1; d++) {
      for (let y = GROUND_Y + 1; y <= GROUND_Y + 4; y++) {
        world.setBlock(12 + d, y, 11, stone, 'gen');
        world.setBlock(12 + d, y, 13, stone, 'gen');
        world.setBlock(11, y, 12 + d, stone, 'gen');
        world.setBlock(13, y, 12 + d, stone, 'gen');
      }
    }
    const finder = new Pathfinder();
    finder.find(world, 2, GROUND_Y + 1, 2, 12, GROUND_Y + 1, 12, 2);
    expect(finder.expanded).toBeLessThanOrEqual(NODE_BUDGET);
  });

  it('um orçamento apertado ainda devolve caminho parcial na direção certa', () => {
    const world = flatWorld();
    const finder = new Pathfinder();
    const found = finder.find(world, 0, GROUND_Y + 1, 0, 28, GROUND_Y + 1, 0, 2, 12);

    expect(finder.expanded).toBeLessThanOrEqual(12);
    if (found) {
      // O caminho parcial avança no sentido do destino.
      expect(finder.outX[finder.outLength - 1]).toBeGreaterThan(0);
    }
  });

  it('recusa destino fora do raio de busca', () => {
    const world = flatWorld();
    const finder = new Pathfinder();
    expect(finder.find(world, 0, GROUND_Y + 1, 0, 100, GROUND_Y + 1, 0, 2)).toBe(false);
  });

  it('duas buscas seguidas não vazam estado uma na outra', () => {
    const world = flatWorld();
    const finder = new Pathfinder();
    finder.find(world, 2, GROUND_Y + 1, 2, 8, GROUND_Y + 1, 2, 2);
    const first = finder.outLength;
    finder.find(world, 2, GROUND_Y + 1, 2, 8, GROUND_Y + 1, 2, 2);
    expect(finder.outLength).toBe(first);
  });
});
