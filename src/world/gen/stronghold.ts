/**
 * A fortaleza da superfície (doc 14 — M16): a sala do portal do End, debaixo
 * da terra, com a biblioteca e os depósitos em volta.
 *
 * As três ficam onde `strongholdsites.ts` diz. A planta, com a origem no
 * centro da sala do portal e o piso em `STRONGHOLD_FLOOR_Y`:
 *
 * ```
 *                ┌──────────────┐
 *                │  biblioteca  │   z −40..−25
 *                └──────┬───────┘
 *                       │ corredor, com o poço para a superfície em z −12
 *  ┌───────┐   ┌────────┴────────┐   ┌───────┐
 *  │depósito├──┤ sala do portal  ├──┤depósito│   z −8..8
 *  └───────┘   └─────────────────┘   └───────┘
 * ```
 *
 * - **A sala do portal**: plataforma de pedra com o degrau na frente, o anel
 *   de doze molduras em volta de um vão sobre a lava, e cada moldura com um
 *   olho já encaixado uma vez em dez — o gênero, e o que faz a conta de olhos
 *   variar de mundo para mundo.
 * - **O poço**: tubo de tijolo com escada de mão do corredor até a superfície,
 *   onde termina num anel de pedra com uma pedra luminosa — o olho do ender
 *   mergulha a menos de 16 blocos dele. **Desvio consciente:** o gênero não
 *   tem entrada, e o jogador cava; no celular, cavar 50 blocos na vertical
 *   procurando uma sala que pode estar 20 blocos para o lado é o tipo de
 *   frustração que faz desistir, não explorar.
 * - **A biblioteca** e os **depósitos**, com baú: livros e mapas numa, pão,
 *   ferro e as pérolas do ender que faltam nos outros.
 *
 * Como a fortaleza do Nether, é um `StructureDef` montado em código, e o
 * `stamp` escreve só a fatia de cada chunk.
 */

import type { Piece, StructureDef } from '../../data/structures';
import { SEA_LEVEL, SECTION_SIZE, WORLD_HEIGHT, type ChunkColumn } from '../chunk';
import { RING, STRONGHOLD_COUNT, STRONGHOLD_FLOOR_Y, strongholdSites } from './strongholdsites';
import { stamp } from './structures';
import type { HeightField } from './heightfield';

/** Chance de uma moldura já nascer com o olho. */
const EYE_CHANCE = 0.1;
/** Centro do vão do portal, relativo à origem. */
export const PORTAL_CENTER: readonly [number, number, number] = [0, 3, 3];
/** O poço para a superfície, relativo à origem. */
export const SHAFT: readonly [number, number] = [0, -12];
/** Caixa em volta da planta (sem o poço), para o chunk saber se é tocado. */
const REACH_X = 26;
const REACH_Z_MIN = -41;
const REACH_Z_MAX = 9;

const TORCH_FLOOR = 4;
/** Escada de mão presa na parede −Z (`mounted` em `mesh/shapes.ts`). */
const LADDER_ON_NORTH_WALL = 3;

function piece(
  kind: Piece['kind'], block: string, box: readonly [number, number, number, number, number, number],
  extra: Partial<Piece> = {},
): Piece {
  return { kind, block, box, replace: 'any', ...extra };
}

/** Tijolo com musgo aqui e ali, como pedra velha. */
const WALL = { alt: 'mossy_cobblestone', altChance: 0.15 } as const;

