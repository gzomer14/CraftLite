/**
 * O portal do End (doc 14 — M16): a moldura com os doze olhos, a plataforma
 * de chegada do outro lado e o portal de saída que o dragão abre ao cair.
 *
 * Tudo aqui é função de mundo, como `portal.ts` do Nether: sem sessão, sem
 * render, testável sem GL nem DOM.
 *
 * A moldura é a do gênero: doze blocos em anel em volta de um vão de 3×3, três
 * de cada lado, sem os cantos. Encaixar o olho que falta acende o vão.
 *
 * **Desvio consciente:** o gênero exige que as doze peças olhem para dentro;
 * aqui a direção não conta. A sala da fortaleza já nasce com o anel certo, e
 * um anel montado à mão no criativo com uma peça virada não acenderia sem o
 * jogador saber por quê — o bit de direção ficou só no desenho.
 */

import { AIR, BLOCK_BY_NAME, blockIdOf, defOf, makeState } from '../data/blocks';
import { END_ISLAND_Y, END_SPAWN_Z, endArrivalX, endArrivalY, exitPortalCells } from '../world/gen/end';
import { RING } from '../world/gen/strongholdsites';
import type { World } from '../world/world';

export const FRAME = blockId('end_portal_frame');
export const FRAME_EYE = blockId('end_portal_frame_eye');
export const END_PORTAL = blockId('end_portal');
const OBSIDIAN = blockId('obsidian');
const DRAGON_EGG = blockId('dragon_egg');

function blockId(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco do portal do End ausente: ${name}`);
  return def.id;
}

/** Quem é avisado de cada bloco trocado (luz, fluidos). */
export type BlockChanged = (x: number, y: number, z: number, previous: number, state: number) => void;

export { RING };

/** true se o bloco é a moldura, com ou sem olho. */
export function isFrame(state: number): boolean {
  const id = blockIdOf(state);
  return id === FRAME || id === FRAME_EYE;
}

/** true se o bloco é o portal do End (o de ida ou o de saída — é o mesmo). */
export function isEndPortal(state: number): boolean {
  return blockIdOf(state) === END_PORTAL;
}

/**
 * Encaixa o olho na moldura em `(x, y, z)`. Devolve `'none'` se ali não é
 * moldura vazia, `'eye'` se o olho entrou e `'lit'` se ele fechou o anel e o
 * portal acendeu.
 */
export function insertEye(
  world: World, x: number, y: number, z: number, changed: BlockChanged,
): 'none' | 'eye' | 'lit' {
  const previous = world.getBlock(x, y, z);
  if (blockIdOf(previous) !== FRAME) return 'none';
  // O bit de direção vai junto: o desenho da moldura com olho olha igual.
  const next = makeState(FRAME_EYE, previous >>> 10);
  if (!world.setBlock(x, y, z, next, 'player')) return 'none';
  changed(x, y, z, previous, next);
  return lightRingAround(world, x, y, z, changed) ? 'lit' : 'eye';
}

/**
 * Procura, em volta da moldura `(x, y, z)`, um anel de doze molduras com olho
 * e acende o vão dele. Devolve true se acendeu.
 */
export function lightRingAround(
  world: World, x: number, y: number, z: number, changed: BlockChanged,
): boolean {
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = x + dx;
      const cz = z + dz;
      if (!ringComplete(world, cx, y, cz)) continue;
      fillPortal(world, cx, y, cz, changed);
      return true;
    }
  }
  return false;
}

/** true se as doze posições do anel centrado em `(cx, cz)` têm olho. */
export function ringComplete(world: World, cx: number, y: number, cz: number): boolean {
  for (const [dx, dz] of RING) {
    if (blockIdOf(world.getBlock(cx + dx, y, cz + dz)) !== FRAME_EYE) return false;
  }
  return true;
}

/** Acende o vão 3×3 no centro do anel. Só troca o que estiver vazio. */
function fillPortal(world: World, cx: number, y: number, cz: number, changed: BlockChanged): void {
  const portal = makeState(END_PORTAL);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const previous = world.getBlock(cx + dx, y, cz + dz);
      if (blockIdOf(previous) !== AIR && !defOf(previous).replaceable) continue;
      if (world.setBlock(cx + dx, y, cz + dz, portal, 'player')) {
        changed(cx + dx, y, cz + dz, previous, portal);
      }
    }
  }
}

/**
 * A plataforma de obsidiana da chegada no End, com o ar limpo em cima: é o
 * pé firme que o jogador tem na frente da ilha. Devolve onde ele fica em pé.
 */
export function buildEndPlatform(world: World, changed: BlockChanged): { x: number; y: number; z: number } {
  const spawnY = endArrivalY(world.seed);
  const floor = spawnY - 1;
  const spawnX = endArrivalX(world.seed);
  const obsidian = makeState(OBSIDIAN);
  const air = makeState(AIR);
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = spawnX + dx;
      const z = END_SPAWN_Z + dz;
      set(world, x, floor, z, obsidian, changed);
      for (let dy = 1; dy <= 3; dy++) set(world, x, floor + dy, z, air, changed);
    }
  }
  return { x: spawnX + 0.5, y: spawnY, z: END_SPAWN_Z + 0.5 };
}

/**
 * O dragão caiu: acende o portal de saída na bacia do centro e põe o ovo em
 * cima da coluna. Idempotente — chamar de novo não muda nada.
 */
export function openExitPortal(world: World, changed: BlockChanged): void {
  const portal = makeState(END_PORTAL);
  for (const [x, z] of exitPortalCells()) set(world, x, END_ISLAND_Y + 1, z, portal, changed);
  const egg = END_ISLAND_Y + 5;
  if (blockIdOf(world.getBlock(0, egg, 0)) === AIR) set(world, 0, egg, 0, makeState(DRAGON_EGG), changed);
}

/** true se o portal de saída já está aceso (a primeira célula basta). */
export function exitPortalOpen(world: World): boolean {
  const [x, z] = exitPortalCells()[0];
  return isEndPortal(world.getBlock(x, END_ISLAND_Y + 1, z));
}

function set(world: World, x: number, y: number, z: number, state: number, changed: BlockChanged): void {
  const previous = world.getBlock(x, y, z);
  if (previous === state) return;
  if (world.setBlock(x, y, z, state, 'physics')) changed(x, y, z, previous, state);
}
