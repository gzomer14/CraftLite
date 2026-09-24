/**
 * Rios (M14).
 *
 * A água do mundo era oceano, pântano e lago. O critério do doc 14: "um rio
 * atravessa pelo menos dois biomas numa seed de teste sem degrau de parede".
 * O vale é que carrega a regra da parede — a margem alarga com o desnível —,
 * e o rio some no terreno alto em vez de rasgar a montanha.
 */
import { describe, expect, it } from 'vitest';
import { BIOMES, BIOME_BEACH, BIOME_OCEAN, BIOME_RIVER } from '../src/data/biomes';
import { BLOCK_BY_NAME, blockIdOf } from '../src/data/blocks';
import { RIVER_BED } from '../src/world/gen/heightfield';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { SEA_LEVEL, SECTION_SIZE } from '../src/world/chunk';

/** Seed 2: a da aldeia do doc 15, com rios que descem do deserto à planície. */
const SEED = 2;
/** Região em chunks: 48×48 = 768×768 blocos em volta do rio de teste. */
const CX0 = -12;
const CZ0 = 7;
const R = 48;
const W = R * SECTION_SIZE;

interface Mapa { height: Int16Array; biome: Uint8Array }

function mapa(): Mapa {
  const noise = new TerrainNoise(SEED);
  const field = noise.field;
  const height = new Int16Array(W * W);
  const biome = new Uint8Array(W * W);
  for (let cz = 0; cz < R; cz++) {
    for (let cx = 0; cx < R; cx++) {
      field.prepare(CX0 + cx, CZ0 + cz);
      for (let lz = 0; lz < SECTION_SIZE; lz++) {
        for (let lx = 0; lx < SECTION_SIZE; lx++) {
          const s = field.sample((CX0 + cx) * SECTION_SIZE + lx, (CZ0 + cz) * SECTION_SIZE + lz);
          const i = (cz * SECTION_SIZE + lz) * W + cx * SECTION_SIZE + lx;
          height[i] = s.height;
          biome[i] = s.biome;
        }
      }
    }
  }
  return { height, biome };
}

const MAPA = mapa();

/** Rios da região: cada um com o tamanho e os biomas de terra que ele toca. */
function rios(m: Mapa): { size: number; land: Set<number> }[] {
  const seen = new Uint8Array(W * W);
  const out: { size: number; land: Set<number> }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * W; start++) {
    if (m.biome[start] !== BIOME_RIVER || seen[start] === 1) continue;
    const land = new Set<number>();
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const j = stack.pop()!;
      size++;
      const x = j % W;
      const z = (j / W) | 0;
      const around = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, z > 0 ? j - W : -1, z < W - 1 ? j + W : -1];
      for (const k of around) {
        if (k < 0) continue;
        const b = m.biome[k];
        if (b === BIOME_RIVER) {
          if (seen[k] === 0) { seen[k] = 1; stack.push(k); }
        } else if (b !== BIOME_OCEAN && b !== BIOME_BEACH) {
          land.add(b);
        }
      }
    }
    out.push({ size, land });
  }
  return out.sort((a, b) => b.size - a.size);
}

describe('rios', () => {
  it('há rio na região, e um deles atravessa dois biomas de terra', () => {
    const lista = rios(MAPA);
    expect(lista.length).toBeGreaterThan(0);
    const cruzando = lista.find((r) => r.size > 500 && r.land.size >= 2);
    expect(cruzando, lista.slice(0, 5).map((r) =>
      `${r.size}: ${[...r.land].map((b) => BIOMES[b].name).join(',')}`).join(' | ')).toBeDefined();
  });

  it('o leito fica abaixo do nível do mar, e o rio tem água de verdade', () => {
    let cols = 0;
    for (let i = 0; i < W * W; i++) {
      if (MAPA.biome[i] !== BIOME_RIVER) continue;
      cols++;
      expect(MAPA.height[i]).toBeLessThan(SEA_LEVEL);
      expect(MAPA.height[i]).toBeGreaterThanOrEqual(RIVER_BED);
    }
    expect(cols).toBeGreaterThan(1000);
  });

  it('o vale não tem parede: nenhum degrau passa de 8 blocos', () => {
    let max = 0;
    for (let z = 1; z < W; z++) {
      for (let x = 1; x < W; x++) {
        const i = z * W + x;
        max = Math.max(max, Math.abs(MAPA.height[i] - MAPA.height[i - 1]),
          Math.abs(MAPA.height[i] - MAPA.height[i - W]));
      }
    }
    expect(max).toBeLessThanOrEqual(8);
  });

  it('no chunk gerado, a coluna de rio é água até o nível do mar sobre areia', () => {
    const noise = new TerrainNoise(SEED);
    const water = BLOCK_BY_NAME.get('water')!.id;
    const sand = BLOCK_BY_NAME.get('sand')!.id;
    // O primeiro chunk da região que tenha rio.
    let achou = false;
    for (let c = 0; c < R * R && !achou; c++) {
      const cx = c % R;
      const cz = (c / R) | 0;
      const i0 = (cz * SECTION_SIZE + 8) * W + cx * SECTION_SIZE + 8;
      if (MAPA.biome[i0] !== BIOME_RIVER) continue;
      const chunk = generateChunk(SEED, noise, CX0 + cx, CZ0 + cz, { caves: false, ores: false });
      const i = (8 << 4) | 8;
      expect(chunk.biomeMap[i]).toBe(BIOME_RIVER);
      const bed = MAPA.height[i0];
      expect(blockIdOf(chunk.getBlock(8, bed, 8))).toBe(sand);
      expect(blockIdOf(chunk.getBlock(8, SEA_LEVEL, 8))).toBe(water);
      achou = true;
    }
    expect(achou).toBe(true);
  });

  it('o mesmo rio sai igual preparado por qualquer chunk vizinho', () => {
    const a = new TerrainNoise(SEED).field;
    const b = new TerrainNoise(SEED).field;
    const idx = MAPA.biome.indexOf(BIOME_RIVER);
    const wx = CX0 * SECTION_SIZE + (idx % W);
    const wz = CZ0 * SECTION_SIZE + ((idx / W) | 0);
    a.prepare(Math.floor(wx / 16), Math.floor(wz / 16));
    b.prepare(Math.floor(wx / 16) + 1, Math.floor(wz / 16));
    expect(a.sample(wx, wz).height).toBe(b.sample(wx, wz).height);
    expect(b.sample(wx, wz).biome).toBe(BIOME_RIVER);
  });
});
