/**
 * Blocos de duas células: porta e cama (M8, doc 04 §3).
 *
 * O jogo tratou porta e cama como **um bloco só** até 2026-09-16 — a cama
 * inteira num cubo, a porta com um metro de altura —, e o comentário de
 * `game/sleep.ts` dizia o motivo: faltava a máquina de estados de colocação e
 * quebra. É ela que está aqui, e ela é pequena porque não precisa saber o que
 * está ligando: a tabela de blocos declara `multi`, e este módulo só garante
 * **duas invariantes**:
 *
 *  1. as duas metades nascem juntas (`placeMulti`, chamado por
 *     `game/interaction.ts`);
 *  2. as duas metades morrem juntas — e esta vale para **qualquer** causa.
 *
 * A segunda é a que interessa e é o motivo de este módulo ser um ouvinte de
 * `world.onBlockChange` em vez de um caso dentro de quem quebra bloco. Toda
 * mutação de voxel passa por `world.setBlock` (regra nº 3 do projeto), então
 * pendurar a regra ali cobre de uma vez o jogador, a explosão de creeper, o
 * fogo, o pistão, o mob que arromba a porta e o `.clw` importado pela metade —
 * nenhum deles precisa saber que porta tem duas metades.
 *
 * A metade que some **não dropa nada**: quem dropa é a metade que o jogador
 * quebrou, pela tabela de `data/loot.ts`. Uma porta quebrada dá uma porta.
 */

import { BLOCK_BY_NAME, BLOCKS, blockIdOf, defOf, makeState, stateBitsOf, AIR } from '../data/blocks';
import { FACING_STEP } from './mesh/shapes';
import type { World } from './world';

/** Deslocamento até a outra metade, por id. 0 = bloco comum. */
const PARTNER_ID = new Uint16Array(BLOCKS.length);
/** 1 = a outra metade está acima, 2 = abaixo, 3 = na direção dos bits 0..1. */
const PARTNER_AT = new Uint8Array(BLOCKS.length);
/** 1 na metade que o item coloca e que responde ao clique. */
const PARTNER_ROOT = new Uint8Array(BLOCKS.length);

const AT_ABOVE = 1;
const AT_BELOW = 2;
const AT_FACING = 3;

for (let id = 0; id < BLOCKS.length; id++) {
  const def = BLOCKS[id];
  if (def === undefined || def.multi === null) continue;
  const other = BLOCK_BY_NAME.get(def.multi.other);
  if (other === undefined) throw new Error(`Metade desconhecida: ${def.multi.other}`);
  PARTNER_ID[id] = other.id;
  PARTNER_AT[id] = def.multi.at === 'above' ? AT_ABOVE
    : def.multi.at === 'below' ? AT_BELOW : AT_FACING;
  PARTNER_ROOT[id] = def.multi.root ? 1 : 0;
}

/** true se o bloco ocupa duas células. */
export function isMulti(id: number): boolean {
  return PARTNER_ID[id] !== 0;
}

/** true se é a metade que o item coloca — a que dropa e a que abre no clique. */
export function isMultiRoot(id: number): boolean {
  return PARTNER_ROOT[id] === 1;
}

/** Id da outra metade, ou 0. */
export function partnerIdOf(id: number): number {
  return PARTNER_ID[id];
}

/**
 * Deslocamento até a outra metade, escrito em `out` como `[dx, dy, dz]`.
 * Devolve false quando o bloco não tem outra metade.
 */
export function partnerOffset(state: number, out: Int8Array): boolean {
  const id = blockIdOf(state);
  const at = PARTNER_AT[id];
  if (at === 0) return false;
  out[0] = 0; out[1] = 0; out[2] = 0;
  if (at === AT_ABOVE) { out[1] = 1; return true; }
  if (at === AT_BELOW) { out[1] = -1; return true; }
  const step = FACING_STEP[stateBitsOf(state) & 3];
  out[0] = step[0];
  out[2] = step[1];
  return true;
}

/**
 * Estado da outra metade de um bloco recém-colocado.
 *
 * Os bits vão junto, com uma exceção: quando as metades se acham **pela
 * direção** (a cama), a de lá aponta de volta para a de cá — `bits ^ 1` inverte
 * a direção na codificação de `FACING_STEP`. É o que faz os pés da cama
 * nascerem nas duas pontas de fora, e não os dois no mesmo lado.
 */
export function partnerState(state: number): number {
  const id = blockIdOf(state);
  const other = PARTNER_ID[id];
  if (other === 0) return AIR;
  const bits = stateBitsOf(state);
  return makeState(other, PARTNER_AT[id] === AT_FACING ? bits ^ 1 : bits);
}

