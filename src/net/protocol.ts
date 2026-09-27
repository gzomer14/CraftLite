/**
 * Protocolo da sala na rede local (M20, doc 12 §4).
 *
 * Todo pacote é `u8 tipo | carga`, em `DataView`, big-endian. Nada de JSON no
 * caminho quente: posição e mobs vão a cada tick. O único JSON é o save do
 * convidado, que viaja a cada 10 s e é o próprio `PlayerSave` do banco.
 *
 * Canais (`net/link.ts`): o confiável leva tudo que não pode se perder (blocos,
 * chunks, entrada e saída de jogador, save); o rápido, sem retransmissão, leva
 * posição e mobs, onde um pacote velho não vale nada.
 */

export const PROTOCOL = 1;

export const MSG = {
  /** Convidado → anfitrião: versão, conteúdo, nome, id estável, mods. */
  HELLO: 0x01,
  /** Anfitrião → convidado: o mundo, o convidado salvo e quem está dentro. */
  WELCOME: 0x02,
  /** Anfitrião → convidado: não entra (versão, sala cheia, mods). */
  REFUSE: 0x03,
  /** Qualquer lado: saiu. */
  BYE: 0x04,
  CHUNK_REQ: 0x10,
  CHUNK: 0x11,
  /**
   * Mudanças de bloco em lote. Do convidado: pedido, com a posição dele na frente;
   * do anfitrião: fato.
   */
  BLOCKS: 0x12,
  /** Anfitrião → convidado: o pedido não valeu, volte ao estado anterior. */
  BLOCK_DENY: 0x13,
  MOVE: 0x20,
  JOIN: 0x21,
  LEAVE: 0x22,
  MOBS: 0x30,
  SAVE: 0x40,
  TIME: 0x50,
} as const;

/** Por que o anfitrião recusou. */
export const REFUSE = { VERSION: 1, FULL: 2, MODS: 3, CLOSED: 4, KICKED: 5 } as const;

/** Bits de `MOVE.flags`. */
export const MOVE_SNEAK = 1;
export const MOVE_FLYING = 2;
export const MOVE_SWING = 4;
/** O anfitrião está fora da superfície: o boneco dele some da sala. */
export const MOVE_AWAY = 8;

/** Escritor com buffer próprio, reusado: sem alocação por mensagem de tick. */
export class PacketWriter {
  private buf: Uint8Array;
  private view: DataView;
  private at = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  reset(type: number): this {
    this.at = 0;
    return this.u8(type);
  }

  private room(n: number): void {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this { this.room(1); this.view.setUint8(this.at, v); this.at += 1; return this; }
  i8(v: number): this { this.room(1); this.view.setInt8(this.at, v); this.at += 1; return this; }
  u16(v: number): this { this.room(2); this.view.setUint16(this.at, v); this.at += 2; return this; }
  u32(v: number): this { this.room(4); this.view.setUint32(this.at, v >>> 0); this.at += 4; return this; }
  i32(v: number): this { this.room(4); this.view.setInt32(this.at, v); this.at += 4; return this; }
  f32(v: number): this { this.room(4); this.view.setFloat32(this.at, v); this.at += 4; return this; }
  f64(v: number): this { this.room(8); this.view.setFloat64(this.at, v); this.at += 8; return this; }

  bytes(data: Uint8Array): this {
    this.room(data.length);
    this.buf.set(data, this.at);
    this.at += data.length;
    return this;
  }

  /** Texto UTF-8 com o tamanho em u16 na frente. */
  str(s: string): this {
    const data = ENCODER.encode(s);
    return this.u16(data.length).bytes(data);
  }

  /** Posição atual, para reescrever um contador depois (`patchU16`). */
  get length(): number {
    return this.at;
  }

  patchU16(at: number, v: number): void {
    this.view.setUint16(at, v);
  }

  /** Os bytes escritos. **Vista** do buffer: mande antes de escrever de novo. */
  view8(): Uint8Array {
    return this.buf.subarray(0, this.at);
  }
}

export class PacketReader {
  private readonly view: DataView;
  private at = 0;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.length - this.at;
  }

