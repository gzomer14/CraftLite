/**
 * Tint de grama, folha e água por bioma (doc 03 §4.3; M14).
 *
 * As cores de `data/biomes.ts` não eram lidas por ninguém: toda grama do
 * mundo saía da mesma cor. Agora o clima de cada coluna vai para uma textura
 * e o vertex shader pinta com a tabela `clima → cor`. Aqui: a tabela, o clima
 * que a thread principal calcula (tem que ser o mesmo do gerador) e o anel de
 * chunks em volta da câmera, com GL de mentira.
 */
import { TERRAIN_VS_100 } from '../src/render/shaders/terrain.glsl';
import { describe, expect, it } from 'vitest';
import { BIOMES, pickBiome, pickClimateBiome } from '../src/data/biomes';
import {
  BiomeTint, COLORMAP_KINDS, COLORMAP_SIZE, buildColormap, climateTextureSide,
} from '../src/render/biometint';
import { ClimateSampler, climateByte } from '../src/world/gen/climate';
import { TerrainNoise } from '../src/world/gen/terrain';
import { SEA_LEVEL } from '../src/world/chunk';

const byName = (name: string) => BIOMES.find((b) => b.name === name)!;

/** Cor da tabela no clima `(t, h)`, tipo 0 = grama, 1 = folha, 2 = água. */
function colorAt(map: Uint8Array, kind: number, t: number, h: number): [number, number, number] {
  const i = Math.min(COLORMAP_SIZE - 1, Math.floor((t + 1) / 2 * COLORMAP_SIZE));
  const j = Math.min(COLORMAP_SIZE - 1, Math.floor((h + 1) / 2 * COLORMAP_SIZE));
  const o = ((kind * COLORMAP_SIZE + j) * COLORMAP_SIZE + i) * 4;
  return [map[o], map[o + 1], map[o + 2]];
}

function hex(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

describe('tabela clima → cor', () => {
  const map = buildColormap();

  it('tem três faixas (grama, folha, água) do tamanho declarado', () => {
    expect(map.length).toBe(COLORMAP_SIZE * COLORMAP_SIZE * COLORMAP_KINDS * 4);
  });

  it('no meio da caixa de um bioma, a cor é a dele', () => {
    for (const name of ['plains', 'desert', 'snowy_plains']) {
      const b = byName(name);
      const t = (b.temperature![0] + b.temperature![1]) / 2;
      const h = (b.humidity![0] + b.humidity![1]) / 2;
      const got = colorAt(map, 0, t, h);
      const want = hex(b.grassTint);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c]), name).toBeLessThanOrEqual(12);
    }
  });

  it('o pântano sai mais escuro que a floresta, na grama e na água', () => {
    // Pântano só em t 0,7–0,8: de 0,5 a 0,7 a caixa da floresta, que vem antes, ganha.
    expect(BIOMES[pickClimateBiome(0.75, 0.95)].name).toBe('swamp');
    const lum = (c: [number, number, number]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    expect(lum(colorAt(map, 0, 0.75, 0.95))).toBeLessThan(lum(colorAt(map, 0, 0.3, 0.9)) - 15);
    expect(lum(colorAt(map, 2, 0.75, 0.95))).toBeLessThan(lum(colorAt(map, 2, 0.3, 0.9)) - 5);
  });

  it('a fronteira é degradê: vizinhos da tabela mudam pouco', () => {
    let worst = 0;
    for (let k = 0; k < COLORMAP_KINDS; k++) {
      for (let j = 0; j < COLORMAP_SIZE; j++) {
        for (let i = 1; i < COLORMAP_SIZE; i++) {
          const a = ((k * COLORMAP_SIZE + j) * COLORMAP_SIZE + i) * 4;
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(map[a + c] - map[a - 4 + c]));
        }
      }
    }
    // Sem borrão, o salto deserto → neve passava de 60 num texel só. Uma
    // célula é ~25 blocos de mundo: 50 por célula já é degradê no chão.
    expect(worst).toBeLessThanOrEqual(50);
  });
});

describe('variações de bioma', () => {
  it('dentro da caixa da variação, ela ganha do pai; fora, não concorre', () => {
    expect(BIOMES[pickClimateBiome(0.35, 0.7)].name).toBe('birch_forest');
    expect(BIOMES[pickClimateBiome(0.6, 0.9)].name).toBe('forest');
    expect(BIOMES[pickClimateBiome(0.5, 0.3)].name).toBe('flower_plains');
    expect(BIOMES[pickClimateBiome(0.7, 0.45)].name).toBe('plains');
  });

  it('o lookup de altura continua passando pelo clima', () => {
    expect(BIOMES[pickBiome(SEA_LEVEL + 8, SEA_LEVEL, 0.35, 0.7, 0)].name).toBe('birch_forest');
    expect(BIOMES[pickBiome(SEA_LEVEL - 10, SEA_LEVEL, 0.35, 0.7, 0)].name).toBe('ocean');
  });
});

