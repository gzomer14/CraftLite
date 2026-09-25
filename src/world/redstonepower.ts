/**
 * As contas de energia do circuito (M7; saíram de `redstone.ts` no M18): quanto
 * um bloco entrega ao vizinho, o que o pó deveria ter, a energia forte e fraca
 * num bloco sólido, e se um mecanismo está ligado.
 *
 * Só **leem** o mundo — quem escreve é a classe `Redstone` —, por isso são
 * funções soltas: dá para testar e chamar sem fila nem agenda.
 */

import { blockIdOf, stateBitsOf } from '../data/blocks';
import { comparatorPower } from './redstoneparts';
import {
  ACTIVE_BIT, DIRS, KIND_BUTTON, KIND_COMPARATOR, KIND_DETECTOR, KIND_LEVER, KIND_OBSERVER,
  KIND_PLATE, KIND_REPEATER, KIND_SOURCE, KIND_TORCH, KIND_WIRE, MAX_POWER, RAIL_POWERED_BIT,
  ROLES, mountIndexOf, opposite,
} from './redstoneroles';

/** O que as contas precisam do mundo. */
export interface BlockReader {
  getBlock(x: number, y: number, z: number): number;
}

/** Energia que este pó deveria ter, dado o que o cerca. */
export function wirePowerAt(world: BlockReader, x: number, y: number, z: number): number {
  let best = 0;
  for (let d = 0; d < 6; d++) {
    const step = DIRS[d];
    const nx = x + step[0];
    const ny = y + step[1];
    const nz = z + step[2];
    const nState = world.getBlock(nx, ny, nz);
    const nId = blockIdOf(nState);
    const nKind = ROLES.kind[nId];

    if (nKind === KIND_WIRE) {
      best = Math.max(best, (stateBitsOf(nState) & 0xf) - 1);
      continue;
    }
    // Emissor encostado: entrega direto, sem perda.
    best = Math.max(best, emitted(nState, nId, opposite(d)));
    // Bloco sólido com energia **forte** realimenta o fio com 15.
    if (ROLES.conductive[nId] === 1 && strongInto(world, nx, ny, nz) > 0) best = MAX_POWER;
    if (best >= MAX_POWER) return MAX_POWER;
  }
  // Pó sobe e desce degrau: o vizinho diagonal conta quando não há bloco
  // opaco cortando o caminho.
  best = Math.max(best, stepWire(world, x, y, z, true));
  best = Math.max(best, stepWire(world, x, y, z, false));
  return Math.min(MAX_POWER, Math.max(0, best));
}

/**
 * Melhor vizinho de pó um degrau acima (`up`) ou abaixo.
 *
 * Subir exige que o bloco em cima do pó não seja opaco; descer exige que o
 * bloco sobre o vizinho de baixo também não seja. São as duas regras que
 * fazem um fio acompanhar uma escada sem precisar de bloco de canto.
 */
export function stepWire(world: BlockReader, x: number, y: number, z: number, up: boolean): number {
  if (up && ROLES.conductive[blockIdOf(world.getBlock(x, y + 1, z))] === 1) return 0;
  let best = 0;
  for (let d = 0; d < 4; d++) {
    const step = DIRS[d];
    const nx = x + step[0];
    const nz = z + step[2];
    const ny = up ? y + 1 : y - 1;
    if (!up && ROLES.conductive[blockIdOf(world.getBlock(nx, y, nz))] === 1) continue;
    const state = world.getBlock(nx, ny, nz);
    if (ROLES.kind[blockIdOf(state)] !== KIND_WIRE) continue;
    best = Math.max(best, (stateBitsOf(state) & 0xf) - 1);
  }
  return best;
}

// --- energia entregue por um vizinho ------------------------------------

/**
 * Energia que um bloco entrega ao vizinho na direção `toDir`.
 *
 * É o coração do modelo: cada papel responde uma linha. O pó entrega a energia
 * que tem; alavanca, botão, placa e bloco de redstone entregam 15 para todo
 * lado; a tocha acesa entrega 15 para todo lado **menos** para o próprio
 * apoio; o repetidor só entrega para a frente.
 */
