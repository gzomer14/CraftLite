/**
 * Mais de um jogador para os mobs (M20): quem está mais perto de um ponto.
 *
 * Sem sala aberta nada disto roda: `Mobs.others` fica `null`.
 */

import type { PlayerView } from './mobs';

export function copyView(to: PlayerView, from: PlayerView): void {
  to.x = from.x; to.y = from.y; to.z = from.z; to.eyeY = from.eyeY; to.held = from.held; to.alive = from.alive;
}

/** O vivo mais perto de (x, y, z): −1 é `own`, senão o índice em `others`. */
export function nearestView(own: PlayerView, others: readonly PlayerView[], x: number, y: number, z: number): number {
  let best = own.alive ? dist2(own, x, y, z) : Infinity;
  let pick = -1;
  for (let k = 0; k < others.length; k++) {
    const d = others[k].alive ? dist2(others[k], x, y, z) : Infinity;
    if (d < best) { best = d; pick = k; }
  }
  return pick;
}

function dist2(v: PlayerView, x: number, y: number, z: number): number {
  return (v.x - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2;
}