  private need(n: number): void {
    if (this.at + n > this.data.length) throw new RangeError('pacote curto');
  }

  u8(): number { this.need(1); return this.view.getUint8(this.at++); }
  i8(): number { this.need(1); return this.view.getInt8(this.at++); }
  u16(): number { this.need(2); const v = this.view.getUint16(this.at); this.at += 2; return v; }
  u32(): number { this.need(4); const v = this.view.getUint32(this.at); this.at += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.at); this.at += 4; return v; }
  f32(): number { this.need(4); const v = this.view.getFloat32(this.at); this.at += 4; return v; }
  f64(): number { this.need(8); const v = this.view.getFloat64(this.at); this.at += 8; return v; }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  rest(): Uint8Array {
    return this.bytes(this.remaining);
  }

  str(): string {
    return DECODER.decode(this.bytes(this.u16()));
  }
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// --- mensagens de entrada ------------------------------------------------------

export interface Hello {
  protocol: number;
  content: number;
  name: string;
  playerId: string;
  mods: string[];
}

export function writeHello(w: PacketWriter, h: Hello): Uint8Array {
  return w.reset(MSG.HELLO).u16(h.protocol).u32(h.content).str(h.name).str(h.playerId)
    .str(h.mods.join(',')).view8();
}

export function readHello(r: PacketReader): Hello {
  const protocol = r.u16();
  const content = r.u32();
  const name = r.str();
  const playerId = r.str();
  const mods = r.str();
  return { protocol, content, name, playerId, mods: mods === '' ? [] : mods.split(',') };
}

export interface Welcome {
  netId: number;
  worldId: string;
  worldName: string;
  seed: string;
  seedHash: number;
  creative: boolean;
  difficulty: number;
  spawn: [number, number, number];
  totalTicks: number;
  /** O convidado como o anfitrião o guardou (`PlayerSave` em JSON), ou `''`. */
  saved: string;
  players: { netId: number; name: string }[];
}

export function writeWelcome(w: PacketWriter, m: Welcome): Uint8Array {
  w.reset(MSG.WELCOME).u8(m.netId).str(m.worldId).str(m.worldName).str(m.seed).u32(m.seedHash)
    .u8(m.creative ? 1 : 0).u8(m.difficulty)
    .i32(m.spawn[0]).i32(m.spawn[1]).i32(m.spawn[2]).f64(m.totalTicks).str(m.saved)
    .u8(m.players.length);
  for (const p of m.players) w.u8(p.netId).str(p.name);
  return w.view8();
}

export function readWelcome(r: PacketReader): Welcome {
  const netId = r.u8();
  const worldId = r.str();
  const worldName = r.str();
  const seed = r.str();
  const seedHash = r.u32();
  const creative = r.u8() === 1;
  const difficulty = r.u8();
  const spawn: [number, number, number] = [r.i32(), r.i32(), r.i32()];
  const totalTicks = r.f64();
  const saved = r.str();
  const count = r.u8();
  const players: { netId: number; name: string }[] = [];
  for (let i = 0; i < count; i++) players.push({ netId: r.u8(), name: r.str() });
  return { netId, worldId, worldName, seed, seedHash, creative, difficulty, spawn, totalTicks, saved, players };
}

/**
 * Impressão digital do conteúdo: nomes de bloco e item, na ordem dos ids, e os
 * mods ligados. Dois aparelhos com builds diferentes teriam o id 245 como
 * blocos diferentes — e o mundo de um viraria lixo no outro.
 */
export function contentHash(names: readonly string[]): number {
  let h = 0x811c9dc5 ^ PROTOCOL;
  for (const name of names) {
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x2c, 0x01000193);
  }
  return h >>> 0;
}
