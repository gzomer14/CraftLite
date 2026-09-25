/**
 * Papéis do circuito por id de bloco, e as contas pequenas que todo o circuito
 * usa: direção, encaixe e chave de posição. Saiu de `redstone.ts` no M18,
 * quando ele passou de mil linhas — lá ficaram a fila e os componentes, aqui
 * as tabelas planas que o caminho quente consulta.
 */

import { BLOCKS, blockIdOf, type BlockDef } from '../data/blocks';
import { redstoneDefOf, type RedstoneDef, type RedstoneKind } from '../data/redstone';
import { MOUNT_CEILING, MOUNT_FLOOR, PISTON_STEP } from './mesh/shapes';

/** Teto de posições reavaliadas por tick. Mesma disciplina do doc 03 §9. */
export const MAX_UPDATES_PER_TICK = 1024;
/** Energia máxima que um emissor entrega. */
export const MAX_POWER = 15;
/** Atraso, em ticks, de tocha e repetidor. */
export const TORCH_DELAY = 2;
/** Quantos blocos um pistão empurra de uma vez. */
export const PISTON_LIMIT = 12;

/**
 * Bit que marca "esta porta está aberta **por energia**" (M7).
 *
 * Sem ele o circuito e a mão brigam: abrir uma porta no clique dispara uma
 * reavaliação da posição, o circuito vê energia zero e fecha a porta no mesmo
 * tick — a porta nunca abriria na mão. Com ele, a porta só se mexe quando a
 * energia **muda**, e o clique manual é respeitado até a próxima mudança.
 *
 * É o bit 4 do estado porque 0..2 são de porta e portão e 0..3 de alçapão;
 * nenhum dos três usa o 4 (`world/mesh/shapes.ts`).
 */
export const DOOR_POWERED_BIT = 16;
/** Deslocamento até a outra folha da porta. Reusado — o tick não aloca. */
export const DOOR_PARTNER = new Int8Array(3);

/** Folga em Y ao procurar a placa sob os pés de uma entidade. */
export const FOOT_EPSILON = 0.05;

/**
 * Vizinhos, na ordem de `PISTON_STEP`: +X, −X, +Z, −Z, +Y, −Y.
 * Os quatro primeiros coincidem com `FACING_STEP` de propósito.
 */
export const DIRS = PISTON_STEP;

/** Direção oposta — o par (+X,−X) e afins fica a um XOR de distância. */
export function opposite(dir: number): number {
  return dir ^ 1;
}

/** Tabelas planas por id — o caminho quente não olha objeto. */
export interface Roles {
  /** `KIND_*`; 0 = não participa do circuito. */
  kind: Uint8Array;
  /** Id do par ligado/desligado, ou 0. */
  pair: Uint16Array;
  /** 1 quando este id é o lado aceso do par. */
  lit: Uint8Array;
  /** Ticks que o botão fica apertado. */
  pressTicks: Uint16Array;
  sticky: Uint8Array;
  /** Bit de "aberto" de porta, portão e alçapão. 0 = não abre. */
  openBit: Uint8Array;
  /** 1 = bloco sólido e opaco, que transmite energia de bloco. */
  conductive: Uint8Array;
  /** 1 = pistão não move este bloco (ver `isImmovable`). */
  immovable: Uint8Array;
  /** 1 quando o bloco cai se perder o apoio (`support` da tabela de blocos). */
  needsSupport: Uint8Array;
}

export const KIND_NONE = 0;
const KIND_ORDER: readonly RedstoneKind[] = [
  'wire', 'source', 'lever', 'button', 'plate', 'torch', 'repeater', 'piston', 'lamp', 'door',
  'rail', 'detector', 'comparator', 'observer', 'hopper', 'dispenser',
];
const KIND_ID: Readonly<Record<RedstoneKind, number>> = Object.fromEntries(
  KIND_ORDER.map((name, i) => [name, i + 1]),
) as Record<RedstoneKind, number>;

export const KIND_WIRE = KIND_ID.wire;
export const KIND_SOURCE = KIND_ID.source;
export const KIND_LEVER = KIND_ID.lever;
export const KIND_BUTTON = KIND_ID.button;
export const KIND_PLATE = KIND_ID.plate;
export const KIND_TORCH = KIND_ID.torch;
export const KIND_REPEATER = KIND_ID.repeater;
export const KIND_PISTON = KIND_ID.piston;
export const KIND_LAMP = KIND_ID.lamp;
export const KIND_DOOR = KIND_ID.door;
export const KIND_RAIL = KIND_ID.rail;
export const KIND_DETECTOR = KIND_ID.detector;
export const KIND_COMPARATOR = KIND_ID.comparator;
export const KIND_OBSERVER = KIND_ID.observer;
export const KIND_HOPPER = KIND_ID.hopper;
export const KIND_DISPENSER = KIND_ID.dispenser;
/**
 * Bit 3 de funil (travado), dispensador e liberador (disparado) e observador
 * (pulsando) — os bits 0..2 são a direção dos três (M15).
 */
