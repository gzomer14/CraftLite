/**
 * Decoração do terreno: árvores e plantas por bioma (doc 03 §4 e doc 04).
 *
 * Sem isto o mundo é geologia sem vida — e, mais grave, **sem madeira o jogo não
 * começa**: não há tábua, não há bancada, não há picareta. A decoração é o que
 * fecha o loop de sobrevivência do doc 14.
 *
 * Duas decisões que valem explicação:
 *
 * 1. **Árvore atravessa a borda do chunk.** Em vez de proibir árvore perto da
 *    borda (o que desenha uma grade visível no mapa), cada chunk sorteia
 *    também as árvores dos **8 vizinhos** e escreve só a parte que cai dentro
 *    dele. Como o sorteio vem de `rngAt(seed, cx, cz)`, os dois lados chegam
 *    exatamente ao mesmo resultado, em qualquer ordem de geração e com qualquer
 *    número de workers.
 * 2. **A altura do terreno vem do mesmo `HeightField` que o gerador usou**, e é
 *    por isso que ele tem margem: a janela preparada cobre 16 blocos para fora
 *    do chunk, que é exatamente o alcance de uma árvore de vizinho. Perguntar a
 *    outra fonte daria outra altura e a árvore nasceria flutuando.
 */

import { BIOMES } from '../../data/biomes';
import { AIR, BLOCK_BY_NAME, defOf, makeState } from '../../data/blocks';
import { Rng, hash2 } from '../../core/rng';
import { SEA_LEVEL, SECTION_SIZE, WORLD_HEIGHT, type ChunkColumn } from '../chunk';
import type { HeightField } from './heightfield';
import { growTree, type TreeKind, type TreeWriter } from '../trees';

export type { TreeKind } from '../trees';

/** Sal do RNG de decoração — separado dos usados pelo terreno e pelos minérios. */
const SALT_DECOR = 20;
/**
 * Sal próprio dos cogumelos (2026-09-22). Eles chegaram depois de tudo, e usar
 * o sorteio da decoração mudaria a posição de toda árvore e flor ainda não
 * gerada — com costura contra o mundo salvo.
 */
const SALT_MUSHROOM = 21;
const BROWN_MUSHROOM = makeState(BLOCK_BY_NAME.get('brown_mushroom')?.id ?? 0);
const RED_MUSHROOM = makeState(BLOCK_BY_NAME.get('red_mushroom')?.id ?? 0);
/** Tentativas de cogumelo por chunk no chão de caverna, e o teto delas. */
const CAVE_MUSHROOM_TRIES = 4;
const CAVE_MUSHROOM_MAX_Y = 50;
/** Cogumelos de superfície por bioma: o escuro da mata fechada e do pântano. */
const SURFACE_MUSHROOMS: Record<string, number> = { swamp: 2, taiga: 0.6, forest: 0.4 };

/** Blocos usados aqui, resolvidos uma vez. Tronco e folha vêm de `trees.ts`. */
const TALL_GRASS = makeState(42);
const FERN = makeState(43);
const DANDELION = makeState(44);
const POPPY = makeState(45);
const CACTUS = makeState(46);
const SUGAR_CANE = makeState(47);
const DEAD_BUSH = makeState(48);

/** Quanto cada bioma recebe. Contagens fracionárias viram probabilidade. */
export interface DecorSpec {
  tree?: { kind: TreeKind; perChunk: number };
  /** Tufos de grama alta / samambaia. */
  grass?: number;
  flowers?: number;
  cactus?: number;
  deadBush?: number;
  /** Cana, só na beira da água. */
  sugarCane?: number;
}

/**
 * Tabela por bioma. Uma linha por bioma, como o resto do projeto — mudar a
 * densidade de floresta é mudar um número aqui.
 */
export const DECOR: Record<string, DecorSpec> = {
  ocean: {},
  beach: { sugarCane: 3 },
  plains: { tree: { kind: 'oak', perChunk: 0.4 }, grass: 12, flowers: 5 },
  forest: { tree: { kind: 'oak', perChunk: 7 }, grass: 8, flowers: 2 },
  taiga: { tree: { kind: 'spruce', perChunk: 6 }, grass: 4, flowers: 1 },
  desert: { cactus: 3, deadBush: 3 },
  savanna: { tree: { kind: 'acacia', perChunk: 1.5 }, grass: 10, flowers: 1 },
  snowy_plains: { tree: { kind: 'spruce', perChunk: 1 }, grass: 2 },
  mountains: { tree: { kind: 'spruce', perChunk: 0.5 }, grass: 2 },
  swamp: { tree: { kind: 'oak', perChunk: 2 }, grass: 10, sugarCane: 4 },
};

/** Superfícies em que planta e árvore pegam. */
const SOIL = new Set([8, 9, 6, 15]); // grass_block, podzol, dirt, snow_block

