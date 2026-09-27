/**
 * Mobs e convidados no anfitrião (M20): quem apanha e quem bate.
 *
 * - **O mob mira o jogador mais perto**, anfitrião ou convidado: a sala dá a
 *   `Mobs.others` a lista dos convidados (posição, item na mão, se é alvo).
 *   Sem sala a lista é `null` e o mob faz o que sempre fez.
 * - **O convidado apanha no aparelho dele.** Golpe de mob, flecha e explosão
 *   aqui viram `HURT`, e lá o `hurtPlayer` de sempre aplica escudo, armadura e
 *   vida — a vida do convidado é dele (como o inventário, doc 15 §5).
 * - **O convidado bate pelo anfitrião.** O golpe dele chega como `ATTACK`, com
 *   o slot do mob aqui; o dano, o empurrão e a morte acontecem aqui, e o que o
 *   mob deixa — itens e XP — vai de volta para ele (`LOOT`), e não para o chão
 *   daqui, onde ele não veria.
 *
 * Tudo por sobrescrita na instância (como o M21 e o `follower.ts`): fechada a
 * sala, `uninstall` devolve o de antes.
 */

import { mobDef } from '../data/mobs';
import { HIT_KNOCKBACK, HIT_KNOCKBACK_UP } from '../game/combat';
import { explosionDamage } from '../game/explosion';
import { FLAG_IGNITES, FLAG_POTION } from '../entity/projectile';
import type { MobEvents, PlayerView } from '../entity/mobs';
import type { ItemStack } from '../data/items';
import type { GameHandles } from '../game/netgate';
import type { Guest } from './host';
import { HURT_CAUSES, MOVE_UNTARGETABLE, MSG, PacketWriter, type PacketReader } from './protocol';

/** Meia largura do convidado para a flecha, como a do jogador daqui. */
const HIT_RADIUS = 0.7;
const GUEST_HEIGHT = 1.8;
/** Golpe de um convidado mais longe que isto do mob é recusado (arco incluído). */
const ATTACK_RANGE = 64;

/** `LOOT`: o que cai para o convidado, com encantamento e nome (baú quebrado). */
export interface Loot {
  drops: [number, number, number, ItemStack][];
  xp: number;
  at: [number, number, number];
}

type Hit = (x: number, y: number, z: number, damage: number, fromPlayer: boolean, flags: number) => boolean;

export class HostCombat {
  /** Alinhadas: `views[k]` é o que os mobs veem de `owners[k]`. */
  private readonly views: PlayerView[] = [];
  private readonly owners: Guest[] = [];
  private readonly w = new PacketWriter(256);
  private baseHit: Hit | null = null;
  private baseExplode: ((x: number, y: number, z: number, power: number) => void) | null = null;

  constructor(
    private readonly game: GameHandles,
    private readonly send: (g: Guest, bytes: Uint8Array) => void,
  ) {}

  install(): void {
    const { mobs, projectiles, combat } = this.game.session;
    mobs.others = this.views;
    mobs.onHitOther = (k, damage, pushX, pushZ) => this.hurt(this.owners[k], damage, 0, pushX, pushZ);
    const hit = projectiles.onHit;
    this.baseHit = hit;
    projectiles.onHit = (x, y, z, damage, fromPlayer, flags) =>
      (!fromPlayer && this.arrowHitsGuest(x, y, z, damage, flags)) || (hit?.(x, y, z, damage, fromPlayer, flags) ?? false);
    const explode = combat.explodeAt.bind(combat);
    this.baseExplode = explode;
    combat.explodeAt = (x, y, z, power) => {
      explode(x, y, z, power);
      this.blast(x, y, z, power);
    };
  }

  uninstall(): void {
    const { mobs, projectiles, combat } = this.game.session;
    mobs.others = null;
    mobs.onHitOther = null;
    projectiles.onHit = this.baseHit;
    if (this.baseExplode !== null) combat.explodeAt = this.baseExplode;
  }

  /** Quem está dentro mudou: refaz a lista que os mobs leem. */
  refresh(ready: readonly Guest[]): void {
    const old = new Map<Guest, PlayerView>();
    for (let k = 0; k < this.owners.length; k++) old.set(this.owners[k], this.views[k]);
    this.owners.length = 0;
    this.views.length = 0;
    for (const g of ready) {
      this.owners.push(g);
      this.views.push(old.get(g) ?? { x: g.x, y: g.y, z: g.z, eyeY: g.y + 1.62, held: -1, alive: false });
    }
  }

