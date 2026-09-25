/**
 * O jogador batendo e apanhando: golpe corpo-a-corpo, escudo, armadura que
 * gasta e a explosão que machuca todo mundo em volta (doc 05 §2–§3, doc 07 §2,
 * doc 14 — M6).
 *
 * Saiu da `Session` em 2026-09-22 (M13). As fórmulas continuam em
 * `game/combat.ts` e `game/explosion.ts`; aqui fica quem as aplica ao jogador
 * e aos mobs.
 */

import type { Stats } from './stats';
import { AIR, defOf } from '../data/blocks';
import { itemDef, type ItemStack } from '../data/items';
import { mobDef } from '../data/mobs';
import { FEATHER_FALLING, LOOTING } from '../data/enchants';
import { blockSound } from '../audio/synth';
import {
  armorDurabilityCost, armorTotals, attackCooldownOf, attackDamageOf,
  HIT_KNOCKBACK, HIT_KNOCKBACK_UP, type ArmorTotals,
} from './combat';
import { levelOf, skipDurability } from './enchanting';
import { explode, explosionDamage } from './explosion';
import { ARMOR_END, ARMOR_START, type Inventory } from './inventory';
import { EXHAUSTION, type Survival } from './survival';
import type { Achievements } from './achievements';
import type { Mobs } from '../entity/mobs';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

/** Quanto o escudo apara de um golpe frontal. */
const SHIELD_REDUCTION = 0.75;
/** Dano do golpe no criativo: mais que a vida do mob mais resistente. */
const CREATIVE_ATTACK_DAMAGE = 1000;

export interface CombatHost {
  readonly world: World;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly survival: Survival;
  readonly mobs: Mobs;
  readonly achievements: Achievements;
  /** Contadores do jogador (M10). */
  readonly stats?: Stats;
  /** Escudo levantado agora (uso de segurar, `game/itemuse.ts`). */
  isBlocking(): boolean;
  sound(name: string, x: number, y: number, z: number): void;
  /** Um bloco saiu por explosão ou por mob: luz, contêiner e fluido. */
  blockRemoved(x: number, y: number, z: number, previous: number): void;
  drop(stack: ItemStack, x: number, y: number, z: number): void;
}

export class PlayerCombat {
  private readonly host: CombatHost;
  /** Ticks até o próximo golpe poder sair (doc 05 §2). */
  private cooldown = 0;
  /** Soma da armadura equipada, recalculada a cada tick. */
  readonly armor: ArmorTotals = { defense: 0, toughness: 0, protection: 0 };

  constructor(host: CombatHost) {
    this.host = host;
  }

  tick(): void {
    if (this.cooldown > 0) this.cooldown--;
    this.syncArmor();
  }

  /** Mantém a soma da armadura em sincronia com os slots equipados. */
  syncArmor(): void {
    const { inventory, survival } = this.host;
    armorTotals(inventory.slots, this.armor);
    survival.armor = this.armor.defense;
    survival.armorToughness = this.armor.toughness;
    survival.protection = this.armor.protection;
    // A bota é a última peça da faixa de armadura (ver `armorSlotIndex`).
    survival.featherFalling = levelOf(inventory.get(ARMOR_END - 1), FEATHER_FALLING);
  }

  /**
   * Ataque corpo-a-corpo na direção do olhar (doc 05 §2, doc 07 §2).
   *
   * Devolve true se havia um mob no caminho — o chamador usa isso para **não**
   * quebrar o bloco atrás dele. O cooldown é do item na mão: espada bate mais
   * rápido que machado.
   */
  attackAlong(dx: number, dy: number, dz: number): boolean {
    const { player, inventory, mobs } = this.host;
    const eyeY = player.y + player.eyeHeight;
    const index = mobs.pickTarget(player.x, eyeY, player.z, dx, dy, dz, player.reach);
    if (index < 0) return false;
    if (this.cooldown > 0) return true;

    const held = inventory.held;
    // No criativo o golpe mata de uma vez, como manda o modo: o jogador ali
    // está editando o mundo, não lutando com ele.
    // Força e Fraqueza (M16) somam ao golpe; o golpe nunca fica negativo.
    const damage = player.mode === 'creative'
      ? CREATIVE_ATTACK_DAMAGE
      : Math.max(0, attackDamageOf(held) + this.host.survival.effects.attackBonus());
    this.cooldown = attackCooldownOf(held);
    this.host.survival.addExhaustion(EXHAUSTION.attack);

    const store = mobs.store;
    const px = store.x[index] - player.x;
    const pz = store.z[index] - player.z;
    const length = Math.hypot(px, pz) || 1;

    this.host.sound('player/hit', store.x[index], store.centerY(index), store.z[index]);
    // Pilhagem é do golpe, não do mob: a espada em mãos no momento da morte é
    // que decide o drop extra.
    mobs.looting = levelOf(held, LOOTING);
    const type = store.type[index];
    const died = mobs.damage(index, damage, 'player');
    mobs.looting = 0;
    if (died) {
      this.host.achievements.kill(mobDef(type).name);
      this.host.stats?.add('mobs_killed');
    }
    if (!died && mobDef(type).traits.noKnockback !== true) {
      // Empurrão só depois do dano: se ele morreu, este índice já é outro mob.
      store.vx[index] += (px / length) * HIT_KNOCKBACK;
      store.vz[index] += (pz / length) * HIT_KNOCKBACK;
      if (store.onGround[index] === 1) store.vy[index] = HIT_KNOCKBACK_UP;
    }

    // A arma gasta durabilidade ao acertar, não ao quebrar bloco.
    const def = held === null ? undefined : itemDef(held.item);
    if (player.mode === 'survival' && def?.durability !== undefined
      && !skipDurability(held, Math.random())) {
      inventory.damageHeld(1, def.durability);
    }
    return true;
  }

