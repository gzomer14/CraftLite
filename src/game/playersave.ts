/**
 * O jogador em forma de save, e de volta (doc 11 §3).
 *
 * Saiu de `SaveGame` no M20: além do jogador local, agora há o convidado de
 * uma sala na rede local, que o anfitrião guarda no próprio mundo e que o
 * aparelho do convidado aplica quando entra. Os dois caminhos usam as mesmas
 * duas funções — o formato é um só.
 */

import { INVENTORY_SIZE } from './inventory';
import { DIM_OVERWORLD } from '../data/dimensions';
import type { PlayerSave } from '../save/db';
import type { Player } from '../entity/player';
import type { Session } from './session';
import type { Marker } from './markers';
import type { ItemStack } from '../data/items';

export function snapshotPlayer(
session: Session, player: Player, worldId: string, playerId: string,
): PlayerSave {
  const inventory: number[] = new Array(INVENTORY_SIZE * 3).fill(0);
  const enchants: number[] = new Array(INVENTORY_SIZE).fill(0);
  let names: (string | null)[] | undefined;
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const stack = session.inventory.get(i);
    if (stack === null) continue;
    inventory[i * 3] = stack.item;
    inventory[i * 3 + 1] = stack.count;
    inventory[i * 3 + 2] = stack.damage;
    enchants[i] = stack.ench ?? 0;
    if (stack.name !== undefined) {
      names ??= new Array<string | null>(INVENTORY_SIZE).fill(null);
      names[i] = stack.name;
    }
  }

  return {
    worldId: worldId,
    playerId,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    health: session.survival.health,
    hunger: session.survival.hunger,
    saturation: session.survival.saturation,
    selected: session.inventory.selected,
    dimension: session.world.dimension,
    inventory,
    enchants,
    names,
    xp: session.xp.total,
    achievements: session.achievements.mask,
    guide: session.guide.stepsDone,
    effects: session.survival.effects.snapshot(),
    absorption: session.survival.absorption,
    bedSpawn: session.spawnY >= 0
      ? [session.spawnX, session.spawnY, session.spawnZ]
      : undefined,
    markers: session.journal.markers.snapshot(),
    stats: session.journal.stats.snapshot(),
    spectator: player.spectator ? true : undefined,
  };
}

/** Aplica um save de jogador ao estado vivo. */
export function restorePlayer(session: Session, player: Player, saved: PlayerSave): void {
  /*
   * A dimensão vem **antes** da posição: sair do mundo dentro do Nether e
   * voltar precisa recarregar o Nether, senão o jogador reaparece com as
   * coordenadas de lá dentro da superfície — 8 vezes fora do lugar, e
   * possivelmente dentro de pedra maciça.
   */
  const dimension = saved.dimension ?? DIM_OVERWORLD;
  if (dimension !== session.world.dimension) {
    session.enterDimension(dimension);
  }
  player.setPosition(saved.x, saved.y, saved.z);
  player.yaw = saved.yaw;
  player.pitch = saved.pitch;
  session.survival.health = saved.health;
  session.survival.hunger = saved.hunger;
  session.survival.saturation = saved.saturation;
  session.survival.effects.restore(saved.effects, session.survival);
  if (saved.absorption !== undefined) session.survival.absorption = saved.absorption;
  session.inventory.select(saved.selected);
  session.xp.setTotal(saved.xp ?? 0);
  session.achievements.setMask(saved.achievements ?? 0);
  session.guide.restore(saved.guide);

  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const item = saved.inventory[i * 3] ?? 0;
    const count = saved.inventory[i * 3 + 1] ?? 0;
    session.inventory.set(
      i,
      item > 0 && count > 0
        ? withName({
          item, count,
          damage: saved.inventory[i * 3 + 2] ?? 0,
          ench: saved.enchants?.[i] ?? 0,
        }, saved.names?.[i])
        : null,
    );
  }

  session.journal.markers.restore(saved.markers as Partial<Marker>[] | undefined);
  session.journal.stats.restore(saved.stats);
  player.spectator = saved.spectator === true && player.mode === 'creative';
  if (player.spectator) player.flying = true;

  if (saved.bedSpawn !== undefined) {
    session.spawnX = saved.bedSpawn[0];
    session.spawnY = saved.bedSpawn[1];
    session.spawnZ = saved.bedSpawn[2];
  }
}

function withName(stack: ItemStack, name: string | null | undefined): ItemStack {
  if (typeof name === 'string' && name !== '') stack.name = name;
  return stack;
}