  /** Um `MOVE` do convidado. */
  moved(g: Guest, flags: number, held: number): void {
    const k = this.owners.indexOf(g);
    if (k < 0) return;
    const v = this.views[k];
    v.x = g.x; v.y = g.y; v.z = g.z; v.eyeY = g.y + 1.62;
    v.held = held === 0xffff ? -1 : held;
    v.alive = (flags & MOVE_UNTARGETABLE) === 0;
  }

  /** `ATTACK`: slot do mob aqui, tipo (confere que é o mesmo), dano, pilhagem. */
  attack(g: Guest, r: PacketReader): void {
    const slot = r.u16(); const type = r.u8(); const damage = r.f32(); const looting = r.u8();
    const { mobs } = this.game.session;
    const store = mobs.store;
    if (slot >= store.active || store.type[slot] !== type || !(damage > 0) || damage > 1000) return;
    const px = store.x[slot] - g.x;
    const pz = store.z[slot] - g.z;
    if (px * px + pz * pz > ATTACK_RANGE * ATTACK_RANGE) return;

    const mx = store.x[slot]; const my = store.centerY(slot); const mz = store.z[slot];
    // O que morrer deste golpe é do convidado: desvia drop e XP para ele.
    const events = (mobs as unknown as { events: MobEvents }).events;
    const onDrop = events.onDrop;
    const onXp = events.onXp;
    const loot: Loot['drops'] = [];
    let xp = 0;
    events.onDrop = (item, count, x, y, z) => { loot.push([x, y, z, { item, count, damage: 0 }]); };
    events.onXp = (amount) => { xp += amount; };
    mobs.looting = looting;
    let died: boolean;
    try {
      died = mobs.damage(slot, damage, 'player');
    } finally {
      mobs.looting = 0;
      events.onDrop = onDrop;
      events.onXp = onXp;
    }
    if (!died && mobDef(type).traits.noKnockback !== true) {
      const length = Math.hypot(px, pz) || 1;
      store.vx[slot] += (px / length) * HIT_KNOCKBACK;
      store.vz[slot] += (pz / length) * HIT_KNOCKBACK;
      if (store.onGround[slot] === 1) store.vy[slot] = HIT_KNOCKBACK_UP;
    }
    this.loot(g, { drops: loot, xp, at: [mx, my, mz] });
  }

  /** Itens e XP que são do convidado: vão para o chão dele. */
  loot(g: Guest, loot: Loot): void {
    if (loot.drops.length === 0 && loot.xp === 0) return;
    this.send(g, this.w.reset(MSG.LOOT).str(JSON.stringify(loot)).view8());
  }

  private hurt(g: Guest | undefined, damage: number, cause: number, pushX: number, pushZ: number): void {
    if (g === undefined || damage <= 0) return;
    this.send(g, this.w.reset(MSG.HURT).f32(damage).u8(cause).f32(pushX).f32(pushZ).view8());
  }

  /** Flecha, bola de fogo ou frasco de mob no corpo de um convidado. */
  private arrowHitsGuest(x: number, y: number, z: number, damage: number, flags: number): boolean {
    for (let k = 0; k < this.views.length; k++) {
      const v = this.views[k];
      if (!v.alive) continue;
      const dx = x - v.x;
      const dy = y - (v.y + GUEST_HEIGHT * 0.5);
      const dz = z - v.z;
      if (Math.abs(dx) >= HIT_RADIUS || Math.abs(dz) >= HIT_RADIUS || Math.abs(dy) >= GUEST_HEIGHT * 0.5 + 0.2) continue;
      // O frasco da bruxa não fere no golpe (o efeito é de quem o bebe) e a
      // bola do blaze só queima: nenhum dos dois atravessa a rede ainda.
      if ((flags & (FLAG_POTION | FLAG_IGNITES)) === 0) {
        const length = Math.hypot(dx, dz) || 1;
        this.hurt(this.owners[k], damage, HURT_CAUSES.indexOf('arrow'), (-dx / length) * 0.2, (-dz / length) * 0.2);
      }
      return true;
    }
    return false;
  }

  /** A explosão daqui alcança os convidados também (`game/explosion.ts`). */
  private blast(x: number, y: number, z: number, power: number): void {
    const radius = power * 1.3;
    for (let k = 0; k < this.views.length; k++) {
      const v = this.views[k];
      if (!v.alive) continue;
      const dx = v.x - x;
      const dy = v.y + GUEST_HEIGHT * 0.5 - y;
      const dz = v.z - z;
      const damage = explosionDamage(power, Math.sqrt(dx * dx + dy * dy + dz * dz), radius);
      if (damage <= 0) continue;
      const length = Math.hypot(dx, dz) || 1;
      this.hurt(this.owners[k], damage, HURT_CAUSES.indexOf('explosion'), (dx / length) * 0.6, (dz / length) * 0.6);
    }
  }
}
