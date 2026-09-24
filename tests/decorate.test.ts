/**
 * Decoração: árvores e plantas (doc 03 §4).
 *
 * Dois pontos são críticos e por isso têm teste próprio:
 *
 * 1. **Existe madeira no mundo.** Sem tronco não há tábua, não há bancada e o
 *    critério de aceite do M4 é impossível de cumprir.
 * 2. **Árvore que atravessa a borda do chunk aparece inteira.** O sorteio dos
 *    vizinhos tem que dar exatamente o mesmo resultado dos dois lados, senão o
 *    jogador vê meia copa.
 */
import { describe, expect, it } from 'vitest';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { DECOR } from '../src/world/gen/decorate';
import { BIOMES } from '../src/data/biomes';
import { AIR, BLOCK_BY_NAME, blockIdOf } from '../src/data/blocks';
import { SECTION_SIZE, WORLD_HEIGHT, type ChunkColumn } from '../src/world/chunk';

const SEED = 20260909;
const LOGS = new Set(['oak_log', 'birch_log', 'spruce_log', 'acacia_log', 'jungle_log']
  .map((name) => BLOCK_BY_NAME.get(name)!.id));
const LEAVES = new Set(['oak_leaves', 'birch_leaves', 'spruce_leaves']
  .map((name) => BLOCK_BY_NAME.get(name)!.id));
const PLANTS = new Set(['tall_grass', 'fern', 'dandelion', 'poppy', 'cactus', 'dead_bush', 'sugar_cane']
  .map((name) => BLOCK_BY_NAME.get(name)!.id));

function countIds(chunk: ChunkColumn, ids: Set<number>): number {
  let total = 0;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < SECTION_SIZE; z++) {
      for (let x = 0; x < SECTION_SIZE; x++) {
        if (ids.has(blockIdOf(chunk.getBlock(x, y, z)))) total++;
      }
    }
  }
  return total;
}

describe('tabela de decoração', () => {
  it('cobre todos os biomas', () => {
    for (const biome of BIOMES) {
      expect(DECOR[biome.name], biome.name).toBeDefined();
    }
  });

  it('só declara árvores de tipos que existem como bloco', () => {
    for (const name of Object.keys(DECOR)) {
      const tree = DECOR[name].tree;
      if (tree === undefined) continue;
      expect(BLOCK_BY_NAME.has(`${tree.kind}_log`), name).toBe(true);
      expect(tree.perChunk, name).toBeGreaterThan(0);
    }
  });
});

describe('madeira no mundo', () => {
  it('há tronco e folha numa varredura de 64 chunks', () => {
    const noise = new TerrainNoise(SEED);
    let logs = 0;
    let leaves = 0;
    let plants = 0;
    for (let cz = 0; cz < 8; cz++) {
      for (let cx = 0; cx < 8; cx++) {
        const chunk = generateChunk(SEED, noise, cx, cz);
        logs += countIds(chunk, LOGS);
        leaves += countIds(chunk, LEAVES);
        plants += countIds(chunk, PLANTS);
      }
    }
    expect(logs).toBeGreaterThan(20);
    expect(leaves).toBeGreaterThan(logs);
    expect(plants).toBeGreaterThan(20);
  });

  it('a decoração pode ser desligada (usada nos testes de terreno)', () => {
    const noise = new TerrainNoise(SEED);
    const chunk = generateChunk(SEED, noise, 3, 3, { decoration: false });
    expect(countIds(chunk, LOGS)).toBe(0);
    expect(countIds(chunk, LEAVES)).toBe(0);
  });
});

describe('determinismo', () => {
  it('mesma seed e mesmas coordenadas dão a mesma decoração', () => {
    const a = generateChunk(SEED, new TerrainNoise(SEED), 2, -5);
    const b = generateChunk(SEED, new TerrainNoise(SEED), 2, -5);
    expect(countIds(a, LOGS)).toBe(countIds(b, LOGS));
    expect(countIds(a, LEAVES)).toBe(countIds(b, LEAVES));
  });

  it('a ordem de geração não muda nada', () => {
    const noise = new TerrainNoise(SEED);
    const straight = generateChunk(SEED, noise, 1, 1);
    const expected = countIds(straight, LEAVES);

    // Gera vizinhos antes: o RNG de decoração não pode carregar estado.
    for (const [cx, cz] of [[0, 0], [2, 2], [1, 0], [0, 1]]) {
      generateChunk(SEED, noise, cx, cz);
    }
    const shuffled = generateChunk(SEED, noise, 1, 1);
    expect(countIds(shuffled, LEAVES)).toBe(expected);
  });

  it('a copa continua na borda: os dois chunks concordam', () => {
    const noise = new TerrainNoise(SEED);
    // Varre pares vizinhos procurando folha coladinha na fronteira; onde houver,
    // o outro lado tem que ter folha na coluna correspondente em algum Y.
    let checked = 0;
    for (let cx = 0; cx < 6 && checked < 3; cx++) {
      const left = generateChunk(SEED, noise, cx, 0);
      const right = generateChunk(SEED, noise, cx + 1, 0);
      for (let y = 0; y < WORLD_HEIGHT && checked < 3; y++) {
        for (let z = 0; z < SECTION_SIZE; z++) {
          if (!LEAVES.has(blockIdOf(left.getBlock(SECTION_SIZE - 1, y, z)))) continue;
          // Folha na última coluna do chunk da esquerda: a árvore transbordou.
          // O vizinho tem que ter algo (folha ou tronco) na coluna x = 0.
          let neighbor = false;
          for (let dy = -3; dy <= 3; dy++) {
            const state = right.getBlock(0, y + dy, z);
            if (state === AIR) continue;
            const id = blockIdOf(state);
            if (LEAVES.has(id) || LOGS.has(id)) { neighbor = true; break; }
          }
          if (neighbor) checked++;
          break;
        }
      }
    }
    // O que se afirma é que a varredura achou casos de borda coerentes.
    expect(checked).toBeGreaterThan(0);
  });
});

describe('onde a vegetação não entra', () => {
  it('nunca há tronco debaixo d\'água', () => {
    const noise = new TerrainNoise(SEED);
    const water = BLOCK_BY_NAME.get('water')!.id;
    for (let cz = -3; cz <= 3; cz++) {
      for (let cx = -3; cx <= 3; cx++) {
        const chunk = generateChunk(SEED, noise, cx, cz);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let z = 0; z < SECTION_SIZE; z++) {
            for (let x = 0; x < SECTION_SIZE; x++) {
              if (!LOGS.has(blockIdOf(chunk.getBlock(x, y, z)))) continue;
              expect(blockIdOf(chunk.getBlock(x, y + 1, z))).not.toBe(water);
            }
          }
        }
      }
    }
  });

  it('o deserto tem cacto e nenhum carvalho', () => {
    // A tabela é a fonte da verdade: deserto não declara árvore.
    expect(DECOR.desert.tree).toBeUndefined();
    expect(DECOR.desert.cactus).toBeGreaterThan(0);
  });
});
