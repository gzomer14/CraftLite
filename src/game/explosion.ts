/**
 * Explosão (doc 07 §6): evento, não entidade.
 *
 * **Desvio consciente do doc:** ele descreve lançar raios em 16³ direções. São
 * ~4096 raios por explosão, e um creeper no meio de uma cova em T0 derrubaria o
 * frame inteiro. Aqui a esfera é percorrida bloco a bloco (raio 3 → ~250
 * blocos), com queda de força por distância e **um** raycast por bloco candidato
 * para checar se ele está abrigado. O resultado visual é o mesmo — cratera
 * irregular, paredes protegendo o que está atrás — a um custo que cabe no
 * orçamento.
 */

import { AIR, defOf } from '../data/blocks';
import { ITEM_BY_NAME, type ItemStack } from '../data/items';
import { BLOCK_LOOT } from '../data/loot';
import { raycast } from '../world/raycast';
import type { World } from '../world/world';

/** Fração dos blocos destruídos que solta item (doc 07 §6). */
const DROP_CHANCE = 0.3;
/** Dureza acima da qual nem a explosão mais forte quebra. */
const MAX_RESISTANCE = 25;

export interface ExplosionEffects {
  /** Bloco removido, para a luz e o save. */
  onBlockRemoved(x: number, y: number, z: number, previous: number): void;
  /** Item solto por um bloco destruído. */
  onDrop(stack: ItemStack, x: number, y: number, z: number): void;
  /**
   * Avisa que houve explosão de força `power` e raio `radius`; quem recebe
   * calcula o dano de cada entidade com `explosionDamage`.
   */
  onDamage(power: number, x: number, y: number, z: number, radius: number): void;
}

/**
 * Explode em `(x, y, z)` com força `power` (creeper = 3).
 * Devolve quantos blocos foram destruídos.
 */
export function explode(
  world: World, x: number, y: number, z: number, power: number, effects: ExplosionEffects,
): number {
  const radius = power * 1.3;
  const radiusSq = radius * radius;
  const min = Math.floor(-radius);
  const max = Math.ceil(radius);
  let destroyed = 0;

  for (let dy = min; dy <= max; dy++) {
    for (let dz = min; dz <= max; dz++) {
      for (let dx = min; dx <= max; dx++) {
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > radiusSq) continue;

        const bx = Math.floor(x) + dx;
        const by = Math.floor(y) + dy;
        const bz = Math.floor(z) + dz;
        const state = world.getBlock(bx, by, bz);
        if (state === AIR) continue;

        const def = defOf(state);
        if (def.hardness < 0 || def.hardness >= MAX_RESISTANCE) continue;

        // Força que sobra nesta distância, 1 no centro e 0 na borda.
        const distance = Math.sqrt(distanceSq);
        const strength = 1 - distance / radius;
        // Blocos duros aguentam mais perto do centro.
        if (strength * power * 2 < def.hardness) continue;
        if (isSheltered(world, x, y, z, bx, by, bz)) continue;

        if (!world.setBlock(bx, by, bz, AIR, 'physics')) continue;
        effects.onBlockRemoved(bx, by, bz, state);
        destroyed++;

        if (Math.random() < DROP_CHANCE) {
          const stack = dropOf(def.name);
          if (stack !== null) effects.onDrop(stack, bx + 0.5, by + 0.5, bz + 0.5);
        }
      }
    }
  }

  effects.onDamage(power, x, y, z, radius);
  return destroyed;
}

/**
 * true se há bloco sólido entre o centro da explosão e o bloco candidato — é
 * isso que faz uma parede proteger o que está atrás dela.
 */
function isSheltered(
  world: World, ox: number, oy: number, oz: number,
  bx: number, by: number, bz: number,
): boolean {
  const tx = bx + 0.5;
  const ty = by + 0.5;
  const tz = bz + 0.5;
  let dx = tx - ox;
  let dy = ty - oy;
  let dz = tz - oz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1.5) return false;
  dx /= distance; dy /= distance; dz /= distance;

  const hit = raycast(world, ox, oy, oz, dx, dy, dz, distance - 0.5);
  if (!hit.hit) return false;
  // Acertar o próprio bloco candidato não conta como abrigo.
  return hit.x !== bx || hit.y !== by || hit.z !== bz;
}

/** O que um bloco destruído por explosão solta (a regra padrão do loot). */
function dropOf(blockName: string): ItemStack | null {
  const entry = BLOCK_LOOT[blockName];
  if (entry !== undefined) {
    if (entry.drops.length === 0) return null;
    const drop = entry.drops[0];
    const item = ITEM_BY_NAME.get(drop.item);
    if (item === undefined) return null;
    const count = typeof drop.count === 'number' ? drop.count : drop.count[0];
    return count > 0 ? { item: item.id, count, damage: 0 } : null;
  }
  const item = ITEM_BY_NAME.get(blockName);
  return item === undefined ? null : { item: item.id, count: 1, damage: 0 };
}

/** Dano da explosão em quem está a `distance` do centro, com força `power`. */
export function explosionDamage(power: number, distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const factor = 1 - distance / radius;
  // Doc 07 §2: creeper (power 3) chega a ~49 de dano no abraço.
  return Math.round(factor * factor * power * 16 + factor * power);
}
