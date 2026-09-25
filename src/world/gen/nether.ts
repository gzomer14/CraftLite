/**
 * Gerador do Nether (doc 14 — M7).
 *
 * Mesmo contrato de `terrain.ts`: puro, determinístico a partir de
 * `(seed, cx, cz)`, sem tocar no `World`, executável em qualquer worker e em
 * qualquer ordem. O que muda é a **forma** do mundo.
 *
 * O Overworld é um terreno com uma superfície e cavernas cavadas embaixo. O
 * Nether é o contrário: um bloco maciço de netherrack de 0 a 127 com **salões
 * enormes esvaziados** por ruído 3D, rocha-mãe no chão e no teto, e um mar de
 * lava no fundo. Ele não usa spline de altura nem bioma — não há "altura do
 * terreno" a definir, só quanto de rocha sobra.
 *
 * **A densidade sai de uma grade esparsa, não de um ruído por voxel.** Amostrar
 * os 32.768 voxels da coluna custava 56 ms por chunk, o dobro do orçamento de
 * 25 ms do doc 02. A grade de 5×5×17 são 425 amostras interpoladas
 * trilinearmente — a mesma técnica que `terrain.ts` usa nos mapas 2D, e o mesmo
 * motivo.
 *
 * O `heightMap` continua sendo preenchido porque o resto do motor depende dele
 * (spawn, save, física de chunk), mas aqui ele significa "o teto de netherrack
 * mais baixo", não uma superfície que alguém vê de longe.
 */

import { AIR, BEDROCK, BLOCK_BY_NAME, LAVA, makeState } from '../../data/blocks';
import { Noise } from '../../core/noise';
import { hash3 } from '../../core/rng';
import { DIM_NETHER, dimensionOf } from '../../data/dimensions';
import { ChunkColumn, SECTION_SIZE, WORLD_HEIGHT } from '../chunk';
import { computeChunkLight } from './terrain';
import { placeFortress } from './fortress';

/** Topo do mar de lava. Abaixo disto, o que não é rocha é lava. */
export const LAVA_SEA_LEVEL = 31;
/** Camadas de rocha-mãe irregular no chão e no teto. */
const BEDROCK_LAYERS = 4;

/** Frequências dos salões, em 1/blocos. */
const FREQ_HALL = 1 / 64;
const FREQ_DETAIL = 1 / 24;

/**
 * Limiar de rocha: densidade acima disto é netherrack.
 *
 * Calibrado como os limiares de caverna do Overworld — medindo o ruído e
 * mirando um Nether **navegável**. Mais rocha e o jogador não sai do lugar;
 * menos e o mundo vira um abismo vazio sobre lava, onde cair é a única coisa
 * que acontece. O alvo é ~55% de rocha acima do mar de lava.
 */
const SOLID_THRESHOLD = -0.02;

/**
 * Quanto o teto puxa a densidade para cima, e a partir de que altura.
 *
 * Sem isto os salões abrem no topo e o Nether deixa de ter teto — que é
 * justamente o que o distingue de uma caverna grande.
 */
const CEILING_START = 88;
const CEILING_WEIGHT = 1.2;
/** Idem no chão: o piso em volta da lava é mais firme que o meio. */
const FLOOR_END = 40;
const FLOOR_WEIGHT = 0.5;

/** Salts próprios; o `salt` da dimensão já separa este ruído do Overworld. */
const SALT_HALL = 21;
const SALT_DETAIL = 22;
const SALT_SOUL = 23;
const SALT_ORE = 24;
const SALT_GLOW = 25;

/** Passo da grade esparsa de densidade, em blocos. */
const GRID_STEP_XZ = 4;
const GRID_STEP_Y = 8;
const GRID_XZ = SECTION_SIZE / GRID_STEP_XZ + 1; // 5
const GRID_Y = WORLD_HEIGHT / GRID_STEP_Y + 1; // 17
/** Grade reusada entre chunks: gerar não pode alocar por coluna. */
const DENSITY = new Float32Array(GRID_XZ * GRID_XZ * GRID_Y);
/**
 * Forma de uma coluna: 0 = vazio, 1 = netherrack, 2 = rocha-mãe.
 * Reusada entre colunas — gerar não pode alocar.
 */
const SOLID = new Uint8Array(WORLD_HEIGHT);

const NETHERRACK = blockOf('netherrack');
const SOUL_SAND = blockOf('soul_sand');
const QUARTZ_ORE = blockOf('nether_quartz_ore');
const MAGMA = blockOf('magma_block');
const GLOWSTONE = blockOf('glowstone');
const BEDROCK_STATE = makeState(BEDROCK);

