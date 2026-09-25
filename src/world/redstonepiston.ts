/**
 * Pistão (M7; saiu de `redstone.ts` no M18). Empurra até `PISTON_LIMIT` blocos
 * e, pegajoso, puxa de volta o da ponta.
 */

import { AIR, blockIdOf, defOf, makeState, stateBitsOf } from '../data/blocks';
import { WORLD_HEIGHT } from './chunk';
import {
  DIRS, PISTON_HEAD_ID, PISTON_LIMIT, ROLES, type CircuitWriter,
} from './redstoneroles';

/**
 * **Desvio consciente:** o pistão move os blocos de uma vez, sem os quadros
 * de animação do original. Animar exigiria uma entidade de bloco em
 * movimento, com colisão própria e re-meshing a cada quadro — caro demais
 * para o que o olho ganha num alvo de 30 FPS.
 */
export function applyPiston(
  host: CircuitWriter, x: number, y: number, z: number, state: number, powered: boolean,
): void {
  const bits = stateBitsOf(state);
  const dir = bits & 7;
  const extended = (bits & 8) !== 0;
  if (powered === extended) return;

  if (powered) {
    if (!push(host, x, y, z, dir)) return;
    host.replace(x, y, z, makeState(blockIdOf(state), bits | 8));
    const step = DIRS[dir];
    const head = makeState(
      PISTON_HEAD_ID, dir | (ROLES.sticky[blockIdOf(state)] === 1 ? 8 : 0),
    );
    host.replace(x + step[0], y + step[1], z + step[2], head);
    host.onSound('block/piston', x, y, z);
    return;
  }
  retract(host, x, y, z, state, bits, dir);
}

/** Empurra a coluna à frente. Devolve false se ela não cabe ou não sai. */
function push(host: CircuitWriter, x: number, y: number, z: number, dir: number): boolean {
  const step = DIRS[dir];
  let count = 0;
  let cx = x + step[0];
  let cy = y + step[1];
  let cz = z + step[2];

  while (count <= PISTON_LIMIT) {
    if (cy < 0 || cy >= WORLD_HEIGHT) return false;
    const state = host.world.getBlock(cx, cy, cz);
    const id = blockIdOf(state);
    if (id === AIR || defOf(state).replaceable) break;
    if (ROLES.immovable[id] === 1) return false;
    count++;
    cx += step[0]; cy += step[1]; cz += step[2];
  }
  if (count > PISTON_LIMIT) return false;

  // Move de trás para a frente, senão a coluna se sobrescreve.
  for (let i = count; i >= 1; i--) {
    const fx = x + step[0] * i;
    const fy = y + step[1] * i;
    const fz = z + step[2] * i;
    const moving = host.world.getBlock(fx, fy, fz);
    host.replace(fx + step[0], fy + step[1], fz + step[2], moving);
    host.replace(fx, fy, fz, AIR);
  }
  return true;
}

/** Recolhe: tira o braço e, se for pegajoso, traz o bloco da ponta de volta. */
function retract(
  host: CircuitWriter, x: number, y: number, z: number, state: number, bits: number, dir: number,
): void {
  const step = DIRS[dir];
  const hx = x + step[0];
  const hy = y + step[1];
  const hz = z + step[2];
  if (blockIdOf(host.world.getBlock(hx, hy, hz)) === PISTON_HEAD_ID) {
    host.replace(hx, hy, hz, AIR);
  }
  host.replace(x, y, z, makeState(blockIdOf(state), bits & ~8));

  if (ROLES.sticky[blockIdOf(state)] !== 1) {
    host.onSound('block/piston', x, y, z);
    return;
  }
  const gx = hx + step[0];
  const gy = hy + step[1];
  const gz = hz + step[2];
  const grabbed = host.world.getBlock(gx, gy, gz);
  const grabbedId = blockIdOf(grabbed);
  if (grabbedId !== AIR && ROLES.immovable[grabbedId] !== 1 && !defOf(grabbed).replaceable) {
    host.replace(gx, gy, gz, AIR);
    host.replace(hx, hy, hz, grabbed);
  }
  host.onSound('block/piston', x, y, z);
}
