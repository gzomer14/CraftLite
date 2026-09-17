/**
 * Campo de altura e bioma (`world/gen/heightfield.ts`).
 *
 * O teste que importa aqui é o de regressão do bug dos **pilares verticais**:
 * relato do jogador em 2026-09-17, *"as montanhas eram literalmente verticais,
 * vários blocos de altura só que totalmente verticais (…) simplesmente pilares
 * enormes verticais, e vários um do lado do outro"*.
 *
 * Duas causas, as duas medíveis sem abrir o jogo:
 *
 * 1. o `heightOffset` do bioma entrava em degrau, então montanha (26) contra
 *    planície (2) dava **29 blocos de desnível em um bloco** de distância;
 * 2. a altura terminava num `clamp` duro em 124, e **54% das colunas de
 *    montanha** batiam nele — a cordilheira virava um platô liso.
 *
 * A região usada (bloco −1024, −2048 da seed 12345) foi escolhida por varredura
 * como a mais montanhosa do mundo dessa seed: é onde o bug aparecia pior.
 */

import { describe, expect, it } from 'vitest';
import { BIOMES } from '../src/data/biomes';
import { HeightField, softCeiling } from '../src/world/gen/heightfield';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { SECTION_SIZE, WORLD_HEIGHT } from '../src/world/chunk';

const SEED = 12345;
/** Canto da região montanhosa, em chunks. */
const CX0 = -64;
const CZ0 = -128;
/** Lado da amostra, em chunks. 16×16 chunks = 256×256 blocos. */
const R = 16;
const W = R * SECTION_SIZE;

interface Campo { height: Uint8Array; biome: Uint8Array; }

/** Gera a região inteira uma vez e devolve os mapas de altura e bioma. */
function regiao(): Campo {
  const noise = new TerrainNoise(SEED);
  const height = new Uint8Array(W * W);
  const biome = new Uint8Array(W * W);
  for (let cz = 0; cz < R; cz++) {
    for (let cx = 0; cx < R; cx++) {
      const chunk = generateChunk(SEED, noise, CX0 + cx, CZ0 + cz,
        { caves: false, ores: false, decoration: false, structures: false });
      for (let lz = 0; lz < SECTION_SIZE; lz++) {
        for (let lx = 0; lx < SECTION_SIZE; lx++) {
          const i = (cz * SECTION_SIZE + lz) * W + cx * SECTION_SIZE + lx;
          height[i] = chunk.heightMap[(lz << 4) | lx];
          biome[i] = chunk.biomeMap[(lz << 4) | lx];
        }
      }
    }
  }
  return { height, biome };
}

const CAMPO = regiao();

/** Maior desnível entre colunas vizinhas na região. */
function maiorDegrau(campo: Campo): number {
  let max = 0;
  for (let z = 1; z < W; z++) {
    for (let x = 1; x < W; x++) {
      const h = campo.height[z * W + x];
      const dx = Math.abs(h - campo.height[z * W + x - 1]);
      const dz = Math.abs(h - campo.height[(z - 1) * W + x]);
      if (dx > max) max = dx;
      if (dz > max) max = dz;
    }
  }
  return max;
}

describe('campo de altura', () => {
  it('não deixa parede vertical entre biomas', () => {
    // Antes do blend o pior degrau desta região era 37 blocos. O terreno é
    // ruído: um degrau de meia dúzia de blocos é penhasco, o que é desejável;
    // dezenas é parede, que é o bug.
    expect(maiorDegrau(CAMPO)).toBeLessThanOrEqual(8);
  });

  it('quase nenhum vizinho é penhasco', () => {
    let grandes = 0;
    let total = 0;
    for (let z = 1; z < W; z++) {
      for (let x = 1; x < W; x++) {
        total++;
        const h = CAMPO.height[z * W + x];
        const d = Math.max(
          Math.abs(h - CAMPO.height[z * W + x - 1]),
          Math.abs(h - CAMPO.height[(z - 1) * W + x]),
        );
        if (d >= 6) grandes++;
      }
    }
    // Eram 3,10% com a parede de bioma; sem ela, menos de um por mil.
    expect(grandes / total).toBeLessThan(0.001);
  });

  it('nenhuma coluna encosta no teto do mundo', () => {
    // 10,3% da região inteira ficava chapada em 124 — e 54,3% das colunas de
    // montanha. É isso que fazia o topo do pilar ser liso.
    let noTeto = 0;
    for (let i = 0; i < CAMPO.height.length; i++) {
      if (CAMPO.height[i] >= WORLD_HEIGHT - 4) noTeto++;
    }
    expect(noTeto).toBe(0);
  });

  it('montanha continua sendo montanha, não colina', () => {
    let min = WORLD_HEIGHT;
    let max = 0;
    let n = 0;
    for (let i = 0; i < CAMPO.height.length; i++) {
      if (BIOMES[CAMPO.biome[i]].name !== 'mountains') continue;
      n++;
      if (CAMPO.height[i] < min) min = CAMPO.height[i];
      if (CAMPO.height[i] > max) max = CAMPO.height[i];
    }
    expect(n).toBeGreaterThan(1000);
    // O doc 03 §4.3 pede montanha entre 90 e 124. Antes a faixa inteira era
    // 118..124 — sete blocos, metade deles colados no teto.
    expect(min).toBeGreaterThanOrEqual(85);
    expect(max - min).toBeGreaterThan(20);
    expect(max).toBeLessThan(WORLD_HEIGHT - 4);
  });
});

describe('teto macio', () => {
  it('não muda nada abaixo do joelho', () => {
    expect(softCeiling(64)).toBe(64);
    expect(softCeiling(100)).toBe(100);
  });

  it('é crescente e nunca alcança o teto', () => {
    let previous = -1;
    for (let h = 100; h < 400; h += 0.5) {
      const y = softCeiling(h);
      expect(y).toBeGreaterThan(previous);
      expect(y).toBeLessThan(WORLD_HEIGHT - 4);
      previous = y;
    }
  });
});

describe('determinismo do campo', () => {
  it('a janela preparada e o caminho de fora dão a mesma altura', () => {
    const dentro = new HeightField(new TerrainNoise(SEED));
    dentro.prepare(CX0 + 4, CZ0 + 4);
    // Um campo nunca preparado cai no caminho lento para qualquer coordenada.
    const fora = new HeightField(new TerrainNoise(SEED));
    for (let i = 0; i < 40; i++) {
      const wx = (CX0 + 4) * SECTION_SIZE + (i * 7) % SECTION_SIZE;
      const wz = (CZ0 + 4) * SECTION_SIZE + (i * 11) % SECTION_SIZE;
      expect(fora.heightAt(wx, wz)).toBe(dentro.heightAt(wx, wz));
    }
  });

  it('a mesma coluna sai igual pedida por chunks vizinhos', () => {
    // A margem de 16 blocos é o que decoração e estrutura usam: a coluna da
    // borda tem de valer o mesmo vista dos dois lados, senão a árvore do
    // vizinho nasce flutuando.
    const field = new HeightField(new TerrainNoise(SEED));
    const wx = (CX0 + 4) * SECTION_SIZE;
    const wz = (CZ0 + 4) * SECTION_SIZE;
    field.prepare(CX0 + 4, CZ0 + 4);
    const aqui = field.heightAt(wx, wz);
    field.prepare(CX0 + 3, CZ0 + 4);
    expect(field.heightAt(wx, wz)).toBe(aqui);
    field.prepare(CX0 + 4, CZ0 + 3);
    expect(field.heightAt(wx, wz)).toBe(aqui);
  });
});