const OFFSET = new Int8Array(3);
const OFFSET_BACK = new Int8Array(3);

/**
 * true se `(x,y,z)` guarda a metade que casa com `state`, que fica a `OFFSET`
 * dali no sentido contrário.
 *
 * Confere id **e** volta: uma cama encostada em outra cama não pode fazer as
 * duas sumirem juntas, e é exatamente isso que aconteceria conferindo só o id.
 */
function isPartnerAt(world: World, state: number, x: number, y: number, z: number): boolean {
  const here = world.getBlock(x, y, z);
  if (blockIdOf(here) !== PARTNER_ID[blockIdOf(state)]) return false;
  if (!partnerOffset(here, OFFSET_BACK)) return false;
  // A volta tem que ser o caminho de ida ao contrário.
  return OFFSET_BACK[0] === -OFFSET[0]
    && OFFSET_BACK[1] === -OFFSET[1]
    && OFFSET_BACK[2] === -OFFSET[2];
}

export interface MultiEvents {
  /** Chamado depois de a metade órfã sair — a luz precisa saber. */
  onChanged?: (x: number, y: number, z: number, previous: number, next: number) => void;
}

/**
 * Liga a regra ao mundo. Devolve a função que desliga.
 *
 * A reentrância é segura por construção: tirar a metade órfã dispara o mesmo
 * evento, que não acha mais parceiro nenhum e para. `world.notify` já suporta
 * ouvinte que chama `setBlock` de dentro do evento (é o que o crescimento faz).
 */
export function attachMultiBlocks(world: World, events: MultiEvents = {}): () => void {
  return world.onBlockChange((change) => {
    // A geração escreve milhões de voxels e não coloca porta pela metade.
    if (change.source === 'gen') return;
    const previous = change.previous;
    if (!isMulti(blockIdOf(previous))) return;
    // Trocar o estado sem trocar o bloco (abrir a porta) não desfaz o par.
    if (blockIdOf(change.state) === blockIdOf(previous)) return;
    if (!partnerOffset(previous, OFFSET)) return;

    const px = change.x + OFFSET[0];
    const py = change.y + OFFSET[1];
    const pz = change.z + OFFSET[2];
    if (!isPartnerAt(world, previous, px, py, pz)) return;

    const orphan = world.getBlock(px, py, pz);
    if (!world.setBlock(px, py, pz, AIR, change.source)) return;
    events.onChanged?.(px, py, pz, orphan, AIR);
  });
}

/**
 * Escreve as duas metades. Devolve false — sem tocar no mundo — se a segunda
 * célula não estiver livre.
 *
 * `canReplace` é de quem chama: a colocação já sabe o que é substituível.
 */
export function placeMulti(
  world: World, x: number, y: number, z: number, state: number,
  canReplace: (x: number, y: number, z: number) => boolean,
): boolean {
  const other = partnerState(state);
  if (other === AIR) return world.setBlock(x, y, z, state, 'player');
  if (!partnerOffset(state, OFFSET)) return false;

  const px = x + OFFSET[0];
  const py = y + OFFSET[1];
  const pz = z + OFFSET[2];
  if (!canReplace(px, py, pz)) return false;
  if (!world.setBlock(x, y, z, state, 'player')) return false;
  if (!world.setBlock(px, py, pz, other, 'player')) {
    // A segunda falhou (chunk não carregado): desfaz, senão sobra meia porta.
    world.setBlock(x, y, z, AIR, 'player');
    return false;
  }
  return true;
}

/**
 * Posição da metade `root` do bloco em `(x,y,z)`, escrita em `out`.
 * Devolve false se o bloco não é de duas células.
 *
 * É o que faz clicar em qualquer ponta da cama dormir, e mirar a folha de cima
 * da porta abrir a porta inteira.
 */
export function rootPositionOf(
  world: World, x: number, y: number, z: number, out: Int32Array,
): boolean {
  const state = world.getBlock(x, y, z);
  const id = blockIdOf(state);
  if (!isMulti(id)) return false;
  out[0] = x; out[1] = y; out[2] = z;
  if (isMultiRoot(id)) return true;
  if (!partnerOffset(state, OFFSET)) return false;
  out[0] = x + OFFSET[0];
  out[1] = y + OFFSET[1];
  out[2] = z + OFFSET[2];
  return isMultiRoot(blockIdOf(world.getBlock(out[0], out[1], out[2])));
}

/** true se o bloco na posição é uma das metades de uma cama. */
export function isBedAt(world: World, x: number, y: number, z: number): boolean {
  return defOf(world.getBlock(x, y, z)).shape === 'bed';
}
