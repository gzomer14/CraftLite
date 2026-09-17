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
import { AIR, makeState } from '../../data/blocks';
import { Rng, hash2 } from '../../core/rng';
import { SEA_LEVEL, SECTION_SIZE, WORLD_HEIGHT, type ChunkColumn } from '../chunk';
import type { HeightField } from './heightfield';

/** Sal do RNG de decoração — separado dos usados pelo terreno e pelos minérios. */
const SALT_DECOR = 20;

/** Blocos usados aqui, resolvidos uma vez. */
const OAK_LOG = makeState(30);
const BIRCH_LOG = makeState(31);
const SPRUCE_LOG = makeState(32);
const ACACIA_LOG = makeState(33);
const OAK_LEAVES = makeState(38);
const BIRCH_LEAVES = makeState(39);
const SPRUCE_LEAVES = makeState(40);
const TALL_GRASS = makeState(42);
const FERN = makeState(43);
const DANDELION = makeState(44);
const POPPY = makeState(45);
const CACTUS = makeState(46);
const SUGAR_CANE = makeState(47);
const DEAD_BUSH = makeState(48);

export type TreeKind = 'oak' | 'birch' | 'spruce' | 'acacia';

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

  const base = ground + 1;
  if (kind === 'spruce') {
    growSpruce(chunk, rng, wx, base, wz);
  } else if (kind === 'acacia') {
    growAcacia(chunk, rng, wx, base, wz);
  } else {
    growRound(chunk, rng, wx, base, wz, kind);
  }
}

/** Carvalho e bétula: tronco reto com uma copa arredondada. */
function growRound(
  chunk: ChunkColumn, rng: Rng, wx: number, base: number, wz: number, kind: TreeKind,
): void {
  const log = kind === 'birch' ? BIRCH_LOG : OAK_LOG;
  const leaves = kind === 'birch' ? BIRCH_LEAVES : OAK_LEAVES;
  const height = (kind === 'birch' ? 5 : 4) + rng.nextInt(3);

  for (let y = 0; y < height; y++) setSolid(chunk, wx, base + y, wz, log);

  const top = base + height;
  for (let dy = -2; dy <= 1; dy++) {
    const radius = dy >= 1 ? 1 : 2;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Corta os cantos do anel largo, senão a copa fica um cubo.
        if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if (rng.nextFloat() < 0.75) continue;
        }
        if (dx === 0 && dz === 0 && dy < 1) continue;
        setLeaf(chunk, wx + dx, top + dy, wz + dz, leaves);
      }
    }
  }
}

/** Pinheiro: cônico, mais alto e mais estreito no topo. */
function growSpruce(
  chunk: ChunkColumn, rng: Rng, wx: number, base: number, wz: number,
): void {
  const height = 7 + rng.nextInt(4);
  for (let y = 0; y < height; y++) setSolid(chunk, wx, base + y, wz, SPRUCE_LOG);

  let radius = 0;
  for (let y = height; y >= 2; y--) {
    // O raio cresce descendo e reinicia a cada dois níveis: é o que dá o
    // recorte de galhos em degraus do pinheiro.
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue;
        if (dx === 0 && dz === 0 && y < height) continue;
        setLeaf(chunk, wx + dx, base + y, wz + dz, SPRUCE_LEAVES);
      }
    }
    radius = radius >= 2 ? 0 : radius + 1;
  }
}

/** Acácia: tronco curto e uma copa chata e larga. */
function growAcacia(
  chunk: ChunkColumn, rng: Rng, wx: number, base: number, wz: number,
): void {
  const height = 4 + rng.nextInt(2);
  for (let y = 0; y < height; y++) setSolid(chunk, wx, base + y, wz, ACACIA_LOG);

  const top = base + height;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dz * dz > 9) continue;
      setLeaf(chunk, wx + dx, top, wz + dz, OAK_LEAVES);
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
        setLeaf(chunk, wx + dx, top + 1, wz + dz, OAK_LEAVES);
      }
    }
  }
}

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
