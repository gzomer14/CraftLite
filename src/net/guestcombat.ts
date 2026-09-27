/**
 * Mobs e o convidado (M20), do lado dele: o golpe vai para o anfitrião, e o
 * dano e o saque voltam. Ver `net/hostcombat.ts`.
 *
 * Os mobs daqui são bonecos (`net/mobsync.ts`): ferir um deles aqui não
 * valeria nada — no próximo pacote ele volta inteiro. Por isso o `damage` da
 * instância, com causa `'player'` (espada, mão, flecha do arco), vira `ATTACK`
 * para o slot do mob no anfitrião.
 */

import type { Session } from '../game/session';
import type { MobPuppets } from './mobsync';
import type { Loot } from './hostcombat';
import { HURT_CAUSES, MSG, PacketWriter, type PacketReader } from './protocol';

export interface GuestCombat {
  /** `LOOT`: itens e XP do mob que o convidado matou, no chão daqui. */
  loot(r: PacketReader): void;
  /** `HURT`: o dano que o anfitrião mediu, pelo `hurtPlayer` de sempre, e o fogo. */
  hurt(r: PacketReader): void;
  /** `SPLASH`: um frasco quebrou perto; o `onPotion` daqui mede e aplica. */
  splash(r: PacketReader): void;
}

export function attachGuestCombat(
  session: Session, puppets: MobPuppets, send: (bytes: Uint8Array) => void,
): GuestCombat {
  const w = new PacketWriter(64);
  const { mobs } = session;
  mobs.damage = (i, amount, cause) => {
    if (cause !== 'player' || !(amount > 0) || i < 0 || i >= mobs.store.active) return false;
    const slot = puppets.hostSlot[i];
    if (slot < 0) return false;
    send(w.reset(MSG.ATTACK).u16(slot).u8(mobs.store.type[i]).f32(amount).u8(mobs.looting).view8());
    // A piscada vermelha na hora; a de verdade chega com o próximo pacote.
    mobs.store.hurtTicks[i] = 10;
    return false;
  };
  return {
    loot(r) {
      let loot: Loot;
      try {
        loot = JSON.parse(r.str()) as Loot;
      } catch {
        return;
      }
      for (const [x, y, z, stack] of loot.drops) {
        if (stack.item > 0 && stack.count > 0) session.items.spawn(x, y, z, stack);
      }
      if (loot.xp > 0) session.orbs.spawn(loot.at[0], loot.at[1], loot.at[2], loot.xp);
    },
    hurt(r) {
      const damage = r.f32(); const cause = HURT_CAUSES[r.u8()] ?? 'mob';
      const pushX = r.f32(); const pushZ = r.f32(); const fire = r.u16();
      if (damage > 0) session.combat.hurtPlayer(damage, cause, pushX, pushZ);
      if (fire > 0 && session.player.mode === 'survival') session.survival.ignite(fire);
    },
    splash(r) {
      const item = r.u16(); const x = r.f32(); const y = r.f32(); const z = r.f32();
      session.projectiles.onPotion?.(x, y, z, item);
    },
  };
}
