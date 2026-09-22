/**
 * Nascimento em terra firme (2026-09-22).
 *
 * O jogador nascia sempre na coluna (0, 0), e em metade das seeds isso era
 * mar. O smoke test achou no primeiro mundo que criou: o boneco boiava e não
 * andava. A busca procura em anéis e é função só da seed.
 */
import { describe, expect, it } from 'vitest';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { findSpawnColumn, isGoodSpawn } from '../src/world/gen/spawnsearch';
import { SEA_LEVEL } from '../src/world/chunk';
import { BIOMES } from '../src/data/biomes';
import { seedFromString } from '../src/core/rng';

const SEEDS = ['smoke-2026', 'craftlite', 'oceano', '12345', 'abc', 'mar-aberto'];

describe('ponto de nascimento', () => {
  for (const text of SEEDS) {
    it(`a seed "${text}" nasce acima do mar, fora de oceano e praia`, () => {
      const seed = seedFromString(text);
      const noise = new TerrainNoise(seed);
      const [x, z] = findSpawnColumn(noise.field);
      expect(isGoodSpawn(noise.field, x, z)).toBe(true);
      // Confere contra o chunk gerado de verdade, não só contra o campo.
      const chunk = generateChunk(seed, noise, x >> 4, z >> 4);
      const top = chunk.heightMap[((z & 15) << 4) | (x & 15)];
      expect(top, 'o topo da coluna está acima do mar').toBeGreaterThan(SEA_LEVEL);
      const biome = BIOMES[chunk.biomeMap[((z & 15) << 4) | (x & 15)]];
      expect(['ocean', 'beach']).not.toContain(biome.name);
    });
  }

  it('é determinístico', () => {
    const seed = seedFromString('craftlite');
    const a = findSpawnColumn(new TerrainNoise(seed).field);
    const b = findSpawnColumn(new TerrainNoise(seed).field);
    expect(a).toEqual(b);
  });

  it('é barato: a busca inteira cabe em poucos ms', () => {
    const noise = new TerrainNoise(seedFromString('oceano'));
    const t0 = performance.now();
    findSpawnColumn(noise.field);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
