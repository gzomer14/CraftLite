/**
 * Plano da aldeia (doc 03 §7, M9): onde fica o poço, quais chunks do raio têm
 * casa, de que ofício, se alguém mora nela, e os caminhos que ligam tudo.
 *
 * **Duas partes, e a divisão importa.** O plano puro (`villageAnchorOf`,
 * `houseSlot`, `wellOrigin`) sai só da seed e das coordenadas do chunk: é o
 * mesmo no worker, que gera, e na thread principal, que põe os moradores
 * (`game/village.ts`) — ela não tem o campo de ruído para perguntar a altura,
 * e por isso acha a casa procurando a cama na coluna. A outra parte
 * (`placeVillage`, `placeVillagePaths`) escreve voxels e usa o campo: bioma e
 * altura decidem se a casa de fato nasceu.
 *
 * Os sais e os sorteios de poço e casa são os mesmos de antes do M9: as aldeias
 * continuam onde estavam nos mundos já criados.
 */

import { BLOCK_BY_NAME, AIR, defOf, makeState } from '../../data/blocks';
import { BIOMES } from '../../data/biomes';
import { PROFESSIONS } from '../../data/villagers';
import {
  VILLAGERS_PER_VILLAGE, VILLAGE_HOUSES, VILLAGE_RADIUS, VILLAGE_REGION, structureByName,
  type StructureDef,
} from '../../data/structures';
import { hash2 } from '../../core/rng';
import { SEA_LEVEL, SECTION_SIZE, type ChunkColumn } from '../chunk';
import type { HeightField } from './heightfield';

const SALT_VILLAGE = 41;
/** Ofício da casa. */
const SALT_PROFESSION = 47;
/** Casa com morador. */
const SALT_OCCUPANT = 48;

/** O que o plano diz de um chunk com casa. */
export interface HouseSlot {
  /** Origem da casa, em coordenadas de mundo (o Y vem do terreno). */
  ox: number;
  oz: number;
  profession: number;
  occupied: boolean;
  /** Chunk do poço desta aldeia. */
  anchorX: number;
  anchorZ: number;
}

/** Chunk do poço da região de aldeia que contém `(cx, cz)`. */
export function villageAnchorOf(seed: number, cx: number, cz: number, out: Int32Array): void {
  const regionX = Math.floor(cx / VILLAGE_REGION);
  const regionZ = Math.floor(cz / VILLAGE_REGION);
  const pick = hash2(seed, regionX, regionZ, SALT_VILLAGE);
  out[0] = regionX * VILLAGE_REGION + (pick % VILLAGE_REGION);
  out[1] = regionZ * VILLAGE_REGION + ((pick >>> 8) % VILLAGE_REGION);
}

/** Origem do poço (ou da casa) sorteada dentro do chunk. */
export function slotOrigin(seed: number, cx: number, cz: number, out: Int32Array): void {
  const offset = hash2(seed, cx, cz, SALT_VILLAGE + 2);
  out[0] = cx * SECTION_SIZE + 2 + (offset & 7);
  out[1] = cz * SECTION_SIZE + 2 + ((offset >>> 3) & 7);
}

const ANCHOR = new Int32Array(2);
const ORIGIN = new Int32Array(2);

/** true se `(cx, cz)` é o chunk do poço da sua aldeia. */
export function isVillageAnchor(seed: number, cx: number, cz: number): boolean {
  villageAnchorOf(seed, cx, cz, ANCHOR);
  return ANCHOR[0] === cx && ANCHOR[1] === cz;
}

/**
 * A casa planejada para o chunk, se houver. Não sabe se ela nasceu: isso
 * depende do bioma e da altura, que só o gerador conhece.
 */
export function houseSlot(seed: number, cx: number, cz: number, out: HouseSlot): boolean {
  villageAnchorOf(seed, cx, cz, ANCHOR);
  const distX = Math.abs(cx - ANCHOR[0]);
  const distZ = Math.abs(cz - ANCHOR[1]);
  if (distX > VILLAGE_RADIUS || distZ > VILLAGE_RADIUS) return false;
  if (distX === 0 && distZ === 0) return false;
  if (!plannedHouse(seed, cx, cz)) return false;

  slotOrigin(seed, cx, cz, ORIGIN);
  out.ox = ORIGIN[0];
  out.oz = ORIGIN[1];
  out.profession = hash2(seed, cx, cz, SALT_PROFESSION) % PROFESSIONS.length;
  out.anchorX = ANCHOR[0];
  out.anchorZ = ANCHOR[1];
  out.occupied = occupantRank(seed, cx, cz, ANCHOR[0], ANCHOR[1]) < villagersOf(seed, ANCHOR[0], ANCHOR[1]);
  return true;
}