describe('clima na thread principal', () => {
  it('dá o mesmo byte que o gerador de terreno, coluna a coluna', () => {
    const seed = 2;
    const field = new TerrainNoise(seed).field;
    const sampler = new ClimateSampler(seed);
    const out = new Uint8Array(16 * 16 * 2);
    for (const [cx, cz] of [[0, 0], [-3, 7], [40, -12]]) {
      sampler.fillChunk(cx, cz, out, 0, 32);
      field.prepare(cx, cz);
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const s = field.sample(cx * 16 + lx, cz * 16 + lz);
          expect(out[lz * 32 + lx * 2]).toBe(climateByte(s.temperature));
          expect(out[lz * 32 + lx * 2 + 1]).toBe(climateByte(s.humidity));
        }
      }
    }
  });

  it('o clima chega às pontas: floresta, savana, pântano e as variações existem', () => {
    // Só o clima, que é o que decide esses cinco: a altura é de outro teste.
    const sampler = new ClimateSampler(2);
    const out = new Uint8Array(16 * 16 * 2);
    const seen = new Set<string>();
    for (let cz = -400; cz < 400; cz += 4) {
      for (let cx = -400; cx < 400; cx += 4) {
        sampler.fillChunk(cx, cz, out, 0, 32);
        seen.add(BIOMES[pickClimateBiome(out[0] / 127.5 - 1, out[1] / 127.5 - 1)].name);
      }
    }
    for (const name of ['forest', 'savanna', 'swamp', 'birch_forest', 'flower_plains']) {
      expect(seen.has(name), name).toBe(true);
    }
  });
});

/** GL de mentira: conta os uploads, guarda o último pedaço. */
function fakeGl() {
  const calls = { sub: 0, full: 0, formats: [] as number[] };
  const gl = {
    TEXTURE_2D: 1, RGBA8: 2, RGBA: 3, UNSIGNED_BYTE: 4, RG8: 5, RG: 6, LINEAR: 7, LUMINANCE_ALPHA: 15,
    CLAMP_TO_EDGE: 8, REPEAT: 9, TEXTURE_MIN_FILTER: 10, TEXTURE_MAG_FILTER: 11,
    TEXTURE_WRAP_S: 12, TEXTURE_WRAP_T: 13, UNPACK_ALIGNMENT: 14, TEXTURE0: 100,
    createTexture: () => ({}),
    bindTexture: () => {},
    texImage2D: (...args: unknown[]) => { calls.full++; calls.formats.push(args[6] as number); },
    texSubImage2D: (...args: unknown[]) => { calls.sub++; calls.formats.push(args[6] as number); },
    texParameteri: () => {},
    pixelStorei: () => {},
    activeTexture: () => {},
    deleteTexture: () => {},
  };
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

describe('anel de clima em volta da câmera', () => {
  it('a textura é potência de 2 e cobre o anel com folga', () => {
    for (const rd of [2, 4, 8, 12, 16]) {
      const side = climateTextureSide(rd);
      expect(side & (side - 1)).toBe(0);
      expect(side).toBeGreaterThanOrEqual((2 * rd + 3) * 16);
    }
    expect(climateTextureSide(4)).toBe(256);
  });

  it('preenche do centro para fora, no máximo 32 chunks por quadro, e não refaz', () => {
    const { gl, calls } = fakeGl();
    const tint = new BiomeTint(gl, gl);
    tint.setRenderDistance(4);
    tint.setSeed(2);
    const ring = (2 * 5 + 1) ** 2;
    let frames = 0;
    let total = 0;
    do {
      tint.update(8, 8);
      total += tint.filled;
      frames++;
      expect(tint.filled).toBeLessThanOrEqual(32);
    } while (tint.filled > 0 && frames < 100);
    expect(total).toBe(ring);
    expect(calls.sub).toBe(ring);
    // Parado: nada a fazer.
    tint.update(8, 8);
    expect(tint.filled).toBe(0);
    // Um chunk para o lado: entra uma fileira nova (11 chunks).
    tint.update(8 + 16, 8);
    expect(tint.filled).toBe(11);
  });

  it('no Nether não calcula clima', () => {
    const { gl } = fakeGl();
    const tint = new BiomeTint(gl, gl);
    tint.setRenderDistance(4);
    tint.setSeed(2);
    tint.enabled = false;
    tint.update(0, 0);
    expect(tint.filled).toBe(0);
  });
});

describe('tint de bioma no WebGL1 (M19)', () => {
  it('sem RG8, o clima vai em LUMINANCE_ALPHA: os mesmos dois bytes por coluna', () => {
    const { gl, calls } = fakeGl();
    const tint = new BiomeTint(gl as unknown as WebGLRenderingContext, null);
    tint.setRenderDistance(2);
    tint.setSeed(2);
    tint.update(0, 0);
    expect(tint.filled).toBeGreaterThan(0);
    // O primeiro upload é a tabela de cores (RGBA); os de clima, todos em LA.
    expect(calls.formats.slice(1).every((f) => f === 15)).toBe(true);
  });

  it('o shader WebGL1 lê o clima no vertex, com o mesmo define do WebGL2', () => {
    expect(TERRAIN_VS_100).toContain('#ifdef BIOME_TINT');
    expect(TERRAIN_VS_100).toContain('texture2DLod(uClimate');
    expect(TERRAIN_VS_100).toContain('.ra');
  });
});
