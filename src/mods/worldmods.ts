/**
 * Mundo e mods (M21).
 *
 * O mundo guarda os mods com que foi jogado da última vez (`WorldMeta.mods`).
 * Abrir sem um deles não abre: o bloco do mod viraria ar no primeiro save, e o
 * que o jogador construiu com ele se perderia sem aviso. A tela oferece ligar o
 * que falta. Mundo jogado sem mod nenhum não ganha o campo.
 */

import { ACTIVE_MODS } from './active';

/** Os mods que o mundo pede e que não estão ligados agora. */
export function missingMods(worldMods: readonly string[] | undefined): string[] {
  if (worldMods === undefined) return [];
  return worldMods.filter((id) => !ACTIVE_MODS.some((mod) => mod.id === id));
}

/** O que o save grava: os mods ligados, ou nada — o campo fica como estava. */
export function modsToRecord(): string[] | undefined {
  return ACTIVE_MODS.length === 0 ? undefined : ACTIVE_MODS.map((mod) => mod.id);
}