/** A planta da fortaleza, com o topo do poço em `shaftTop` (relativo ao piso). */
export function strongholdDef(shaftTop: number): StructureDef {
  const pieces: Piece[] = [];
  const chests: { at: readonly [number, number, number]; loot: string }[] = [];

  // --- sala do portal ---------------------------------------------------------
  pieces.push(piece('hollow', 'stone_bricks', [-5, 0, -8, 5, 8, 8], WALL));
  pieces.push(piece('fill', 'air', [-4, 1, -7, 4, 7, 7]));
  pieces.push(piece('fill', 'stone_bricks', [-3, 1, -1, 3, 2, 6]));
  pieces.push(piece('fill', 'stone_bricks', [-1, 1, -3, 1, 1, -2]));
  const [px, py, pz] = PORTAL_CENTER;
  pieces.push(piece('fill', 'lava', [px - 1, py - 2, pz - 1, px + 1, py - 1, pz + 1]));
  pieces.push(piece('fill', 'air', [px - 1, py, pz - 1, px + 1, py + 1, pz + 1]));
  for (const [dx, dz] of RING) {
    const x = px + dx;
    const z = pz + dz;
    pieces.push(piece('fill', 'end_portal_frame', [x, py, z, x, py, z],
      { alt: 'end_portal_frame_eye', altChance: EYE_CHANCE }));
  }
  for (const [x, y, z] of [[-3, 3, -1], [3, 3, -1], [-3, 3, 6], [3, 3, 6],
    [-4, 1, -7], [4, 1, -7], [-4, 1, 7], [4, 1, 7]] as const) {
    pieces.push(piece('point', 'torch', [x, y, z, x, y, z], { state: TORCH_FLOOR }));
  }
  // Portas: norte para o corredor, leste e oeste para os depósitos.
  pieces.push(piece('fill', 'air', [-1, 1, -8, 1, 3, -8]));
  pieces.push(piece('fill', 'air', [5, 1, -1, 5, 3, 1]));
  pieces.push(piece('fill', 'air', [-5, 1, -1, -5, 3, 1]));

  // --- corredor norte e o poço ----------------------------------------------------
  pieces.push(piece('hollow', 'stone_bricks', [-2, 0, -25, 2, 5, -9], WALL));
  pieces.push(piece('fill', 'air', [-1, 1, -25, 1, 4, -9]));
  for (let z = -22; z <= -10; z += 6) pieces.push(piece('point', 'glowstone', [0, 5, z, 0, 5, z]));
  const [sx, sz] = SHAFT;
  pieces.push(piece('walls', 'stone_bricks', [sx - 1, 5, sz - 1, sx + 1, shaftTop - 1, sz + 1]));
  pieces.push(piece('fill', 'ladder', [sx, 1, sz, sx, shaftTop, sz], { state: LADDER_ON_NORTH_WALL }));
  // A escada precisa da parede atrás dela também dentro do corredor.
  pieces.push(piece('fill', 'stone_bricks', [sx, 1, sz - 1, sx, 4, sz - 1]));
  // O anel da boca do poço, na superfície, com uma saída e uma luz.
  pieces.push(piece('walls', 'stone_bricks', [sx - 2, shaftTop, sz - 2, sx + 2, shaftTop + 1, sz + 2]));
  pieces.push(piece('fill', 'air', [sx - 1, shaftTop, sz - 1, sx + 1, shaftTop + 3, sz + 1]));
  pieces.push(piece('fill', 'ladder', [sx, shaftTop, sz, sx, shaftTop, sz], { state: LADDER_ON_NORTH_WALL }));
  pieces.push(piece('fill', 'stone_bricks', [sx, shaftTop, sz - 1, sx, shaftTop, sz - 1]));
  pieces.push(piece('fill', 'air', [sx - 2, shaftTop, sz, sx - 2, shaftTop + 1, sz]));
  pieces.push(piece('point', 'glowstone', [sx + 2, shaftTop + 1, sz - 2, sx + 2, shaftTop + 1, sz - 2]));

  // --- biblioteca -----------------------------------------------------------------
  pieces.push(piece('hollow', 'stone_bricks', [-7, 0, -41, 7, 9, -26], WALL));
  pieces.push(piece('fill', 'air', [-6, 1, -40, 6, 8, -27]));
  pieces.push(piece('walls', 'bookshelf', [-6, 1, -40, 6, 4, -27]));
  for (const z of [-36, -31]) {
    pieces.push(piece('fill', 'bookshelf', [-4, 1, z, -2, 3, z]));
    pieces.push(piece('fill', 'bookshelf', [2, 1, z, 4, 3, z]));
  }
  pieces.push(piece('fill', 'air', [-1, 1, -27, 1, 3, -26]));
  for (const [x, y, z] of [[-5, 7, -39], [5, 7, -28], [0, 8, -34], [-5, 5, -29]] as const) {
    pieces.push(piece('point', 'cobweb', [x, y, z, x, y, z]));
  }
  pieces.push(piece('point', 'glowstone', [-3, 9, -33, -3, 9, -33]));
  pieces.push(piece('point', 'glowstone', [3, 9, -33, 3, 9, -33]));
  chests.push({ at: [0, 1, -39], loot: 'stronghold_library' });

  // --- depósitos, leste e oeste -------------------------------------------------
  for (const side of [1, -1]) {
    const a = 6 * side;
    const b = 16 * side;
    pieces.push(piece('hollow', 'stone_bricks', box(a, 0, -2, b, 5, 2), WALL));
    pieces.push(piece('fill', 'air', box(a, 1, -1, b, 4, 1)));
    pieces.push(piece('point', 'glowstone', [11 * side, 5, 0, 11 * side, 5, 0]));
    pieces.push(piece('hollow', 'stone_bricks', box(17 * side, 0, -5, 25 * side, 6, 5), WALL));
    pieces.push(piece('fill', 'air', box(18 * side, 1, -4, 24 * side, 5, 4)));
    pieces.push(piece('fill', 'air', box(17 * side, 1, -1, 17 * side, 3, 1)));
    pieces.push(piece('point', 'glowstone', [21 * side, 6, 0, 21 * side, 6, 0]));
    pieces.push(piece('point', 'cobweb', [24 * side, 5, 4, 24 * side, 5, 4]));
    chests.push({ at: [23 * side, 1, 0], loot: 'stronghold_corridor' });
    chests.push({ at: [23 * side, 1, -3], loot: 'stronghold_corridor' });
  }

  return {
    name: 'stronghold',
    size: [2 * REACH_X + 1, WORLD_HEIGHT, REACH_Z_MAX - REACH_Z_MIN + 1],
    pieces,
    chests,
    placement: { attempts: 0, minY: 0, maxY: 0, surface: false },
  };
}

