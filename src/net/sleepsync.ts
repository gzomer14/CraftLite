/**
 * Dormir numa sala (M20, doc 14: "o sono — todos na cama").
 *
 * Sozinho, a cama é instantânea: clicou à noite, amanhece (`game/blockuse.ts`).
 * Com gente na sala, clicar na cama **deita**: o jogador fica na cama por até
 * 30 s, ou até sair de perto dela, e a noite só passa quando todos estiverem
 * deitados ao mesmo tempo. Quem decide é o anfitrião — a noite é dele —, e o
 * convidado pede (`SLEEP`), ouve a situação (`SLEEP_STATE`) e acorda junto
 * (`WAKE`, com o tempo do mundo na mesma mensagem).
 *
 * As regras de sempre continuam: só de noite e sem monstro perto da cama (os
 * monstros são os do anfitrião, que é quem os tem).
 */

import { t, tf } from '../core/i18n';
import { trySleep } from '../game/sleep';
import { isBedAt } from '../world/multiblock';
import type { GameHandles } from '../game/netgate';
import type { Session } from '../game/session';
import { MSG, PacketWriter, type PacketReader } from './protocol';

/** Quanto tempo o jogador fica deitado esperando os outros. */
const IN_BED_TICKS = 600;
/** Afastar-se mais que isto da cama levanta. */
const LEAVE_BED = 3;

/** `SLEEP_STATE`: o que o anfitrião respondeu. */
export const SLEEP_WAITING = 0;
export const SLEEP_DAY = 1;
export const SLEEP_MONSTERS = 2;

interface InBed { x: number; y: number; z: number; until: number }

/** Quem conta para dormir: o anfitrião (`null`) e cada convidado. */
export interface Sleeper { x: number; y: number; z: number }

export class HostSleep<G extends Sleeper> {
  private readonly inBed = new Map<G | null, InBed>();
  private readonly w = new PacketWriter(32);
  private baseBed: ((x: number, y: number, z: number) => boolean) | null = null;
  private ticks = 0;

  constructor(
    private readonly game: GameHandles,
    private readonly guests: () => readonly G[],
    private readonly send: (g: G, bytes: Uint8Array) => void,
  ) {}

  install(): void {
    const { blockUse } = this.game.session;
    const base = blockUse.bed.bind(blockUse);
    this.baseBed = base;
    blockUse.bed = (x, y, z) => {
      // Sozinho na sala, a cama de sempre.
      if (this.guests().length === 0 || !isBedAt(this.game.world, x, y, z)) return base(x, y, z);
      const { session } = this.game;
      session.spawnX = x; session.spawnY = y + 1; session.spawnZ = z;
      const code = this.lieDown(null, x, y, z);
      this.game.hud.showMessage(sleepText(code, this.inBed.size, this.guests().length + 1), 80);
      return true;
    };
  }

  uninstall(): void {
    if (this.baseBed !== null) this.game.session.blockUse.bed = this.baseBed;
    this.inBed.clear();
  }

  /** `SLEEP`: o convidado clicou numa cama. */
  request(g: G, r: PacketReader): void {
    const x = r.i32(); const y = r.u16(); const z = r.i32();
    if (!isBedAt(this.game.world, x, y, z)) return;
    const code = this.lieDown(g, x, y, z);
    this.send(g, this.w.reset(MSG.SLEEP_STATE).u8(code).u8(this.inBed.size).u8(this.guests().length + 1).view8());
  }

  /** Saiu da sala: deixa de contar. */
  left(g: G): void {
    this.inBed.delete(g);
  }

  /** Um tick: quem saiu de perto da cama ou cansou de esperar, levanta. */
  tick(): void {
    this.ticks++;
    if (this.inBed.size === 0) return;
    const player = this.game.player;
    for (const [who, bed] of this.inBed) {
      const at = who === null ? player : who;
      const far = Math.abs(at.x - bed.x - 0.5) > LEAVE_BED || Math.abs(at.z - bed.z - 0.5) > LEAVE_BED;
      if (far || this.ticks > bed.until) this.inBed.delete(who);
    }
  }

  private lieDown(who: G | null, x: number, y: number, z: number): number {
    const session = this.game.session;
    const result = trySleep(session.dayNight.time, session.hostilesNear(x, y, z));
    if (!result.ok) return result.reason === 'day' ? SLEEP_DAY : SLEEP_MONSTERS;
    this.inBed.set(who, { x, y, z, until: this.ticks + IN_BED_TICKS });
    if (this.inBed.size >= this.guests().length + 1) this.wake(result.wakeTime);
    return SLEEP_WAITING;
  }

  private wake(wakeTime: number): void {
    const { session, hud } = this.game;
    session.dayNight.setTimeOfDay(wakeTime);
    wakeUp(session);
    hud.showMessage(t('msg.good_morning'), 80);
    const bytes = this.w.reset(MSG.WAKE).f64(session.dayNight.totalTicks).view8();
    for (const g of this.guests()) this.send(g, bytes);
    this.inBed.clear();
  }
}

/** O que acordar dá, dos dois lados: meio coração e a conquista. */
function wakeUp(session: Session): void {
  session.survival.health = Math.min(20, session.survival.health + 1);
  session.achievements.event('sleep');
}

/** A frase de cada resposta. */
export function sleepText(code: number, inBed: number, total: number): string {
  if (code === SLEEP_DAY) return t('msg.sleep_night');
  if (code === SLEEP_MONSTERS) return t('msg.sleep_monsters');
  return tf('net.sleep_waiting', inBed, total);
}

/** Convidado: a cama pede ao anfitrião; o anfitrião responde e acorda todos. */
export class GuestSleep {
  private readonly w = new PacketWriter(32);

  constructor(
    private readonly game: GameHandles,
    private readonly send: (bytes: Uint8Array) => void,
    private readonly onTime: (totalTicks: number) => void,
  ) {
    const { session, world } = game;
    const base = session.blockUse.bed.bind(session.blockUse);
    session.blockUse.bed = (x, y, z) => {
      if (!isBedAt(world, x, y, z)) return base(x, y, z);
      session.spawnX = x; session.spawnY = y + 1; session.spawnZ = z;
      this.send(this.w.reset(MSG.SLEEP).i32(x).u16(y).i32(z).view8());
      return true;
    };
  }

  /** `SLEEP_STATE`. */
  state(r: PacketReader): void {
    const code = r.u8(); const inBed = r.u8(); const total = r.u8();
    this.game.hud.showMessage(sleepText(code, inBed, total), 80);
  }

  /** `WAKE`: todos dormiram. */
  wake(r: PacketReader): void {
    this.onTime(r.f64());
    wakeUp(this.game.session);
    this.game.hud.showMessage(t('msg.good_morning'), 80);
  }
}
