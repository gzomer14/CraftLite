/**
 * Quem o mob persegue (doc 07 §2): aquisição e perda de alvo, quem é hostil a
 * quem, e a linha de visão. Saiu de `entity/mobs.ts` no M24, que passava de
 * 700 linhas — o mesmo corte de `mobrules.ts` e `mobcare.ts`: funções sem
 * estado, e quem guarda o pool é `Mobs`.
 */

import { mobDef, type MobDef } from '../data/mobs';
import { raycast } from '../world/raycast';
import { FLAG_ANGRY, FLAG_TAMED, type MobStore } from './mobstore';
import type { PlayerView } from './mobs';
import type { World } from '../world/world';

/** Ticks entre buscas de alvo (doc 07 §2). */
export const TARGET_INTERVAL = 10;
/** Ticks sem linha de visão até perder o alvo: 5 s. */
const BLIND_LIMIT = 100;
/** Aranha só fica hostil no escuro (doc 07 §2). */
const SPIDER_LIGHT_LIMIT = 11;

/**
 * Aquisição e perda de alvo (doc 07 §2): raio 16, ou 32 se provocado, com
 * linha de visão. Perde depois de 5 s sem ver, ou passando de 2× o raio.
 * `light` é a maior das duas luzes onde o mob está (a aranha olha para ela).
 */
export function updateTarget(
  s: MobStore, i: number, world: World, player: PlayerView, difficulty: number, light: number,
): void {
  const def = mobDef(s.type[i]);
  if (!player.alive || !isHostile(s, i, def, difficulty, light)) {
    s.hasTarget[i] = 0;
    return;
  }

  const range = s.hasFlag(i, FLAG_ANGRY) ? def.followRange * 2 : def.followRange;
  const dx = player.x - s.x[i];
  const dy = player.y - s.y[i];
  const dz = player.z - s.z[i];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance > range * 2) {
    s.hasTarget[i] = 0;
    s.blindTicks[i] = 0;
    return;
  }

  const visible = distance <= range && hasLineOfSight(s, i, world, player);
  if (visible) {
    s.hasTarget[i] = 1;
    s.blindTicks[i] = 0;
    return;
  }

  if (s.hasTarget[i] === 1) {
    s.blindTicks[i] += TARGET_INTERVAL;
    if (s.blindTicks[i] > BLIND_LIMIT) {
      s.hasTarget[i] = 0;
      s.blindTicks[i] = 0;
    }
  }
}

function isHostile(s: MobStore, i: number, def: MobDef, difficulty: number, light: number): boolean {
  if (difficulty === 0) return false;
  // Domado nunca ataca o dono, nem quando apanha dele.
  if (s.hasFlag(i, FLAG_TAMED)) return false;
  if (s.hasFlag(i, FLAG_ANGRY)) return true;
  if (def.category === 'hostile') {
    // Aranha é neutra na luz (doc 07 §2).
    if (def.traits.climbsWalls === true) return light <= SPIDER_LIGHT_LIMIT;
    return true;
  }
  return false;
}

/**
 * Linha de visão do mob até os olhos do jogador.
 *
 * O doc sugere 4 amostras ao longo do segmento; usamos o raycast DDA que já
 * existe, que é exato e custa proporcional à distância em blocos — e roda uma
 * vez a cada 10 ticks por mob, não por frame.
 */
function hasLineOfSight(s: MobStore, i: number, world: World, player: PlayerView): boolean {
  const ox = s.x[i];
  const oy = s.eyeY(i);
  const oz = s.z[i];
  let dx = player.x - ox;
  let dy = player.eyeY - oy;
  let dz = player.z - oz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 0.001) return true;
  dx /= distance; dy /= distance; dz /= distance;
  const hit = raycast(world, ox, oy, oz, dx, dy, dz, distance);
  return !hit.hit;
}
