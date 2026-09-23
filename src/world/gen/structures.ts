/**
 * Colocação de estruturas no mundo (doc 03 §7).
 *
 * Duas responsabilidades, e só:
 *
 * 1. **Decidir onde uma estrutura começa.** Determinístico a partir da seed e
 *    do chunk de origem, nunca da ordem de geração.
 * 2. **Expandir as peças declarativas de `data/structures.ts` em voxels**,
 *    escrevendo só o que cai dentro do chunk sendo gerado.
 *
 * **Estrutura atravessa a borda do chunk**, como a árvore do `decorate.ts` e
 * pelo mesmo motivo: proibir estrutura perto da borda desenharia uma grade
 * visível no mapa. Cada chunk sorteia também as estruturas dos vizinhos ao
 * alcance e escreve a fatia que lhe cabe. Como o sorteio vem de
 * `hash2(seed, cx, cz)`, os dois lados chegam ao mesmo resultado em qualquer
 * ordem e com qualquer número de workers.
 *
 * **A ravina não passa por aqui**: ela é escavação, não construção, e vive com
 * as cavernas em `terrain.ts`.
 */

import { AIR, BLOCK_BY_NAME, makeState } from '../../data/blocks';
import { BIOMES } from '../../data/biomes';
import { CHEST_LOOT, STRUCTURES, type Piece, type StructureDef } from '../../data/structures';
import { hash3 } from '../../core/rng';
import { placeVillage, placeVillagePaths } from './village';
import { SEA_LEVEL, SECTION_SIZE, WORLD_HEIGHT, type ChunkColumn } from '../chunk';
import type { HeightField } from './heightfield';

/** Sal do RNG de estrutura — separado do terreno, dos minérios e da decoração. */
const SALT_STRUCTURE = 40;
const SALT_LOOT = 42;

/**
 * Alcance de busca, em chunks. A maior estrutura tem 13 blocos de lado, então
 * uma estrutura nascida no vizinho ainda pode invadir este chunk; duas casas
 * de distância, não.
 */
const SEARCH_RADIUS = 1;

/** Blocos resolvidos uma vez — o gerador não pode consultar mapa por voxel. */
let blockCache: Map<string, number> | null = null;

function blockId(name: string): number {
  if (blockCache === null) {
    blockCache = new Map();
    for (const [key, def] of BLOCK_BY_NAME) blockCache.set(key, def.id);
  }
  return blockCache.get(name) ?? AIR;
}

/**
 * Escreve no chunk todas as estruturas que o alcançam.
 * Chamado por `generateChunk`, depois da decoração.
 */
export function placeStructures(
  chunk: ChunkColumn, seed: number, field: HeightField,
): void {
  // Caminhos da aldeia primeiro: a casa que passa por cima de um vence (M9).
  placeVillagePaths(chunk, seed, field);
  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      placeFromOrigin(chunk, seed, field, chunk.cx + dx, chunk.cz + dz);
    }
  }
}

/** Todas as estruturas que nascem no chunk de origem `(ocx, ocz)`. */
function placeFromOrigin(
  chunk: ChunkColumn, seed: number, field: HeightField, ocx: number, ocz: number,
): void {
  for (let i = 0; i < STRUCTURES.length; i++) {
    const def = STRUCTURES[i];
    // A aldeia tem regra de região própria; as demais são por chunk.
    if (def.village === true) continue;
    tryPlace(chunk, seed, field, def, ocx, ocz, i);
  }
  placeVillage(seed, field, ocx, ocz, (def, ox, oy, oz) => stamp(chunk, seed, def, ox, oy, oz));
}

/** Tentativas por chunk da estrutura, com posição sorteada dentro dele. */
function tryPlace(
  chunk: ChunkColumn, seed: number, field: HeightField,
  def: StructureDef, ocx: number, ocz: number, salt: number,
): void {
  const attempts = def.placement.attempts;
  const whole = Math.floor(attempts);
  const fraction = attempts - whole;

  for (let attempt = 0; attempt <= whole; attempt++) {
    const roll = hash3(seed, ocx, attempt, ocz, SALT_STRUCTURE + salt) / 4294967296;
    if (attempt === whole) {
      if (fraction <= 0 || roll >= fraction) return;
    }
    const spot = hash3(seed, ocx, attempt + 64, ocz, SALT_STRUCTURE + salt);
    const ox = ocx * SECTION_SIZE + (spot & 15);
    const oz = ocz * SECTION_SIZE + ((spot >>> 4) & 15);
    const oy = pickY(def, ox, oz, spot, field);
    if (oy < 0) continue;
    if (!biomeAllows(def, field, ox, oz)) continue;
    stamp(chunk, seed, def, ox, oy, oz);
  }
}

/** Altura da estrutura: sorteada na faixa, ou assentada na superfície. */
export function pickY(
  def: StructureDef, ox: number, oz: number, spot: number, field: HeightField,
): number {
  if (!def.placement.surface) {
    const span = def.placement.maxY - def.placement.minY;
    return def.placement.minY + ((spot >>> 8) % Math.max(1, span + 1));
  }
  const height = field.heightAt(ox, oz);
  // No fundo do mar: só com água de verdade em cima (naufrágio).
  if (def.placement.underwater === true) return height <= SEA_LEVEL - 4 ? height + 1 : -1;
  // Assenta com o piso um bloco acima do chão; abaixo do mar não se constrói.
  if (height < 62) return -1;
  return height + 1;
}