/**
 * Decora `chunk`, escrevendo também o que transborda dos 8 vizinhos.
 * Deve rodar **antes** do heightmap e da luz do céu.
 */
export function decorate(chunk: ChunkColumn, seed: number, field: HeightField): void {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      decorateFrom(chunk, seed, field, chunk.cx + dx, chunk.cz + dz);
    }
  }
  placeMushrooms(chunk, seed, field);
}

/**
 * Cogumelos (doc 05 §4: o ensopado precisa deles). Só dentro do próprio
 * chunk — cogumelo não transborda, então não precisa do sorteio dos vizinhos —
 * e com sorteio próprio (`SALT_MUSHROOM`).
 *
 * Na caverna, o chão é o primeiro ar sobre bloco opaco descendo de
 * `CAVE_MUSHROOM_MAX_Y`; na superfície, a mesma regra de chão das flores.
 */
function placeMushrooms(chunk: ChunkColumn, seed: number, field: HeightField): void {
  const rng = new Rng(hash2(seed, chunk.cx, chunk.cz, SALT_MUSHROOM), SALT_MUSHROOM);
  for (let i = 0; i < CAVE_MUSHROOM_TRIES; i++) {
    const lx = rng.nextInt(SECTION_SIZE);
    const lz = rng.nextInt(SECTION_SIZE);
    const kind = rng.nextFloat() < 0.65 ? BROWN_MUSHROOM : RED_MUSHROOM;
    for (let y = CAVE_MUSHROOM_MAX_Y; y > 8; y--) {
      if (chunk.getBlock(lx, y, lz) !== AIR) continue;
      const floor = chunk.getBlock(lx, y - 1, lz);
      if (floor === AIR || !defOf(floor).opaque) continue;
      chunk.setBlock(lx, y, lz, kind);
      break;
    }
  }

  const center = field.sample(chunk.cx * SECTION_SIZE + 8, chunk.cz * SECTION_SIZE + 8);
  const biome = BIOMES[center.biome];
  const perChunk = biome === undefined ? 0 : SURFACE_MUSHROOMS[biome.name] ?? 0;
  const count = countOf(rng, perChunk);
  for (let i = 0; i < count; i++) {
    const kind = rng.nextFloat() < 0.65 ? BROWN_MUSHROOM : RED_MUSHROOM;
    placePlant(chunk, field, rng, chunk.cx, chunk.cz, kind);
  }
}

/** Sorteia as features do chunk `(ncx, ncz)` e escreve o que cai em `chunk`. */
function decorateFrom(
  chunk: ChunkColumn, seed: number, field: HeightField, ncx: number, ncz: number,
): void {
  const rng = new Rng(hash2(seed, ncx, ncz, SALT_DECOR), SALT_DECOR);

  // O bioma do centro do chunk decide o que cresce nele: variar por coluna
  // deixaria meia árvore de acácia dentro da floresta.
  const center = field.sample(ncx * SECTION_SIZE + 8, ncz * SECTION_SIZE + 8);
  const biome = BIOMES[center.biome];
  const spec = biome === undefined ? undefined : DECOR[biome.name];
  if (spec === undefined) return;

  if (spec.tree !== undefined) {
    const count = countOf(rng, spec.tree.perChunk);
    for (let i = 0; i < count; i++) {
      placeTree(chunk, field, rng, ncx, ncz, spec.tree.kind);
    }
  }
  if (spec.grass !== undefined) {
    for (let i = 0; i < spec.grass; i++) {
      placePlant(chunk, field, rng, ncx, ncz, rng.nextFloat() < 0.25 ? FERN : TALL_GRASS);
    }
  }
  if (spec.flowers !== undefined) {
    for (let i = 0; i < spec.flowers; i++) {
      placePlant(chunk, field, rng, ncx, ncz, rng.nextFloat() < 0.5 ? DANDELION : POPPY);
    }
  }
  if (spec.deadBush !== undefined) {
    for (let i = 0; i < spec.deadBush; i++) {
      placePlant(chunk, field, rng, ncx, ncz, DEAD_BUSH, true);
    }
  }
  if (spec.cactus !== undefined) {
    const count = countOf(rng, spec.cactus);
    for (let i = 0; i < count; i++) placeCactus(chunk, field, rng, ncx, ncz);
  }
  if (spec.sugarCane !== undefined) {
    for (let i = 0; i < spec.sugarCane; i++) placeSugarCane(chunk, field, rng, ncx, ncz);
  }
}

/** Parte inteira mais a fração como probabilidade. */
function countOf(rng: Rng, value: number): number {
  const whole = Math.floor(value);
  return whole + (rng.nextFloat() < value - whole ? 1 : 0);
}

/**
 * Altura da coluna, ou −1 se ela não serve de chão para vegetação.
 * `sandy` aceita areia (cacto, arbusto morto).
 */