  /** Dano no jogador com empurrão. Usado por mob, flecha e explosão. */
  hurtPlayer(
    amount: number, cause: 'mob' | 'arrow' | 'explosion', pushX: number, pushZ: number,
  ): void {
    const { player, survival } = this.host;
    if (player.mode !== 'survival') return;
    // Escudo levantado: o golpe que vem de frente perde a maior parte da força
    // e gasta durabilidade da peça (doc 14 — M6).
    let damage = amount;
    if (this.host.isBlocking() && this.facesAttack(pushX, pushZ)) {
      damage *= 1 - SHIELD_REDUCTION;
      this.damageShield();
    }
    if (!survival.damage(damage, cause)) return;
    player.vx += pushX;
    player.vz += pushZ;
    if (player.onGround) player.vy = HIT_KNOCKBACK_UP;
  }

  /**
   * true se o golpe veio de frente. O empurrão aponta **para longe** do
   * atacante, então o produto escalar com o olhar é negativo quando ele está
   * na cara do jogador.
   */
  private facesAttack(pushX: number, pushZ: number): boolean {
    if (pushX === 0 && pushZ === 0) return true;
    const yaw = this.host.player.yaw;
    return -Math.sin(yaw) * pushX + Math.cos(yaw) * pushZ < 0;
  }

  /** O escudo que aparou o golpe gasta durabilidade. */
  private damageShield(): void {
    const inventory = this.host.inventory;
    const held = inventory.held;
    const def = held === null ? undefined : itemDef(held.item);
    if (def?.durability === undefined) return;
    if (skipDurability(held, Math.random())) return;
    inventory.damageHeld(1, def.durability);
  }

  /** Gasta durabilidade das peças equipadas (doc 05 §3). */
  damageArmor(damage: number): void {
    const { player, inventory } = this.host;
    if (player.mode !== 'survival') return;
    const cost = armorDurabilityCost(damage);
    for (let i = ARMOR_START; i < ARMOR_END; i++) {
      const stack = inventory.get(i);
      if (stack === null) continue;
      const durability = itemDef(stack.item)?.durability;
      if (durability === undefined) continue;
      if (skipDurability(stack, Math.random())) continue;
      stack.damage += cost;
      if (stack.damage >= durability) inventory.set(i, null);
    }
    this.syncArmor();
  }

  /**
   * Um mob derrubou um bloco (zumbi arrombando porta, doc 06 §10). Não dropa
   * item: a porta arrombada some, como no original.
   */
  breakBlockByMob(x: number, y: number, z: number): void {
    const world = this.host.world;
    const previous = world.getBlock(x, y, z);
    if (previous === AIR) return;
    if (!world.setBlock(x, y, z, AIR, 'physics')) return;
    this.host.blockRemoved(x, y, z, previous);
    this.host.sound(blockSound(defOf(previous).sound, 'break'), x, y, z);
  }

  /** Explosão de creeper, TNT ou bola de fogo: quebra blocos e machuca em volta. */
  explodeAt(x: number, y: number, z: number, power: number): void {
    const host = this.host;
    host.sound('player/explode', x, y, z);
    explode(host.world, x, y, z, power, {
      onBlockRemoved: (bx, by, bz, previous) => { host.blockRemoved(bx, by, bz, previous); },
      onDrop: (stack, dx, dy, dz) => { host.drop(stack, dx, dy, dz); },
      onDamage: (strength, ex, ey, ez, radius) => {
        const player = host.player;
        const dx = player.x - ex;
        const dy = player.y + player.height * 0.5 - ey;
        const dz = player.z - ez;
        const damage = explosionDamage(strength, Math.sqrt(dx * dx + dy * dy + dz * dz), radius);
        if (damage > 0) {
          const length = Math.hypot(dx, dz) || 1;
          this.hurtPlayer(damage, 'explosion', (dx / length) * 0.6, (dz / length) * 0.6);
        }
        // A explosão também machuca os outros mobs — inclusive o bando todo.
        const store = host.mobs.store;
        for (let i = 0; i < store.active; i++) {
          const mx = store.x[i] - ex;
          const my = store.centerY(i) - ey;
          const mz = store.z[i] - ez;
          const mobDamage = explosionDamage(strength, Math.sqrt(mx * mx + my * my + mz * mz), radius);
          if (mobDamage > 0 && host.mobs.damage(i, mobDamage, 'fire')) i--;
        }
      },
    });
  }
}