function biomeAllows(def: StructureDef, field: HeightField, ox: number, oz: number): boolean {
  const allowed = def.placement.biomes;
  if (allowed === undefined || allowed.length === 0) return true;
  const biome = BIOMES[field.sample(ox, oz).biome];
  return allowed.indexOf(biome.name) >= 0;
}

/**
 * Escreve a estrutura no chunk, ignorando tudo que cai fora dele.
 * `ox/oy/oz` são coordenadas de mundo da origem da estrutura.
 */
export function stamp(
  chunk: ChunkColumn, seed: number, def: StructureDef, ox: number, oy: number, oz: number,
): void {
  for (const piece of def.pieces) stampPiece(chunk, seed, piece, ox, oy, oz);

  for (const chest of def.chests ?? []) {
    markInChunk(chunk, 'chest', ox + chest.at[0], oy + chest.at[1], oz + chest.at[2], chest.loot);
    setIfInside(chunk, ox + chest.at[0], oy + chest.at[1], oz + chest.at[2],
      makeState(blockId('chest')), 'any');
  }
  for (const spawner of def.spawners ?? []) {
    markInChunk(chunk, 'spawner', ox + spawner.at[0], oy + spawner.at[1], oz + spawner.at[2], spawner.mob);
    setIfInside(chunk, ox + spawner.at[0], oy + spawner.at[1], oz + spawner.at[2],
      makeState(blockId('mob_spawner')), 'any');
  }
}

function stampPiece(
  chunk: ChunkColumn, seed: number, piece: Piece, ox: number, oy: number, oz: number,
): void {
  const [x0, y0, z0, x1, y1, z1] = piece.box;
  const id = blockId(piece.block);
  const altId = piece.alt === undefined ? -1 : blockId(piece.alt);
  const altChance = piece.altChance ?? 0;
  const replace = piece.replace ?? 'any';
  const state = piece.state ?? 0;

  if (piece.kind === 'point') {
    setIfInside(chunk, ox + x0, oy + y0, oz + z0, makeState(id, state), replace);
    return;
  }

  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!pieceCovers(piece.kind, x, y, z, x0, y0, z0, x1, y1, z1)) continue;
        let block = id;
        if (altId >= 0) {
          const roll = hash3(seed, ox + x, oy + y, oz + z, SALT_STRUCTURE) / 4294967296;
          if (roll < altChance) block = altId;
        }
        setIfInside(chunk, ox + x, oy + y, oz + z, makeState(block, state), replace);
      }
    }
  }
}

/** true se o voxel faz parte da peça: casca, paredes ou volume cheio. */
function pieceCovers(
  kind: string, x: number, y: number, z: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): boolean {
  if (kind === 'fill') return true;
  const onShell = x === x0 || x === x1 || z === z0 || z === z1;
  if (kind === 'walls') return onShell;
  // hollow: casca completa, incluindo piso e teto.
  return onShell || y === y0 || y === y1;
}

/** Escreve um voxel se ele cair dentro do chunk e a regra de substituição deixar. */
function setIfInside(
  chunk: ChunkColumn, wx: number, wy: number, wz: number, state: number, replace: string,
): void {
  if (wy < 1 || wy >= WORLD_HEIGHT) return;
  const lx = wx - chunk.cx * SECTION_SIZE;
  const lz = wz - chunk.cz * SECTION_SIZE;
  if (lx < 0 || lx >= SECTION_SIZE || lz < 0 || lz >= SECTION_SIZE) return;

  if (replace !== 'any') {
    const current = chunk.getBlock(lx, wy, lz);
    if (replace === 'air' && current !== AIR) return;
    if (replace === 'solid' && current === AIR) return;
  }
  chunk.setBlock(lx, wy, lz, state);
}

/** Registra um marco, se a posição cair dentro deste chunk. */
function markInChunk(
  chunk: ChunkColumn, kind: 'chest' | 'spawner' | 'mob',
  wx: number, wy: number, wz: number, data: string,
): void {
  const lx = wx - chunk.cx * SECTION_SIZE;
  const lz = wz - chunk.cz * SECTION_SIZE;
  if (lx < 0 || lx >= SECTION_SIZE || lz < 0 || lz >= SECTION_SIZE) return;
  if (wy < 1 || wy >= WORLD_HEIGHT) return;
  chunk.structures.push({ kind, x: wx, y: wy, z: wz, data });
}

/**
 * Conteúdo de um baú de estrutura, determinístico pela posição.
 *
 * Fica aqui e não em `data/loot.ts` porque a tabela de lá responde "o que este
 * bloco solta ao quebrar"; esta responde "o que já estava dentro". São duas
 * perguntas diferentes com respostas diferentes para o mesmo baú.
 */
export function rollChestLoot(
  seed: number, x: number, y: number, z: number, table: string,
  give: (item: string, count: number) => void,
): void {
  const rolls = CHEST_LOOT[table];
  if (rolls === undefined) return;
  for (let i = 0; i < rolls.length; i++) {
    const roll = rolls[i];
    const chance = hash3(seed, x, y, z, SALT_LOOT + i) / 4294967296;
    if (chance >= roll.chance) continue;
    const spread = hash3(seed, x, y, z, SALT_LOOT + 64 + i) / 4294967296;
    const count = roll.count[0] + Math.floor(spread * (roll.count[1] - roll.count[0] + 1));
    if (count > 0) give(roll.item, count);
  }
}
