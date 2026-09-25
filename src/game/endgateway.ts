/**
 * O portal de passagem do End (M19): o caminho da ilha principal às ilhas de
 * fora, que aparece quando o dragão cai.
 *
 * É uma coluna de dois blocos de portal em pé, com rocha-mãe em cima e
 * embaixo — entra-se andando, como no portal do Nether, e leva na hora, como
 * o do End. O da ilha principal fica a oeste (`GATEWAY_X`), longe da chegada;
 * ao atravessar, nasce outro na ilha de destino, e ele traz de volta.
 *
 * **Desvio consciente:** no gênero o portal de passagem flutua e se entra
 * nele com uma pérola. Aqui fica no chão: no celular, acertar uma pérola num
 * bloco suspenso é o tipo de passo em que o jogador desiste.
 */

import { AIR, BEDROCK, BLOCK_BY_NAME, blockIdOf, makeState } from '../data/blocks';
import { END_ISLAND_Y, GATEWAY_X, GATEWAY_Z, gatewayTarget } from '../world/gen/end';
import { WORLD_HEIGHT } from '../world/chunk';
import type { BlockChanged } from './endportal';
import type { World } from '../world/world';

export const END_GATEWAY = BLOCK_BY_NAME.get('end_gateway')?.id ?? -1;
const OBSIDIAN = BLOCK_BY_NAME.get('obsidian')?.id ?? -1;
/** Onde, em relação ao centro da ilha de fora, nasce o portal de volta. */
const RETURN_OFFSET = 7;
/** Quem chega fica a dois blocos do portal, e não dentro dele. */
const ARRIVAL_OFFSET = 2;

export function isGateway(state: number): boolean {
  return blockIdOf(state) === END_GATEWAY;
}

/** Topo sólido da coluna, ou −1 (vazio, ou coluna não carregada). */
function surfaceAt(world: World, x: number, z: number): number {
  const chunk = world.getChunk(x >> 4, z >> 4);
  if (chunk === undefined) return -1;
  const height = chunk.heightMap[((z & 15) << 4) | (x & 15)];
  return height > 0 ? height : -1;
}

function set(world: World, x: number, y: number, z: number, state: number, changed: BlockChanged): void {
  const previous = world.getBlock(x, y, z);
  if (previous === state) return;
  if (world.setBlock(x, y, z, state, 'physics')) changed(x, y, z, previous, state);
}

/**
 * A coluna do portal sobre o chão `floor`: rocha-mãe embaixo e em cima, dois
 * de portal no meio, e ar dos lados para se chegar andando.
 */
function buildColumn(world: World, x: number, floor: number, z: number, changed: BlockChanged): void {
  const gateway = makeState(END_GATEWAY);
  const bedrock = makeState(BEDROCK);
  set(world, x, floor, z, bedrock, changed);
  set(world, x, floor + 1, z, gateway, changed);
  set(world, x, floor + 2, z, gateway, changed);
  set(world, x, floor + 3, z, bedrock, changed);
}

/** true se o portal da ilha principal já está de pé. */
export function mainGatewayOpen(world: World): boolean {
  const floor = surfaceAt(world, GATEWAY_X, GATEWAY_Z);
  for (let y = Math.max(1, floor - 3); y <= Math.min(WORLD_HEIGHT - 1, floor + 3); y++) {
    if (isGateway(world.getBlock(GATEWAY_X, y, GATEWAY_Z))) return true;
  }
  return false;
}

/** O dragão caiu: ergue o portal de passagem na ilha principal. Idempotente. */
export function openMainGateway(world: World, changed: BlockChanged): void {
  if (!world.isLoaded(GATEWAY_X, GATEWAY_Z) || mainGatewayOpen(world)) return;
  const floor = surfaceAt(world, GATEWAY_X, GATEWAY_Z);
  buildColumn(world, GATEWAY_X, floor > 0 ? floor : END_ISLAND_Y, GATEWAY_Z, changed);
}

/** Para onde a travessia leva: `[x, z]`, a coluna da chegada (M19). */
export function gatewayDestination(world: World, fromX: number, out: Int32Array): void {
  // Da ilha principal (a oeste do centro, perto dele) vai-se para fora; de
  // fora, volta-se para o lado do portal principal.
  if (Math.abs(fromX) < 400) {
    gatewayTarget(world.seed, out);
    out[0] += RETURN_OFFSET + ARRIVAL_OFFSET;
  } else {
    out[0] = GATEWAY_X + ARRIVAL_OFFSET;
    out[1] = GATEWAY_Z;
  }
}

/**
 * Chegada, com o chunk de destino carregado: o chão onde pôr o jogador e, do
 * lado de fora, o portal de volta. Numa coluna de vazio (ilha menor que o
 * esperado), uma plataforma de obsidiana segura quem chega.
 */
export function gatewayArrival(
  world: World, x: number, z: number, changed: BlockChanged,
): { x: number; y: number; z: number } {
  let floor = surfaceAt(world, x, z);
  if (floor < 0) {
    floor = END_ISLAND_Y;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -3; dx <= 2; dx++) set(world, x + dx, floor, z + dz, makeState(OBSIDIAN), changed);
    }
  }
  const outside = Math.abs(x) >= 400;
  if (outside) {
    const gx = x - ARRIVAL_OFFSET;
    let gateFloor = surfaceAt(world, gx, z);
    if (gateFloor < 0) gateFloor = floor;
    // Só ergue se ainda não há um: voltar pela segunda vez acha o mesmo.
    if (!isGateway(world.getBlock(gx, gateFloor, z)) && !isGateway(world.getBlock(gx, gateFloor + 1, z))
      && !isGateway(world.getBlock(gx, gateFloor - 2, z))) {
      buildColumn(world, gx, gateFloor, z, changed);
    }
  }
  // Dois blocos de ar sobre o chão, para ninguém chegar dentro da pedra.
  const air = makeState(AIR);
  set(world, x, floor + 1, z, air, changed);
  set(world, x, floor + 2, z, air, changed);
  return { x: x + 0.5, y: floor + 1, z: z + 0.5 };
}