/**
 * Nem todo chunk do raio ganha casa: aldeia com casa em todo lugar vira
 * quarteirão, não vilarejo. É o mesmo sorteio de antes do M9.
 */
function plannedHouse(seed: number, cx: number, cz: number): boolean {
  return hash2(seed, cx, cz, SALT_VILLAGE + 1) / 4294967296 <= 0.55;
}

/** Quantos aldeões a aldeia do poço `(ax, az)` tem: 3 a 8, doc 03 §7. */
function villagersOf(seed: number, ax: number, az: number): number {
  const [min, max] = VILLAGERS_PER_VILLAGE;
  return min + (hash2(seed, ax, az, SALT_OCCUPANT + 1) % (max - min + 1));
}

/**
 * Posição da casa `(cx, cz)` na fila de moradores da aldeia: quantas casas
 * planejadas têm sorteio menor que o dela. As N primeiras têm morador.
 */
function occupantRank(seed: number, cx: number, cz: number, ax: number, az: number): number {
  const mine = hash2(seed, cx, cz, SALT_OCCUPANT);
  let rank = 0;
  for (let dz = -VILLAGE_RADIUS; dz <= VILLAGE_RADIUS; dz++) {
    for (let dx = -VILLAGE_RADIUS; dx <= VILLAGE_RADIUS; dx++) {
      const hx = ax + dx;
      const hz = az + dz;
      if ((dx === 0 && dz === 0) || (hx === cx && hz === cz) || !plannedHouse(seed, hx, hz)) continue;
      if (hash2(seed, hx, hz, SALT_OCCUPANT) < mine) rank++;
    }
  }
  return rank;
}

// --- escrita (worker) ---------------------------------------------------------

let pathBlock = -1;
let wellDef: StructureDef | undefined;

function biomeAllows(def: StructureDef, field: HeightField, ox: number, oz: number): boolean {
  const allowed = def.placement.biomes;
  if (allowed === undefined || allowed.length === 0) return true;
  return allowed.indexOf(BIOMES[field.sample(ox, oz).biome].name) >= 0;
}

/** Altura do piso de uma peça de aldeia em `(ox, oz)`, ou −1 se não se constrói ali. */
function floorAt(def: StructureDef, field: HeightField, ox: number, oz: number): number {
  if (!biomeAllows(def, field, ox, oz)) return -1;
  const height = field.heightAt(ox, oz);
  if (height < 62) return -1;
  return height + 1;
}

const SLOT: HouseSlot = { ox: 0, oz: 0, profession: 0, occupied: false, anchorX: 0, anchorZ: 0 };

/**
 * A peça de aldeia que nasce no chunk de origem `(ocx, ocz)`: o poço, se ele
 * for a âncora, ou a casa do ofício sorteado.
 */
export function placeVillage(
  seed: number, field: HeightField, ocx: number, ocz: number,
  stamp: (def: StructureDef, ox: number, oy: number, oz: number) => void,
): void {
  if (isVillageAnchor(seed, ocx, ocz)) {
    wellDef ??= structureByName('village_well');
    if (wellDef === undefined) return;
    slotOrigin(seed, ocx, ocz, ORIGIN);
    const oy = floorAt(wellDef, field, ORIGIN[0], ORIGIN[1]);
    if (oy >= 0) stamp(wellDef, ORIGIN[0], oy, ORIGIN[1]);
    return;
  }
  if (!houseSlot(seed, ocx, ocz, SLOT)) return;
  const def = VILLAGE_HOUSES[SLOT.profession].structure;
  const oy = floorAt(def, field, SLOT.ox, SLOT.oz);
  if (oy >= 0) stamp(def, SLOT.ox, oy, SLOT.oz);
}

/**
 * Caminhos de terra batida da frente de cada casa até o poço (M9).
 *
 * Cada chunk da aldeia escreve só os trechos que caem dentro dele, e escreve
 * **antes** das casas: onde um caminho passa por baixo de uma casa vizinha, a
 * casa vence. Toda porta dá para −Z, então o caminho sai da frente da casa,
 * anda em X até um corredor, desce em Z até o anel do poço e fecha no anel.
 * Se o corredor cairia por dentro da própria casa (casa ao norte do poço, de
 * costas para ele), ele passa pelo lado dela. Tudo no nível do terreno: cada
 * bloco é o chão trocado por caminho, e planta rasteira em cima dele sai.
 */