/** Caixa com os cantos em qualquer ordem. */
function box(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): readonly [number, number, number, number, number, number] {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
}

/** Topo do poço relativo ao piso: um acima do chão, nunca debaixo d'água. */
export function shaftTopFor(field: HeightField, x: number, z: number): number {
  const ground = Math.max(field.heightAt(x, z), SEA_LEVEL);
  return Math.min(WORLD_HEIGHT - 4, ground + 1) - STRONGHOLD_FLOOR_Y;
}

/** Cache por seed: três plantas por mundo, e cada uma é pedida por ~20 chunks. */
let cachedSeed = -1;
let cachedSites: Int32Array | null = null;
const cachedDefs: (StructureDef | null)[] = [];

/** Escreve no chunk a fatia das fortalezas que o alcançam. */
export function placeStrongholds(chunk: ChunkColumn, seed: number, field: HeightField): void {
  if (cachedSites === null || cachedSeed !== seed) {
    cachedSeed = seed;
    cachedSites = strongholdSites(seed);
    cachedDefs.length = 0;
    for (let i = 0; i < STRONGHOLD_COUNT; i++) cachedDefs.push(null);
  }
  const x0 = chunk.cx * SECTION_SIZE;
  const z0 = chunk.cz * SECTION_SIZE;
  for (let i = 0; i < STRONGHOLD_COUNT; i++) {
    const ox = cachedSites[i * 2];
    const oz = cachedSites[i * 2 + 1];
    if (x0 + SECTION_SIZE <= ox - REACH_X || x0 > ox + REACH_X) continue;
    if (z0 + SECTION_SIZE <= oz + REACH_Z_MIN || z0 > oz + REACH_Z_MAX) continue;
    let def = cachedDefs[i];
    if (def === null) {
      def = strongholdDef(shaftTopFor(field, ox + SHAFT[0], oz + SHAFT[1]));
      cachedDefs[i] = def;
    }
    stamp(chunk, seed, def, ox, STRONGHOLD_FLOOR_Y, oz);
  }
}