export const ACTIVE_BIT = 8;

/**
 * Bit de energizado do trilho (`RAIL_POWERED` de `world/mesh/shapes.ts`).
 *
 * Os bits 0..3 do trilho são a forma, que `world/rails.ts` escreve; o circuito
 * só toca no 4. Os dois sistemas escrevem no mesmo voxel sem se atropelar
 * porque cada um preserva os bits do outro.
 */
export const RAIL_POWERED_BIT = 16;

/**
 * Blocos que o pistão não move: os que guardam conteúdo (o baú tem inventário
 * amarrado à posição), os que não deviam sair do lugar nunca (rocha-mãe) e os
 * caros demais para o gênero mover (obsidiana).
 */
const IMMOVABLE: ReadonlySet<string> = new Set([
  'bedrock', 'obsidian', 'chest', 'furnace', 'furnace_lit', 'enchanting_table', 'mob_spawner',
  'piston_head', 'hopper', 'dispenser', 'dropper', 'anvil',
]);

function buildRoles(): Roles {
  const n = BLOCKS.length;
  const roles: Roles = {
    kind: new Uint8Array(n),
    pair: new Uint16Array(n),
    lit: new Uint8Array(n),
    pressTicks: new Uint16Array(n),
    sticky: new Uint8Array(n),
    openBit: new Uint8Array(n),
    conductive: new Uint8Array(n),
    immovable: new Uint8Array(n),
    needsSupport: new Uint8Array(n),
  };
  for (let id = 0; id < n; id++) {
    const def = BLOCKS[id];
    if (def === undefined) continue;
    roles.conductive[id] = def.opaque && def.solid ? 1 : 0;
    roles.needsSupport[id] = def.support === 'none' ? 0 : 1;
    roles.immovable[id] = IMMOVABLE.has(def.name) || def.hardness < 0 ? 1 : 0;
    roles.openBit[id] = openBitOf(def);

    const entry: RedstoneDef | undefined = redstoneDefOf(def);
    if (entry === undefined) continue;
    roles.kind[id] = KIND_ID[entry.kind];
    roles.lit[id] = entry.lit === true ? 1 : 0;
    roles.pressTicks[id] = entry.pressTicks ?? 0;
    roles.sticky[id] = entry.sticky === true ? 1 : 0;
    if (entry.pair !== undefined) {
      const other = BLOCKS.find((b) => b !== undefined && b.name === entry.pair);
      roles.pair[id] = other === undefined ? 0 : other.id;
    }
  }
  return roles;
}

/** Bit de "aberto" de cada forma que abre — o mesmo de `game/interaction.ts`. */
function openBitOf(def: BlockDef): number {
  if (def.shape === 'door' || def.shape === 'fence_gate') return 4;
  if (def.shape === 'trapdoor') return 8;
  return 0;
}

export const ROLES = buildRoles();

/**
 * true se uma mudança neste bloco pode ser sentida a dois blocos de distância:
 * componente de circuito ou bloco que conduz energia de bloco.
 */
export function reachesFar(state: number): boolean {
  const id = blockIdOf(state);
  return ROLES.kind[id] !== KIND_NONE || ROLES.conductive[id] === 1;
}

export const PISTON_HEAD_ID = (() => {
  const def = BLOCKS.find((b) => b !== undefined && b.name === 'piston_head');
  return def === undefined ? 0 : def.id;
})();

/**
 * Direção em que fica o apoio de um encaixe (`MOUNT_*` de `shapes.ts`).
 * Encaixe no chão procura embaixo; no teto, em cima; na parede, do lado.
 */
export function mountDir(mount: number): readonly [number, number, number] {
  return DIRS[mountIndexOf(mount)];
}

/** Índice em `DIRS` do apoio de um encaixe. */
export function mountIndexOf(mount: number): number {
  if (mount === MOUNT_FLOOR) return 5;
  if (mount === MOUNT_CEILING) return 4;
  return mount & 3;
}

/** 26 bits por eixo horizontal e 8 para Y cabem folgado em um double. */
export function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}

export function yOfKey(key: number): number {
  return key % 128;
}

export function xOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(Math.floor(xz / 0x4000000));
}

export function zOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(xz % 0x4000000);
}

/** Devolve o sinal a um inteiro de 26 bits. */
function signed26(value: number): number {
  return value >= 0x2000000 ? value - 0x4000000 : value;
}

/**
 * O que pistão e placa precisam do circuito: ler o mundo, escrever avisando a
 * luz (o `replace` da classe `Redstone`) e tocar o som.
 */
export interface CircuitWriter {
  world: { getBlock(x: number, y: number, z: number): number };
  replace(x: number, y: number, z: number, state: number): void;
  onSound(name: string, x: number, y: number, z: number): void;
}