function groundHeight(
  chunk: ChunkColumn, field: HeightField, wx: number, wz: number, sandy: boolean,
): number {
  const sample = field.sample(wx, wz);
  const height = sample.height;
  if (height < SEA_LEVEL + 1 || height >= WORLD_HEIGHT - 12) return -1;

  const biome = BIOMES[sample.biome];
  if (biome === undefined) return -1;
  const surface = biome.surface;
  if (sandy) {
    // 10 = sand, 11 = red_sand.
    if (surface !== 10 && surface !== 11) return -1;
  } else if (!SOIL.has(surface)) {
    return -1;
  }

  // Se a coluna estiver dentro do chunk, confirma no bloco de verdade: caverna
  // aberta na superfície não deve receber árvore pendurada.
  const lx = wx - chunk.cx * SECTION_SIZE;
  const lz = wz - chunk.cz * SECTION_SIZE;
  if (lx >= 0 && lx < SECTION_SIZE && lz >= 0 && lz < SECTION_SIZE) {
    if (chunk.getBlock(lx, height, lz) === AIR) return -1;
    if (chunk.getBlock(lx, height + 1, lz) !== AIR) return -1;
  }
  return height;
}

function placeTree(
  chunk: ChunkColumn, field: HeightField, rng: Rng, ncx: number, ncz: number, kind: TreeKind,
): void {
  const wx = ncx * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const wz = ncz * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const ground = groundHeight(chunk, field, wx, wz, false);
  if (ground < 0) return;

  CHUNK_WRITER.chunk = chunk;
  growTree(CHUNK_WRITER, rng, kind, wx, ground + 1, wz);
}

/**
 * Escritor de árvore que recorta no chunk sendo gerado (ver `trees.ts`).
 * Um só, reusado: a geração de uma coluna escreve dezenas de árvores.
 */
const CHUNK_WRITER: TreeWriter & { chunk: ChunkColumn | null } = {
  chunk: null,
  trunk(x, y, z, state) { if (this.chunk !== null) setSolid(this.chunk, x, y, z, state); },
  leaf(x, y, z, state) { if (this.chunk !== null) setLeaf(this.chunk, x, y, z, state); },
};

function placePlant(
  chunk: ChunkColumn, field: HeightField, rng: Rng,
  ncx: number, ncz: number, state: number, sandy = false,
): void {
  const wx = ncx * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const wz = ncz * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const ground = groundHeight(chunk, field, wx, wz, sandy);
  if (ground < 0) return;
  setIfAir(chunk, wx, ground + 1, wz, state);
}

function placeCactus(
  chunk: ChunkColumn, field: HeightField, rng: Rng, ncx: number, ncz: number,
): void {
  const wx = ncx * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const wz = ncz * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const ground = groundHeight(chunk, field, wx, wz, true);
  if (ground < 0) return;
  const height = 1 + rng.nextInt(3);
  for (let y = 1; y <= height; y++) setIfAir(chunk, wx, ground + y, wz, CACTUS);
}

/** Cana só nasce coladinha na água, como no gênero. */
function placeSugarCane(
  chunk: ChunkColumn, field: HeightField, rng: Rng, ncx: number, ncz: number,
): void {
  const wx = ncx * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const wz = ncz * SECTION_SIZE + rng.nextInt(SECTION_SIZE);
  const sample = field.sample(wx, wz);
  // Praia: a coluna tem que estar a um ou dois blocos acima do mar.
  if (sample.height < SEA_LEVEL || sample.height > SEA_LEVEL + 1) return;
  const height = 1 + rng.nextInt(3);
  for (let y = 1; y <= height; y++) setIfAir(chunk, wx, sample.height + y, wz, SUGAR_CANE);
}

// --- escrita com recorte no chunk -------------------------------------------

/** Escreve mesmo sobre o que existir (tronco). */
function setSolid(chunk: ChunkColumn, wx: number, wy: number, wz: number, state: number): void {
  write(chunk, wx, wy, wz, state, 'always');
}

/** Folha só entra no ar — não apaga tronco nem terreno. */
function setLeaf(chunk: ChunkColumn, wx: number, wy: number, wz: number, state: number): void {
  write(chunk, wx, wy, wz, state, 'air');
}

function setIfAir(chunk: ChunkColumn, wx: number, wy: number, wz: number, state: number): void {
  write(chunk, wx, wy, wz, state, 'air');
}

function write(
  chunk: ChunkColumn, wx: number, wy: number, wz: number, state: number,
  mode: 'always' | 'air',
): void {
  if (wy < 1 || wy >= WORLD_HEIGHT) return;
  const lx = wx - chunk.cx * SECTION_SIZE;
  const lz = wz - chunk.cz * SECTION_SIZE;
  if (lx < 0 || lx >= SECTION_SIZE || lz < 0 || lz >= SECTION_SIZE) return;
  if (mode === 'air' && chunk.getBlock(lx, wy, lz) !== AIR) return;
  chunk.setBlock(lx, wy, lz, state);
}
