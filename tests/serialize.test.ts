/**
 * Serialização de chunk (doc 11 §2). O doc pede round-trip em teste, e com
 * razão: um bug aqui só aparece quando o jogador recarrega o mundo e descobre
 * que perdeu o que construiu.
 */
import { describe, expect, it } from 'vitest';
import {
  MAGIC, deserializeChunk, rleDecode, rleEncode, serializeChunk,
  compressChunk, decompressChunk,
} from '../src/save/serialize';
import { ChunkColumn, WORLD_HEIGHT } from '../src/world/chunk';
import { AIR, makeState, STONE, DIRT, GRASS_BLOCK } from '../src/data/blocks';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';

describe('RLE', () => {
  it('ida e volta preserva os bytes', () => {
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([1]),
      new Uint8Array(1000).fill(7),
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      Uint8Array.from({ length: 500 }, (_, i) => (i * 37) & 0xff),
    ];
    for (const data of cases) {
      const decoded = rleDecode(rleEncode(data), data.length);
      expect(Array.from(decoded), `tamanho ${data.length}`).toEqual(Array.from(data));
    }
  });

  it('comprime muito corridas longas', () => {
    const data = new Uint8Array(4096).fill(3);
    expect(rleEncode(data).length).toBeLessThan(64);
  });

  it('não explode com dados incompressíveis', () => {
    const data = Uint8Array.from({ length: 2000 }, (_, i) => (i * 101) & 0xff);
    // Pior caso: 2 bytes de cabeçalho a cada 255 literais.
    expect(rleEncode(data).length).toBeLessThan(data.length * 1.1);
  });

  it('lida com o limite de corrida de 255', () => {
    const data = new Uint8Array(600).fill(9);
    expect(Array.from(rleDecode(rleEncode(data), 600))).toEqual(Array.from(data));
  });
});

describe('round-trip de chunk', () => {
  function sample(): ChunkColumn {
    const chunk = new ChunkColumn(3, -7);
    for (let y = 0; y < 70; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const block = y < 60 ? STONE : y < 68 ? DIRT : GRASS_BLOCK;
          chunk.setBlock(x, y, z, makeState(block));
        }
      }
    }
    chunk.setBlock(5, 65, 5, AIR);
    chunk.recomputeHeightMap();
    chunk.biomeMap.fill(3);
    return chunk;
  }

  it('preserva todos os blocos', () => {
    const original = sample();
    const restored = deserializeChunk(serializeChunk(original));
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < 16; z += 3) {
        for (let x = 0; x < 16; x += 3) {
          expect(restored.getBlock(x, y, z), `${x},${y},${z}`)
            .toBe(original.getBlock(x, y, z));
        }
      }
    }
  });

  it('preserva as coordenadas e o bioma', () => {
    const original = sample();
    const restored = deserializeChunk(serializeChunk(original));
    expect(restored.cx).toBe(3);
    expect(restored.cz).toBe(-7);
    expect(restored.biomeMap[0]).toBe(3);
  });

  it('preserva o buraco cavado pelo jogador', () => {
    const original = sample();
    const restored = deserializeChunk(serializeChunk(original));
    expect(restored.getBlock(5, 65, 5)).toBe(AIR);
  });

  it('preserva a contagem de blocos não-ar', () => {
    const original = sample();
    const restored = deserializeChunk(serializeChunk(original));
    expect(restored.nonAirCount).toBe(original.nonAirCount);
  });

  it('sections vazias continuam vazias', () => {
    const original = sample();
    const restored = deserializeChunk(serializeChunk(original));
    expect(restored.sections[7].data).toBeNull();
    expect(restored.sections[7].isEmpty).toBe(true);
  });

  it('funciona com um chunk gerado de verdade', () => {
    const original = generateChunk(1234, new TerrainNoise(1234), 0, 0);
    const restored = deserializeChunk(serializeChunk(original));
    for (let y = 0; y < WORLD_HEIGHT; y += 5) {
      for (let z = 0; z < 16; z += 4) {
        for (let x = 0; x < 16; x += 4) {
          expect(restored.getBlock(x, y, z)).toBe(original.getBlock(x, y, z));
        }
      }
    }
  });

  it('a assinatura é validada', () => {
    const data = serializeChunk(sample());
    data[0] = 0;
    expect(() => deserializeChunk(data)).toThrow(/assinatura/);
  });

  it('recusa versão futura em vez de corromper', () => {
    const data = serializeChunk(sample());
    data[4] = 99; // versão
    expect(() => deserializeChunk(data)).toThrow(/versão futura/);
  });

  it('a assinatura é a esperada', () => {
    const data = serializeChunk(sample());
    const view = new DataView(data.buffer, data.byteOffset, 4);
    expect(view.getInt32(0, true)).toBe(MAGIC);
  });
});

describe('tamanho do save', () => {
  it('um chunk gerado cabe na faixa de 1–4 KB do doc', async () => {
    const chunk = generateChunk(999, new TerrainNoise(999), 5, 5);
    const compressed = await compressChunk(chunk);
    const kb = compressed.length / 1024;
    console.log(`  chunk serializado: ${kb.toFixed(2)} KB`);
    expect(kb).toBeLessThan(8);
  });

  it('a compressão faz round-trip', async () => {
    const chunk = generateChunk(999, new TerrainNoise(999), 5, 5);
    const restored = await decompressChunk(await compressChunk(chunk));
    for (let y = 0; y < WORLD_HEIGHT; y += 7) {
      for (let z = 0; z < 16; z += 5) {
        for (let x = 0; x < 16; x += 5) {
          expect(restored.getBlock(x, y, z)).toBe(chunk.getBlock(x, y, z));
        }
      }
    }
  });
});
