/**
 * A montagem dos sistemas da sessão (saiu do construtor de `session.ts` no
 * M18): cada fábrica recebe a sessão e liga o sistema a ela. Os ganchos são
 * chamados depois, com a sessão inteira de pé — por isso podem ler qualquer
 * campo; o que cada fábrica lê **na hora** tem de ter nascido antes dela no
 * construtor.
 */

import { AIR } from '../data/blocks';
import { BlockUse } from './blockuse';
import { DragonFight } from './dragonfight';
import { ItemUser } from './itemuser';
import { PlayerCombat } from './playercombat';
import { Trading } from './trading';
import { Travel } from './travel';
import { Villages } from './village';
import { Workbench } from './workbench';
import type { Session, SessionEvents } from './session';

export function buildTravel(s: Session, events: SessionEvents): Travel {
  return new Travel(s.world, {
    // A travessia entra pelo mesmo caminho que o save e o renascimento.
    onDimensionChange: (dimension, x, z) => { s.enterDimension(dimension, x, z); },
    onArrive: (x, y, z, route) => {
      s.player.setPosition(x, y, z);
      s.player.vx = 0; s.player.vy = 0; s.player.vz = 0;
      s.player.fallDistance = 0;
      s.arrived(route);
    },
    onMessage: (text) => events.onMessage?.(text),
    // Portal de passagem (M19): o jogador vai já, e o anel de chunks com ele.
    onTeleport: (x, z) => { s.player.setPosition(x + 0.5, s.player.y, z + 0.5); },
    homePoint: () => (s.spawnY >= 0
      ? [s.spawnX, s.spawnY, s.spawnZ]
      : [s.worldSpawnX, -1, s.worldSpawnZ]),
    blockChanged: (x, y, z, previous, state) => { s.lighting.onBlockChanged(x, y, z, previous, state); },
  });
}

export function buildWorkbench(s: Session, events: SessionEvents): Workbench {
  return new Workbench({
    world: s.world, player: s.player, inventory: s.inventory, recipes: s.recipes, tiles: s.tiles,
    xp: s.xp, achievements: s.achievements, stats: s.journal.stats,
    onOpenScreen: (screen, container) => {
      // Qualquer tela que não seja a de troca solta o aldeão que negociava.
      if (screen !== 'trading') s.villages.stopTrading();
      events.onOpenScreen(screen, container);
    },
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    dropItem: (stack) => { s.dropItem(stack); },
    noteObtained: (item) => { s.noteObtained(item); },
    spawnOrb: (x, y, z, amount) => { s.orbs.spawn(x, y, z, amount); },
  });
}

export function buildDragonFight(s: Session, events: SessionEvents): DragonFight {
  return new DragonFight({
    world: s.world, mobs: s.mobs,
    blockChanged: (x, y, z, previous, state) => { s.lighting.onBlockChanged(x, y, z, previous, state); },
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    message: (text) => { events.onMessage?.(text); },
    achievement: (name) => { s.achievements.event(name); },
    player: s.player,
    hurtPlayer: (amount) => { s.combat.hurtPlayer(amount, 'breath', 0, 0); },
  });
}

export function buildBlockUse(s: Session, events: SessionEvents): BlockUse {
  return new BlockUse({
    world: s.world, survival: s.survival, dayNight: s.dayNight, achievements: s.achievements,
    mobs: s.mobs.store,
    changed: (x, y, z, previous, state) => {
      s.lighting.onBlockChanged(x, y, z, previous, state);
    },
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    message: (text) => { events.onMessage?.(text); },
    setSpawn: (x, y, z) => { s.spawnX = x; s.spawnY = y; s.spawnZ = z; },
  });
}

export function buildVillages(s: Session, events: SessionEvents): Villages {
  return new Villages({
    world: s.world, mobs: s.mobs.store, seed: s.world.seed,
    totalTicks: () => s.dayNight.totalTicks,
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    message: (text) => { events.onMessage?.(text); },
    toggleDoor: (x, y, z) => { s.blockUse.toggle(x, y, z); },
    makeRoom: () => s.mobs.makeRoom(s.player.x, s.player.z),
  });
}

export function buildTrading(s: Session, events: SessionEvents): Trading {
  return new Trading({
    mobs: s.mobs.store, inventory: s.inventory,
    day: () => s.dayNight.day,
    creative: () => s.player.mode === 'creative',
    dropItem: (stack) => { s.dropItem(stack); },
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    noteObtained: (item) => { s.noteObtained(item); },
  });
}

export function buildCombat(s: Session, events: SessionEvents): PlayerCombat {
  return new PlayerCombat({
    world: s.world, player: s.player, inventory: s.inventory, survival: s.survival, mobs: s.mobs,
    achievements: s.achievements, stats: s.journal.stats,
    isBlocking: () => s.isBlocking,
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    blockRemoved: (x, y, z, previous) => {
      s.lighting.onBlockChanged(x, y, z, previous, AIR);
      s.removeContainerAt(x, y, z);
      s.fluids.scheduleAround(x, y, z);
    },
    drop: (stack, x, y, z) => { s.items.spawn(x, y, z, stack); },
  });
}

export function buildItemUser(s: Session, events: SessionEvents): ItemUser {
  return new ItemUser({
    world: s.world, player: s.player, inventory: s.inventory, survival: s.survival,
    projectiles: s.projectiles, mobs: s.mobs.store,
    random: () => s.random(),
    blockChanged: (x, y, z, previous, state) => {
      s.lighting.onBlockChanged(x, y, z, previous, state);
      s.fluids.scheduleAround(x, y, z);
    },
    sound: (name, x, y, z) => { events.onSound?.(name, x, y, z); },
    drop: (stack, x, y, z) => { s.items.spawn(x, y, z, stack); },
    wearHeld: () => { s.damageTool(); },
    target: () => s.interaction.state.target,
    aim: s.interaction.aim,
    vehicles: s.vehicles,
    fire: s.fire,
    achievement: (name) => { s.achievements.event(name); },
    openMap: () => { events.onOpenMap?.(); },
    fishing: s.fishing,
    spawnXp: (x, y, z, amount) => { s.orbs.spawn(x, y, z, amount); },
    caughtFish: () => { s.journal.stats.add('fish_caught'); },
  });
}
