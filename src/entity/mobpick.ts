/**
 * Mirar num mob (saiu de `mobs.ts` no M18): o mais próximo que um raio
 * atravessa, pela caixa de cada um.
 */

import type { MobStore } from './mobstore';

/**
 * O mob mais próximo de um raio, para o jogador atacar.
 * Devolve o índice ou −1.
 */
export function pickMob(
  s: MobStore, ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, maxDistance: number,
): number {
  let best = -1;
  let bestDistance = maxDistance;
  for (let i = 0; i < s.active; i++) {
    const width = s.width(i);
    const height = s.height(i);
    const distance = rayBoxDistance(
      ox, oy, oz, dx, dy, dz,
      s.x[i] - width / 2, s.y[i], s.z[i] - width / 2,
      s.x[i] + width / 2, s.y[i] + height, s.z[i] + width / 2,
    );
    if (distance < 0 || distance >= bestDistance) continue;
    bestDistance = distance;
    best = i;
  }
  return best;
}

/**
 * Distância do raio até a AABB, ou −1 se não acerta (slab method).
 * Usado para o jogador mirar num mob em vez de num bloco.
 */
export function rayBoxDistance(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  let near = 0;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis++) {
    const origin = axis === 0 ? ox : axis === 1 ? oy : oz;
    const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
    const min = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const max = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;

    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return -1;
      continue;
    }
    let t1 = (min - origin) / direction;
    let t2 = (max - origin) / direction;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > near) near = t1;
    if (t2 < far) far = t2;
    if (near > far) return -1;
  }
  return far < 0 ? -1 : near;
}
