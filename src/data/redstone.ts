/**
 * Papel de cada bloco no circuito de redstone (doc 14 — M7).
 *
 * Como toda tabela de `src/data`, isto é **dado**: acrescentar um componente é
 * uma linha aqui mais uma na tabela de blocos, nunca um `case` novo no motor.
 * `world/redstone.ts` lê estas entradas uma vez no boot e as achata em arrays
 * indexadas por id, porque o caminho quente consulta papel por id milhares de
 * vezes por atualização de circuito.
 */

import { BLOCK_BY_NAME, type BlockDef } from './blocks';

/**
 * O que o bloco faz no circuito.
 *
 * - `wire` — pó: conduz e perde 1 de energia por bloco.
 * - `source` — energia 15 constante (bloco de redstone).
 * - `lever` — liga e desliga no clique, e fica.
 * - `button` — liga no clique e desliga sozinho depois de `pressTicks`.
 * - `plate` — liga enquanto houver alguém em cima.
 * - `torch` — inverte: acesa quando o apoio **não** está energizado.
 * - `repeater` — repete 15 na direção da saída, com atraso.
 * - `piston` — estende e recolhe, empurrando blocos.
 * - `lamp` — acende.
 * - `door` — abre com energia (porta, portão e alçapão).
 * - `rail` — trilho motorizado: segue a energia no bit 4 do estado (M7).
 * - `detector` — trilho detector: **emite** quando há carrinho em cima. Quem
 *   liga o bit é `entity/minecart.ts`, não o circuito.
 */
export type RedstoneKind =
  | 'wire' | 'source' | 'lever' | 'button' | 'plate'
  | 'torch' | 'repeater' | 'piston' | 'lamp' | 'door' | 'rail' | 'detector';

export interface RedstoneDef {
  kind: RedstoneKind;
  /**
   * O outro id do par ligado/desligado. Tocha e lâmpada existem em dois ids
   * porque a emissão de luz é indexada por id (ver `data/blocks.ts`).
   */
  pair?: string;
  /** true quando **este** id é o estado ligado do par. */
  lit?: boolean;
  /** Ticks que o botão fica apertado. */
  pressTicks?: number;
  /** Pistão pegajoso: puxa o bloco de volta ao recolher. */
  sticky?: boolean;
}

export const REDSTONE: Readonly<Record<string, RedstoneDef>> = {
  redstone_wire: { kind: 'wire' },
  redstone_block: { kind: 'source' },
  lever: { kind: 'lever' },
  // 20 ticks = 1 s de pedra, 30 = 1,5 s de madeira, como na referência.
  stone_button: { kind: 'button', pressTicks: 20 },
  oak_button: { kind: 'button', pressTicks: 30 },
  stone_pressure_plate: { kind: 'plate' },
  oak_pressure_plate: { kind: 'plate' },
  redstone_torch: { kind: 'torch', pair: 'redstone_torch_off', lit: true },
  redstone_torch_off: { kind: 'torch', pair: 'redstone_torch' },
  repeater: { kind: 'repeater' },
  piston: { kind: 'piston' },
  sticky_piston: { kind: 'piston', sticky: true },
  redstone_lamp: { kind: 'lamp', pair: 'redstone_lamp_on' },
  redstone_lamp_on: { kind: 'lamp', pair: 'redstone_lamp', lit: true },
  powered_rail: { kind: 'rail' },
  detector_rail: { kind: 'detector' },
};

/**
 * Portas, portões e alçapões entram no circuito sem linha própria: o papel
 * `door` vale para toda forma que abre, e é a forma da tabela de blocos que
 * decide. Acrescentar uma porta de bétula não exige tocar aqui.
 */
const OPENABLE: ReadonlySet<string> = new Set(['door', 'fence_gate', 'trapdoor']);

export function redstoneDefOf(block: BlockDef): RedstoneDef | undefined {
  const entry = REDSTONE[block.name];
  if (entry !== undefined) return entry;
  if (OPENABLE.has(block.shape)) return DOOR;
  return undefined;
}

const DOOR: RedstoneDef = { kind: 'door' };

/** Id de bloco por nome, com erro claro — os módulos do circuito usam muito. */
export function redstoneBlockId(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco de redstone desconhecido: ${name}`);
  return def.id;
}
