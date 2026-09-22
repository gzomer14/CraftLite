/**
 * Onde o jogador nasce num mundo novo (2026-09-22).
 *
 * Até aqui o nascimento era **sempre** a coluna (0, 0), e metade das seeds
 * põe oceano ali: o jogador começava boiando no mar, sem madeira à vista e
 * sem saber para que lado nadar. O smoke test de navegador achou isso no
 * primeiro mundo que criou.
 *
 * A busca anda em anéis quadrados em volta da origem, de 16 em 16 blocos, e
 * devolve a primeira coluna em terra firme — acima do mar, fora de oceano e de
 * praia, abaixo do teto das montanhas. Roda no worker, onde o ruído já existe,
 * e é função só da seed: o mesmo mundo nasce sempre no mesmo lugar.
 */

import { BIOMES } from '../../data/biomes';
import { SEA_LEVEL } from '../chunk';
import type { HeightField } from './heightfield';

/** Distância entre candidatos, em blocos. */
const STEP = 16;
/** Anéis examinados: até 32 × 16 = 512 blocos da origem. */
const MAX_RING = 32;
/** Mais alto que isto é pico de montanha: nascer lá é nascer num penhasco. */
const MAX_HEIGHT = SEA_LEVEL + 40;
const WATERY = new Set(['ocean', 'beach']);

export function isGoodSpawn(field: HeightField, x: number, z: number): boolean {
  const sample = field.sample(x, z);
  if (sample.height <= SEA_LEVEL || sample.height > MAX_HEIGHT) return false;
  const biome = BIOMES[sample.biome];
  return biome !== undefined && !WATERY.has(biome.name);
}

/** Coluna de nascimento; `[0, 0]` se nada em 512 blocos servir. */
export function findSpawnColumn(field: HeightField): [number, number] {
  for (let ring = 0; ring <= MAX_RING; ring++) {
    const r = ring * STEP;
    for (let i = -ring; i <= ring; i++) {
      const d = i * STEP;
      // Os quatro lados do anel, na mesma ordem sempre (determinismo).
      if (isGoodSpawn(field, d, -r)) return [d, -r];
      if (isGoodSpawn(field, r, d)) return [r, d];
      if (isGoodSpawn(field, -d, r)) return [-d, r];
      if (isGoodSpawn(field, -r, -d)) return [-r, -d];
    }
  }
  return [0, 0];
}