export function emitted(state: number, id: number, toDir: number): number {
  switch (ROLES.kind[id]) {
    case KIND_WIRE:
      return stateBitsOf(state) & 0xf;
    case KIND_SOURCE:
      return MAX_POWER;
    case KIND_LEVER:
    case KIND_BUTTON:
      return (stateBitsOf(state) & 8) !== 0 ? MAX_POWER : 0;
    case KIND_PLATE:
      return (stateBitsOf(state) & 1) !== 0 ? MAX_POWER : 0;
    case KIND_DETECTOR:
      // Quem liga o bit é o carrinho passando por cima (`entity/minecart.ts`).
      return (stateBitsOf(state) & RAIL_POWERED_BIT) !== 0 ? MAX_POWER : 0;
    case KIND_TORCH:
      // O apoio da tocha fica embaixo; ela não energiza o que a segura.
      if (ROLES.lit[id] === 0) return 0;
      return toDir === 5 ? 0 : MAX_POWER;
    case KIND_REPEATER:
      if ((stateBitsOf(state) & 16) === 0) return 0;
      return toDir === (stateBitsOf(state) & 3) ? MAX_POWER : 0;
    case KIND_COMPARATOR:
      return toDir === (stateBitsOf(state) & 3) ? comparatorPower(state) : 0;
    case KIND_OBSERVER:
      // O pulso sai por trás, o lado oposto à cara.
      if ((stateBitsOf(state) & ACTIVE_BIT) === 0) return 0;
      return toDir === opposite(stateBitsOf(state) & 7) ? MAX_POWER : 0;
    default:
      return 0;
  }
}

/**
 * Energia **forte** que os emissores injetam no bloco em `(x,y,z)`.
 *
 * Só conta quem está encostado por definição: alavanca, botão e placa no
 * bloco que os segura, tocha no bloco de cima, repetidor no bloco da frente.
 */
export function strongInto(world: BlockReader, x: number, y: number, z: number): number {
  let best = 0;
  for (let d = 0; d < 6; d++) {
    const step = DIRS[d];
    const nx = x + step[0];
    const ny = y + step[1];
    const nz = z + step[2];
    const state = world.getBlock(nx, ny, nz);
    const id = blockIdOf(state);
    const kind = ROLES.kind[id];
    const toDir = opposite(d);

    if (kind === KIND_LEVER || kind === KIND_BUTTON) {
      if ((stateBitsOf(state) & 8) === 0) continue;
      if (mountIndexOf(stateBitsOf(state) & 7) === toDir) best = MAX_POWER;
    } else if (kind === KIND_PLATE) {
      if ((stateBitsOf(state) & 1) !== 0 && toDir === 5) best = MAX_POWER;
    } else if (kind === KIND_DETECTOR) {
      // Como a placa: energiza forte o bloco que o segura, que fica embaixo.
      if ((stateBitsOf(state) & RAIL_POWERED_BIT) !== 0 && toDir === 5) best = MAX_POWER;
    } else if (kind === KIND_TORCH) {
      if (ROLES.lit[id] === 1 && toDir === 4) best = MAX_POWER;
    } else if (kind === KIND_REPEATER) {
      if ((stateBitsOf(state) & 16) !== 0 && toDir === (stateBitsOf(state) & 3)) {
        best = MAX_POWER;
      }
    } else if (kind === KIND_COMPARATOR || kind === KIND_OBSERVER) {
      // Como o repetidor: energizam forte o bloco para onde a saída aponta.
      best = Math.max(best, emitted(state, id, toDir));
    }
    if (best >= MAX_POWER) return MAX_POWER;
  }
  return best;
}

/**
 * true se um mecanismo em `(x,y,z)` está energizado.
 *
 * Duas fontes: alguém encostado entregando energia direto, ou um bloco sólido
 * vizinho que esteja energizado — forte ou fraco. É a energia fraca por bloco
 * que faz o pó correndo por cima da parede abrir a porta do outro lado.
 */
export function poweredAt(world: BlockReader, x: number, y: number, z: number): boolean {
  for (let d = 0; d < 6; d++) {
    const step = DIRS[d];
    const nx = x + step[0];
    const ny = y + step[1];
    const nz = z + step[2];
    const state = world.getBlock(nx, ny, nz);
    const id = blockIdOf(state);
    if (emitted(state, id, opposite(d)) > 0) return true;
    if (ROLES.conductive[id] !== 1) continue;
    if (strongInto(world, nx, ny, nz) > 0) return true;
    if (weakInto(world, nx, ny, nz) > 0) return true;
  }
  return false;
}

/** Energia fraca num bloco sólido: o pó encostado nele. */
export function weakInto(world: BlockReader, x: number, y: number, z: number): number {
  let best = 0;
  for (let d = 0; d < 6; d++) {
    const step = DIRS[d];
    const state = world.getBlock(x + step[0], y + step[1], z + step[2]);
    if (ROLES.kind[blockIdOf(state)] !== KIND_WIRE) continue;
    best = Math.max(best, stateBitsOf(state) & 0xf);
    if (best >= MAX_POWER) return MAX_POWER;
  }
  return best;
}

/** Energia do pó numa posição; 0 se não houver pó. Serve a teste e debug. */
export function powerAt(world: BlockReader, x: number, y: number, z: number): number {
  const state = world.getBlock(x, y, z);
  if (ROLES.kind[blockIdOf(state)] !== KIND_WIRE) return 0;
  return stateBitsOf(state) & 0xf;
}