function blockOf(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco do Nether ausente: ${name}`);
  return makeState(def.id);
}

/** Ruído do Nether. Um objeto por worker, como o `TerrainNoise`. */
export class NetherNoise {
  readonly hall: Noise;
  readonly detail: Noise;
  readonly soul: Noise;

  constructor(seed: number) {
    const salted = saltedSeed(seed);
    this.hall = new Noise(salted, SALT_HALL);
    this.detail = new Noise(salted, SALT_DETAIL);
    this.soul = new Noise(salted, SALT_SOUL);
  }
}

/** A seed do Nether é a do mundo embaralhada pelo salt da dimensão. */
export function saltedSeed(seed: number): number {
  return (seed ^ dimensionOf(DIM_NETHER).salt) >>> 0;
}

export interface NetherOptions {
  /** Minério de quartzo e blocos de magma. */
  ores?: boolean;
  /** Areia das almas e glowstone no teto. */
  decoration?: boolean;
  /** Fortaleza (M16). */
  structures?: boolean;
}

/**
 * Gera uma coluna do Nether.
 *
 * Ordem: grade de densidade → maciço e mar de lava → rocha-mãe → minérios →
 * decoração. A rocha-mãe entra **depois** do ruído de propósito: ele não pode
 * abrir buraco no chão do mundo nem no teto.
 */
export function generateNetherChunk(
  seed: number, noise: NetherNoise, cx: number, cz: number, options: NetherOptions = {},
): ChunkColumn {
  const chunk = new ChunkColumn(cx, cz);
  const withOres = options.ores ?? true;
  const withDecoration = options.decoration ?? true;
  const salted = saltedSeed(seed);

  fillDensityGrid(noise, cx, cz);

  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      // O Nether não tem bioma: a coluna inteira fica no bioma 0, e nada lê.
      chunk.biomeMap[(lz << 4) | lx] = 0;
      buildColumn(chunk, noise, salted, lx, lz, withOres, withDecoration);
    }
  }

  // A fortaleza (M16) entra depois do maciço: as pontes cavam a rocha e os
  // pilares procuram o chão que o ruído deixou.
  if (options.structures ?? true) placeFortress(chunk, seed);

  chunk.recomputeHeightMap();
  /*
   * A luz, que **faltava** (bug de campo 2026-09-13).
   *
   * A coluna saía do gerador com luz zero em tudo: lava, pedra luminosa e
   * magma declaravam `emission` na tabela de blocos e não acendiam nada, e o
   * que se via era só a luz ambiente da dimensão. Pior que escuro, ficava
   * **manchado** — coluna que o jogador tinha modificado voltava pelo save,
   * que chama `computeChunkLight`, e nascia iluminada ao lado de uma que não.
   * Daí "parte da lava mais acesa e parte mais escura".
   *
   * O gerador da superfície sempre chamou isto; só o do Nether não chamava. A
   * luz do céu sai naturalmente em zero: a rocha-mãe do teto barra o flood
   * fill na primeira camada.
   */
  computeChunkLight(chunk);
  return chunk;
}

/**
 * Uma coluna inteira numa passada só.
 *
 * A versão anterior varria os 32.768 voxels **três vezes** — maciço, minério,
 * decoração — com `getBlock` em cada visita, e custava 15 ms por chunk. Aqui a
 * forma sai para um `Uint8Array` de 128 posições, e minério e decoração leem
 * esse vetor local em vez da paleta do chunk. É a mesma economia de sempre:
 * caminho quente não consulta estrutura de dados quando um vetor plano serve.
 */
function buildColumn(
  chunk: ChunkColumn, noise: NetherNoise, seed: number,
  lx: number, lz: number, withOres: boolean, withDecoration: boolean,
): void {
  const air = makeState(AIR);
  const lava = makeState(LAVA);
  const wx = chunk.cx * SECTION_SIZE + lx;
  const wz = chunk.cz * SECTION_SIZE + lz;

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    SOLID[y] = densityAt(lx, y, lz) > SOLID_THRESHOLD ? 1 : 0;
  }
  // Rocha-mãe antes de tudo: o ruído não abre buraco no chão nem no teto.
  sealColumn(seed, wx, wz);

  const soulPatch = withDecoration && noise.soul.noise2(wx / 40, wz / 40) > 0.25;

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    if (SOLID[y] === 2) { chunk.setBlock(lx, y, lz, BEDROCK_STATE); continue; }
    if (SOLID[y] === 0) {
      chunk.setBlock(lx, y, lz, y <= LAVA_SEA_LEVEL ? lava : air);
      continue;
    }

    let state = NETHERRACK;
    const exposedAbove = y + 1 < WORLD_HEIGHT && SOLID[y + 1] === 0;
    const exposedBelow = y > 0 && SOLID[y - 1] === 0;

    if (withDecoration && soulPatch && exposedAbove && y > LAVA_SEA_LEVEL) {
      state = SOUL_SAND;
    } else if (withOres) {
      const roll = hash3(seed, wx, y, wz, SALT_ORE) % 1000;
      if (roll < 14) state = QUARTZ_ORE;
      else if (y <= LAVA_SEA_LEVEL + 2 && roll < 24) state = MAGMA;
    }
    chunk.setBlock(lx, y, lz, state);

    // Teto exposto: cacho de glowstone pendurado, 1 a 3 blocos.
    if (withDecoration && exposedBelow && y > LAVA_SEA_LEVEL + 8
      && (hash3(seed, wx, y, wz, SALT_GLOW) % 1000) < 8) {
      for (let d = 1; d <= 3 && y - d > 0 && SOLID[y - d] === 0; d++) {
        chunk.setBlock(lx, y - d, lz, GLOWSTONE);
      }
    }
  }
}

/**
 * Amostra a densidade nos cantos da grade esparsa da coluna.
 *
 * 5×5×17 = 425 pontos, contra 32.768 voxels. É a diferença entre 4 ms e 56 ms
 * por chunk, e o que mantém a geração dentro do orçamento do doc 02 §2.
 */
function fillDensityGrid(noise: NetherNoise, cx: number, cz: number): void {
  const baseX = cx * SECTION_SIZE;
  const baseZ = cz * SECTION_SIZE;
  for (let gy = 0; gy < GRID_Y; gy++) {
    const y = gy * GRID_STEP_Y;
    const bias = verticalBias(y);
    for (let gz = 0; gz < GRID_XZ; gz++) {
      const z = baseZ + gz * GRID_STEP_XZ;
      for (let gx = 0; gx < GRID_XZ; gx++) {
        const x = baseX + gx * GRID_STEP_XZ;
        const hall = noise.hall.noise3(x * FREQ_HALL, y * FREQ_HALL, z * FREQ_HALL);
        const detail = noise.detail.noise3(x * FREQ_DETAIL, y * FREQ_DETAIL, z * FREQ_DETAIL);
        DENSITY[gridIndex(gx, gy, gz)] = hall * 0.7 + detail * 0.3 + bias;
      }
    }
  }
}

/** Empurrão de densidade pela altura: teto maciço, piso firme, meio aberto. */
function verticalBias(y: number): number {
  let bias = 0;
  if (y > CEILING_START) bias += ((y - CEILING_START) / (WORLD_HEIGHT - CEILING_START)) * CEILING_WEIGHT;
  if (y < FLOOR_END) bias += ((FLOOR_END - y) / FLOOR_END) * FLOOR_WEIGHT;
  return bias;
}

function gridIndex(gx: number, gy: number, gz: number): number {
  return (gy * GRID_XZ + gz) * GRID_XZ + gx;
}

/** Densidade interpolada trilinearmente a partir da grade. */
function densityAt(lx: number, y: number, lz: number): number {
  const gx = lx / GRID_STEP_XZ;
  const gz = lz / GRID_STEP_XZ;
  const gy = y / GRID_STEP_Y;
  const x0 = gx | 0;
  const z0 = gz | 0;
  const y0 = gy | 0;
  const x1 = Math.min(x0 + 1, GRID_XZ - 1);
  const z1 = Math.min(z0 + 1, GRID_XZ - 1);
  const y1 = Math.min(y0 + 1, GRID_Y - 1);
  const tx = gx - x0;
  const tz = gz - z0;
  const ty = gy - y0;

  const c00 = lerp(DENSITY[gridIndex(x0, y0, z0)], DENSITY[gridIndex(x1, y0, z0)], tx);
  const c10 = lerp(DENSITY[gridIndex(x0, y0, z1)], DENSITY[gridIndex(x1, y0, z1)], tx);
  const c01 = lerp(DENSITY[gridIndex(x0, y1, z0)], DENSITY[gridIndex(x1, y1, z0)], tx);
  const c11 = lerp(DENSITY[gridIndex(x0, y1, z1)], DENSITY[gridIndex(x1, y1, z1)], tx);
  return lerp(lerp(c00, c10, tz), lerp(c01, c11, tz), ty);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Marca a rocha-mãe na coluna de trabalho: `2` é o código de rocha-mãe.
 * Irregular nas camadas 1..3, sólida em 0 e no topo — fechado dos dois lados.
 */
function sealColumn(seed: number, wx: number, wz: number): void {
  SOLID[0] = 2;
  SOLID[WORLD_HEIGHT - 1] = 2;
  for (let layer = 1; layer < BEDROCK_LAYERS; layer++) {
    if ((hash3(seed, wx, layer, wz, SALT_ORE) & 3) < 3 - layer) SOLID[layer] = 2;
    if ((hash3(seed, wx, -layer, wz, SALT_ORE) & 3) < 3 - layer) {
      SOLID[WORLD_HEIGHT - 1 - layer] = 2;
    }
  }
}



