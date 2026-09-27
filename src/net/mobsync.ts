/**
 * Mobs numa sala (M20): o anfitrião simula, o convidado só desenha.
 *
 * O anfitrião manda, a cada tick e pelo canal rápido, os mobs a até
 * `MOB_RADIUS` blocos de cada convidado: tipo, variante, posição, ângulos,
 * pernas e o que muda a cor (dano, pavio). O convidado não roda IA nem spawn
 * (`net/follower.ts`): o armazenamento de mobs dele vira marionete, reescrito
 * a cada pacote. A posição anterior é guardada pelo **índice do mob no
 * anfitrião**, para a interpolação do quadro continuar suave entre pacotes.
 *
 * Nada aqui aloca por tick: um escritor e tabelas de tamanho fixo.
 */

import { MobStore } from '../entity/mobstore';
import { MSG, PacketReader, type PacketWriter } from './protocol';

/** Até onde o convidado vê mob. Passa do alcance de visão de T0 com folga. */
export const MOB_RADIUS = 64;
/** Índices do anfitrião que a tabela de posição anterior aceita. */
const SLOTS = 1024;
const MAX_PER_PACKET = 255;

/** Anfitrião: o pacote de mobs perto de `(cx, cz)`. */
export function writeMobs(w: PacketWriter, store: MobStore, cx: number, cz: number): Uint8Array {
  w.reset(MSG.MOBS);
  const countAt = w.length;
  w.u8(0);
  let count = 0;
  const r2 = MOB_RADIUS * MOB_RADIUS;
  for (let i = 0; i < store.active && count < MAX_PER_PACKET; i++) {
    const dx = store.x[i] - cx;
    const dz = store.z[i] - cz;
    if (dx * dx + dz * dz > r2) continue;
    w.u16(i).u8(store.type[i]).u8(store.variant[i]).u8(store.flags[i])
      .f32(store.x[i]).f32(store.y[i]).f32(store.z[i])
      .f32(store.yaw[i]).f32(store.headYaw[i]).f32(store.pitch[i])
      .f32(store.limbSwing[i]).f32(store.limbAmount[i]).f32(store.scale[i])
      .u8(Math.min(255, Math.max(0, store.hurtTicks[i])))
      .i8(Math.max(-1, Math.min(127, store.fuse[i])))
      .u32(store.age[i]);
    count++;
  }
  const bytes = w.view8();
  bytes[countAt] = count;
  return bytes;
}

/** Convidado: o armazenamento de mobs como marionete. */
export class MobPuppets {
  private readonly lastX = new Float32Array(SLOTS);
  private readonly lastY = new Float32Array(SLOTS);
  private readonly lastZ = new Float32Array(SLOTS);
  private readonly lastYaw = new Float32Array(SLOTS);
  private readonly lastType = new Uint8Array(SLOTS);
  private readonly seen = new Uint32Array(SLOTS);
  private stamp = 1;
  /** O último pacote, aplicado no tick (e não na chegada). */
  private pending: Uint8Array | null = null;

  constructor(private readonly store: MobStore) {}

  receive(bytes: Uint8Array): void {
    // Uma cópia: o `ArrayBuffer` da mensagem pode ser reaproveitado.
    this.pending = bytes.slice();
  }

  /** Aplica o pacote mais novo, se chegou um desde o último tick. */
  tick(): void {
    const bytes = this.pending;
    if (bytes === null) return;
    this.pending = null;
    const store = this.store;
    const r = new PacketReader(bytes);
    r.u8();
    const count = r.u8();
    const previous = this.stamp;
    this.stamp++;
    store.clear();
    for (let n = 0; n < count; n++) {
      const slot = r.u16() % SLOTS;
      const type = r.u8();
      const variant = r.u8();
      const flags = r.u8();
      const x = r.f32(); const y = r.f32(); const z = r.f32();
      const yaw = r.f32(); const headYaw = r.f32(); const pitch = r.f32();
      const limbSwing = r.f32(); const limbAmount = r.f32(); const scale = r.f32();
      const hurt = r.u8(); const fuse = r.i8(); const age = r.u32();
      const i = store.spawn(type, x, y, z, variant);
      if (i < 0) break;
      const same = this.seen[slot] === previous && this.lastType[slot] === type;
      const near = same && Math.abs(this.lastX[slot] - x) + Math.abs(this.lastZ[slot] - z) < 4;
      if (near) {
        store.prevX[i] = this.lastX[slot];
        store.prevY[i] = this.lastY[slot];
        store.prevZ[i] = this.lastZ[slot];
        store.prevYaw[i] = this.lastYaw[slot];
      } else {
        store.prevYaw[i] = yaw;
      }
      store.yaw[i] = yaw; store.headYaw[i] = headYaw; store.pitch[i] = pitch;
      store.flags[i] = flags; store.hurtTicks[i] = hurt; store.fuse[i] = fuse;
      store.limbSwing[i] = limbSwing; store.limbAmount[i] = limbAmount; store.scale[i] = scale;
      store.age[i] = age;
      this.lastX[slot] = x; this.lastY[slot] = y; this.lastZ[slot] = z;
      this.lastYaw[slot] = yaw; this.lastType[slot] = type;
      this.seen[slot] = this.stamp;
    }
  }
}
