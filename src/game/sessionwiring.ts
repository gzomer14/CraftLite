/**
 * A ligação entre os sistemas da sessão: o que acontece quando o inventário
 * pega um item, quando o jogador morre, quando um mob pede som ou flecha e
 * quando um projétil encosta em alguém.
 *
 * Saiu da `Session` em 2026-09-22 (M13, "dividir os três módulos gigantes").
 * É só costura — cada função pendura callbacks nos sistemas que a sessão já
 * montou, e nenhuma guarda estado.
 */

import { MOB_BY_NAME } from '../data/mobs';
import { FIREBALL_FLAGS } from '../entity/projectile';
import { GROW_TICKS, type MobEvents } from '../entity/mobs';
import { EGG_HATCH_CHANCE } from './itemuse';
import { ItemFlow } from './itemflow';
import type { ItemStack } from '../data/items';
import type { ChunkColumn } from '../world/chunk';
import type { Session, SessionEvents } from './session';

/** Raio em que a flecha e a explosão acertam o jogador. */
const HIT_RADIUS = 0.7;
/** Velocidade da bola de fogo, em blocos por tick: lenta o bastante para desviar. */
const FIREBALL_SPEED = 0.45;
/** Força da explosão da bola de fogo: quebra ponte, não some com a base. */
const FIREBALL_POWER = 1.6;

/**
 * Funil, dispensador e liberador (M15): o `ItemFlow` com o que ele toca, e o
 * circuito sabendo ler contêiner e disparar o dispensador.
 */
export function wireItemFlow(s: Session, events: SessionEvents): ItemFlow {
  const flow = new ItemFlow({
    world: s.world, tiles: s.tiles, items: s.items, projectiles: s.projectiles, fire: s.fire,
    blockChanged: (x, y, z, previous, state) => {
      s.lighting.onBlockChanged(x, y, z, previous, state);
      s.fluids.scheduleAround(x, y, z);
    },
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    random: () => s.random(),
  });
  s.redstone.signalOf = (x, y, z) => flow.signal(x, y, z);
  s.redstone.onTrigger = (x, y, z) => { flow.dispense(x, y, z); };
  return flow;
}

export function wireInventory(
  s: Session, events: SessionEvents, dropItem: (stack: ItemStack) => void,
): void {
  s.inventory.onDrop = (stack) => dropItem(stack);
  s.inventory.refreshResult = () => s.workbench.refreshCraftResult();
  s.inventory.takeResult = () => s.workbench.consumeCraft();

  s.items.onPickup = (stack) => {
    const leftover = s.inventory.giveStack(stack);
    if (leftover < stack.count) {
      events.onPickup(stack.item, stack.count - leftover);
      s.noteObtained(stack.item);
    }
    return leftover;
  };

  s.orbs.onCollect = (amount) => {
    s.xp.add(amount);
    events.onSound?.('ui/xp', s.player.x, s.player.y, s.player.z);
  };
  s.achievements.onUnlock = (def) => {
    events.onAchievement?.(def.display, def.description);
    events.onSound?.('player/levelup', s.player.x, s.player.y, s.player.z);
  };
  s.xp.onLevelUp = (level) => {
    s.achievements.level(level);
    events.onSound?.('player/levelup', s.player.x, s.player.y, s.player.z);
    events.onMessage?.(`Nível ${level}`);
  };
}

export function wireSurvival(s: Session, events: SessionEvents): void {
  s.survival.onDamage = (amount) => {
    events.onHurt?.(amount);
    events.onSound?.('player/hurt', s.player.x, s.player.y, s.player.z);
    s.combat.damageArmor(amount);
  };
  s.survival.onDeath = () => {
    // Antes de o inventário cair: o marcador vai para onde ele cai (M10).
    s.journal.onDeath(s.player, s.world.dimension);
    for (const stack of s.inventory.dropAll()) {
      // Morrendo, o inventário cai **em volta** do corpo e não numa direção:
      // não há olhar para arremessar, e o jogador volta andando até o monte.
      s.items.spawn(s.player.x, s.player.y + 1, s.player.z, stack);
    }
    // Doc 06 §6: morrer zera a experiência. Não sobra orbe no chão — o que
    // o jogador recupera correndo de volta é o inventário, não o nível.
    s.xp.reset();
    s.workbench.closeScreen();
    events.onSound?.('player/death', s.player.x, s.player.y, s.player.z);
    events.onDeath(s.survival.deathMessage);
  };
}