export function placeVillagePaths(chunk: ChunkColumn, seed: number, field: HeightField): void {
  villageAnchorOf(seed, chunk.cx, chunk.cz, ANCHOR);
  const ax = ANCHOR[0];
  const az = ANCHOR[1];
  // Longe demais de qualquer casa: nada a fazer aqui.
  if (Math.abs(chunk.cx - ax) > VILLAGE_RADIUS + 1 || Math.abs(chunk.cz - az) > VILLAGE_RADIUS + 1) return;
  wellDef ??= structureByName('village_well');
  if (wellDef === undefined) return;
  slotOrigin(seed, ax, az, ORIGIN);
  const wellX = ORIGIN[0];
  const wellZ = ORIGIN[1];
  if (floorAt(wellDef, field, wellX, wellZ) < 0) return; // sem poço, sem aldeia
  if (pathBlock < 0) pathBlock = BLOCK_BY_NAME.get('dirt_path')?.id ?? AIR;

  // Anel em volta do poço.
  for (let d = -1; d <= 5; d++) {
    pathAt(chunk, field, wellX + d, wellZ - 1);
    pathAt(chunk, field, wellX + d, wellZ + 5);
    pathAt(chunk, field, wellX - 1, wellZ + d);
    pathAt(chunk, field, wellX + 5, wellZ + d);
  }

  for (let dz = -VILLAGE_RADIUS; dz <= VILLAGE_RADIUS; dz++) {
    for (let dx = -VILLAGE_RADIUS; dx <= VILLAGE_RADIUS; dx++) {
      if (!houseSlot(seed, ax + dx, az + dz, SLOT)) continue;
      const def = VILLAGE_HOUSES[SLOT.profession].structure;
      if (floorAt(def, field, SLOT.ox, SLOT.oz) < 0) continue;
      const startX = SLOT.ox + 3;
      const startZ = SLOT.oz - 4;
      const ringX = clamp(startX, wellX - 1, wellX + 5);
      let corridor = ringX;
      // De costas para o poço: o corredor contorna a casa pelo lado mais perto.
      if (startZ < wellZ - 1 && corridor >= SLOT.ox - 1 && corridor <= SLOT.ox + 7) {
        corridor = wellX + 2 <= SLOT.ox + 3 ? SLOT.ox - 2 : SLOT.ox + 8;
      }
      const endZ = startZ < wellZ ? wellZ - 1 : wellZ + 5;
      pathLine(chunk, field, startX, startZ, corridor, startZ);
      pathLine(chunk, field, corridor, startZ, corridor, endZ);
      pathLine(chunk, field, corridor, endZ, clamp(corridor, wellX - 1, wellX + 5), endZ);
    }
  }
}

/** Uma linha reta de caminho (horizontal ou vertical no mapa), recortada ao chunk. */
function pathLine(
  chunk: ChunkColumn, field: HeightField, x0: number, z0: number, x1: number, z1: number,
): void {
  const baseX = chunk.cx * SECTION_SIZE;
  const baseZ = chunk.cz * SECTION_SIZE;
  const minX = Math.max(Math.min(x0, x1), baseX);
  const maxX = Math.min(Math.max(x0, x1), baseX + SECTION_SIZE - 1);
  const minZ = Math.max(Math.min(z0, z1), baseZ);
  const maxZ = Math.min(Math.max(z0, z1), baseZ + SECTION_SIZE - 1);
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) pathAt(chunk, field, x, z);
  }
}

/** Troca o chão de `(x, z)` por caminho, se estiver no chunk e for chão de verdade. */
function pathAt(chunk: ChunkColumn, field: HeightField, x: number, z: number): void {
  const lx = x - chunk.cx * SECTION_SIZE;
  const lz = z - chunk.cz * SECTION_SIZE;
  if (lx < 0 || lx >= SECTION_SIZE || lz < 0 || lz >= SECTION_SIZE) return;
  const y = field.heightAt(x, z);
  if (y <= SEA_LEVEL || y < 1) return; // água não vira caminho
  const ground = defOf(chunk.getBlock(lx, y, lz));
  if (!ground.solid || ground.name === 'water') return;
  chunk.setBlock(lx, y, lz, makeState(pathBlock));
  // Flor e capim em cima do caminho saem; tronco de árvore fica.
  const above = defOf(chunk.getBlock(lx, y + 1, lz));
  if (above.shape === 'cross') chunk.setBlock(lx, y + 1, lz, AIR);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