/** Eventos que o `Mobs` dispara de volta para o mundo. */
export function mobEvents(s: Session, events: SessionEvents): MobEvents {
  return {
    onDrop: (item: number, count: number, x: number, y: number, z: number) => {
      s.items.spawn(x, y, z, { item, count, damage: 0 });
    },
    onXp: (amount: number, x: number, y: number, z: number) => {
      s.orbs.spawn(x, y, z, amount);
    },
    onSound: (name: string, x: number, y: number, z: number) => {
      events.onSound?.(name, x, y, z);
    },
    onHitPlayer: (damage: number, pushX: number, pushZ: number) => {
      s.combat.hurtPlayer(damage, 'mob', pushX, pushZ);
    },
    onExplode: (x: number, y: number, z: number, power: number) => {
      s.combat.explodeAt(x, y, z, power);
    },
    onBreakBlock: (x: number, y: number, z: number) => {
      s.combat.breakBlockByMob(x, y, z);
    },
    onArrow: (
      x: number, y: number, z: number,
      dx: number, dy: number, dz: number, damage: number, fireball = false,
    ) => {
      s.projectiles.spawn(
        x, y, z, dx, dy, dz, damage, false,
        fireball ? FIREBALL_SPEED : 1.2,
        fireball ? FIREBALL_FLAGS : 0,
      );
    },
    // Aldeia (M9): o aldeão abre a porta de casa, e bater nele tem memória.
    onDoor: (x: number, y: number, z: number, open: boolean) => {
      s.villages.onDoor(x, y, z, open);
    },
    onHurtByPlayer: (i: number) => { s.villages.onHurtByPlayer(i); },
  };
}

/** A flecha acerta o jogador ou um mob — o primeiro que estiver no caminho. */
export function wireProjectiles(s: Session, events: SessionEvents): void {
  s.projectiles.onHit = (x, y, z, damage, fromPlayer) => {
    if (!fromPlayer) {
      const dx = x - s.player.x;
      const dy = y - (s.player.y + s.player.height * 0.5);
      const dz = z - s.player.z;
      if (Math.abs(dx) < HIT_RADIUS && Math.abs(dz) < HIT_RADIUS
        && Math.abs(dy) < s.player.height * 0.5 + 0.2) {
        const length = Math.hypot(dx, dz) || 1;
        s.combat.hurtPlayer(damage, 'arrow', (-dx / length) * 0.2, (-dz / length) * 0.2);
        return true;
      }
    }
    const store = s.mobs.store;
    for (let i = 0; i < store.active; i++) {
      const width = store.width(i) / 2 + 0.1;
      if (Math.abs(x - store.x[i]) > width || Math.abs(z - store.z[i]) > width) continue;
      if (y < store.y[i] || y > store.y[i] + store.height(i)) continue;
      s.mobs.damage(i, damage, 'player');
      return true;
    }
    return false;
  };
  s.projectiles.onImpactSound = (x, y, z) => {
    events.onSound?.('player/arrow', x, y, z);
  };
  s.projectiles.onExplode = (x, y, z) => { s.combat.explodeAt(x, y, z, FIREBALL_POWER); };
  // Ovo quebrado: um em oito choca (doc 07 §1).
  s.projectiles.onEgg = (x, y, z) => {
    if (s.random() >= EGG_HATCH_CHANCE) return;
    const chicken = MOB_BY_NAME.get('chicken');
    if (chicken === undefined) return;
    const baby = s.mobs.spawn(chicken.id, x, Math.floor(y) + 0.5, z);
    if (baby >= 0) s.mobs.store.makeBaby(baby, GROW_TICKS);
  };
}

/**
 * Transforma os marcos deixados pelo gerador em coisas vivas: baú com loot,
 * gerador de monstros registrado e aldeão no lugar.
 *
 * Um baú que **já existe** (veio do save) não é reabastecido — é o que
 * impede duplicar loot recarregando o mundo.
 */
export function applyStructures(s: Session, chunk: ChunkColumn): void {
  for (const mark of chunk.structures) {
    if (mark.kind === 'chest') {
      s.tiles.fillLoot(mark.x, mark.y, mark.z, mark.data);
    } else if (mark.kind === 'spawner') {
      s.spawners.add(mark.x, mark.y, mark.z, mark.data);
    } else {
      const def = MOB_BY_NAME.get(mark.data);
      if (def !== undefined) s.mobs.store.spawn(def.id, mark.x + 0.5, mark.y, mark.z + 0.5);
    }
  }
  // Os marcos são consumidos uma vez; recarregar o chunk os regenera.
  chunk.structures.length = 0;
}
