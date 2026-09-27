/**
 * A sala na rede local sem navegador (M20): o protocolo, os mobs vistos pelo
 * convidado, e o anfitrião de verdade — com um mundo de verdade e ligações
 * falsas no lugar do WebRTC.
 *
 * A ligação real, com dois Chrome jogando juntos, é `npm run smoke:room`.
 */
import { describe, expect, it } from 'vitest';
import {
  MSG, PROTOCOL, PacketReader, PacketWriter, REFUSE, contentHash, readHello, readWelcome, writeHello, writeWelcome,
} from '../src/net/protocol';
import { MobPuppets, writeMobs, MOB_RADIUS } from '../src/net/mobsync';
import { HostRoom, REACH, type Guest } from '../src/net/host';
import { localContent } from '../src/net/identity';
import { MobStore } from '../src/entity/mobstore';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { STONE, makeState } from '../src/data/blocks';
import { deserializeChunk } from '../src/save/serialize';
import type { GameHandles } from '../src/game/netgate';

describe('protocolo', () => {
  it('HELLO e WELCOME vão e voltam, com acento e emoji no nome', () => {
    const w = new PacketWriter(8);
    const hello = { protocol: PROTOCOL, content: 0xdeadbeef, name: 'Júlia 🌵', playerId: '0123456789abcdef', mods: ['exemplo'] };
    const hb = writeHello(w, hello);
    const hr = new PacketReader(hb.slice());
    expect(hr.u8()).toBe(MSG.HELLO);
    expect(readHello(hr)).toEqual(hello);
    const welcome = {
      netId: 3, worldId: 'w', worldName: 'Vila', seed: 'abc', seedHash: 123456, creative: true, difficulty: 2,
      spawn: [10, 64, -20] as [number, number, number], totalTicks: 48123.5, saved: '{"x":1}',
      players: [{ netId: 0, name: 'Anfitrião' }, { netId: 2, name: 'Bia' }],
    };
    const wr = new PacketReader(writeWelcome(w, welcome).slice());
    expect(wr.u8()).toBe(MSG.WELCOME);
    expect(readWelcome(wr)).toEqual(welcome);
  });

  it('pacote curto dá erro, e não lixo', () => {
    const r = new PacketReader(Uint8Array.from([MSG.MOVE, 1, 2]));
    r.u8();
    expect(() => r.f32()).toThrow(RangeError);
  });

  it('a impressão digital do conteúdo muda com um nome, e só com ele', () => {
    const a = contentHash(['air', 'stone', 'dirt']);
    expect(contentHash(['air', 'stone', 'dirt'])).toBe(a);
    expect(contentHash(['air', 'stone', 'grass'])).not.toBe(a);
    expect(contentHash(['air', 'stonedirt'])).not.toBe(a);
  });
});

describe('mobs do convidado', () => {
  it('o convidado recebe só os mobs perto dele, com posição e ângulos', () => {
    const host = new MobStore(16);
    const near = host.spawn(0, 10, 64, 10);
    host.yaw[near] = 1.25;
    host.hurtTicks[near] = 5;
    host.spawn(0, 10 + MOB_RADIUS * 2, 64, 10);
    const guest = new MobStore(16);
    const puppets = new MobPuppets(guest);
    puppets.receive(writeMobs(new PacketWriter(), host, 0, 0));
    puppets.tick();
    expect(guest.active).toBe(1);
    expect(guest.x[0]).toBeCloseTo(10);
    expect(guest.yaw[0]).toBeCloseTo(1.25);
    expect(guest.hurtTicks[0]).toBe(5);
  });

  it('entre dois pacotes, a posição anterior fica para o quadro interpolar', () => {
    const host = new MobStore(8);
    const i = host.spawn(0, 0, 64, 0);
    const guest = new MobStore(8);
    const puppets = new MobPuppets(guest);
    const w = new PacketWriter();
    puppets.receive(writeMobs(w, host, 0, 0));
    puppets.tick();
    host.x[i] = 0.3;
    puppets.receive(writeMobs(w, host, 0, 0));
    puppets.tick();
    expect(guest.prevX[0]).toBeCloseTo(0);
    expect(guest.x[0]).toBeCloseTo(0.3);
    // Sem pacote novo, o tick não mexe em nada.
    puppets.tick();
    expect(guest.x[0]).toBeCloseTo(0.3);
  });
});

// --- o anfitrião com ligações falsas -------------------------------------------------

interface FakeLink {
  sent: Uint8Array[];
  isOpen: boolean;
  send(data: Uint8Array, reliable: boolean): void;
  close(): void;
  onMessage: ((data: ArrayBuffer, reliable: boolean) => void) | null;
  onClose: (() => void) | null;
}

function fakeLink(): FakeLink {
  return {
    sent: [], isOpen: true, onMessage: null, onClose: null,
    send(data) { this.sent.push(data.slice()); },
    close() { this.isOpen = false; },
  };
}

function setup(): { room: HostRoom; world: World; saved: string[] } {
  const world = new World(42);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) world.addChunk(new ChunkColumn(cx, cz));
  const saved: string[] = [];
  const game = {
    world,
    player: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, sneaking: false, flying: false },
    session: {
      tick() { /* o tick do jogo */ },
      mobs: { store: new MobStore(8) },
      dayNight: { totalTicks: 1000, dayFactor: 1 },
      survival: { difficulty: 1 },
    },
    pipeline: {},
    meta: { id: 'mundo-1', name: 'Mundo', seed: 'semente', seedHash: 42, gameMode: 'survival', spawn: [0, 64, 0] },
    save: null,
    hud: { showMessage() { /* sem tela */ } },
    flow: { roomOpen: false },
    controls: {},
    sceneFeed: { extraEntities: null },
    mobRenderer: {},
    entityAtlas: {},
    tier: 1,
  } as unknown as GameHandles;
  const room = new HostRoom(game, 'Anfitrião', 3, { changed() { /* lista */ }, message(name) { saved.push(name); } });
  room.start();
  return { room, world, saved };
}

type Internals = {
  onMessage(g: Guest, bytes: Uint8Array, reliable: boolean): void;
  hello(g: Guest, h: ReturnType<typeof readHello>): Promise<void>;
  tick(): void;
  memory: Map<string, { playerId: string; worldId: string; x: number }>;
};

async function join(room: HostRoom, name: string, id: string, content = localContent()): Promise<{ g: Guest; link: FakeLink }> {
  const link = fakeLink();
  const g: Guest = {
    netId: 0, name: '', playerId: '', link: link as never, x: 0, y: 0, z: 0, ready: false, record: null,
  };
  await (room as unknown as Internals).hello(g, { protocol: PROTOCOL, content, name, playerId: id, mods: [] });
  return { g, link };
}

function types(link: FakeLink): number[] {
  return link.sent.map((b) => b[0]);
}

function blocksRequest(px: number, py: number, pz: number, entries: number[][]): Uint8Array {
  const w = new PacketWriter().reset(MSG.BLOCKS).f32(px).f32(py).f32(pz).u16(entries.length);
  for (const [x, y, z, state, prev] of entries) w.i32(x).u16(y).i32(z).u16(state).u16(prev);
  return w.view8().slice();
}

describe('o anfitrião', () => {
  it('recebe o convidado: WELCOME com a seed e quem já está dentro', async () => {
    const { room } = setup();
    const { g, link } = await join(room, 'Visita', 'aaaaaaaaaaaaaaaa');
    expect(g.ready).toBe(true);
    const r = new PacketReader(link.sent[0]);
    expect(r.u8()).toBe(MSG.WELCOME);
    const w = readWelcome(r);
    expect(w.seedHash).toBe(42);
    expect(w.players.map((p) => p.name)).toEqual(['Anfitrião']);
    expect(room.avatars.get(g.netId)?.name).toBe('Visita');
  });

  it('build diferente não entra; sala cheia também não', async () => {
    const { room } = setup();
    const { link } = await join(room, 'Velho', 'bbbbbbbbbbbbbbbb', 12345);
    expect(link.sent[0][0]).toBe(MSG.REFUSE);
    expect(link.sent[0][1]).toBe(REFUSE.VERSION);
    for (let i = 0; i < 3; i++) await join(room, `J${i}`, `${i}`.repeat(16));
    const { link: extra } = await join(room, 'Quinto', 'ffffffffffffffff');
    expect(extra.sent[0][1]).toBe(REFUSE.FULL);
  });

  it('pedido de bloco perto do convidado vale e vai para os outros, menos para ele', async () => {
    const { room, world } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    const b = await join(room, 'B', 'bbbbbbbbbbbbbbbb');
    a.link.sent.length = 0;
    b.link.sent.length = 0;
    const stone = makeState(STONE);
    (room as unknown as Internals).onMessage(a.g, blocksRequest(2, 64, 2, [[3, 65, 3, stone, 0]]), true);
    expect(world.getBlock(3, 65, 3)).toBe(stone);
    (room as unknown as Internals).tick();
    expect(types(b.link)).toContain(MSG.BLOCKS);
    expect(types(a.link)).not.toContain(MSG.BLOCKS);
  });

  it('pedido longe demais é recusado, com o estado de volta', async () => {
    const { room, world } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    a.link.sent.length = 0;
    const far = REACH + 5;
    (room as unknown as Internals).onMessage(a.g, blocksRequest(0, 64, 0, [[far, 65, 0, makeState(STONE), 0]]), true);
    expect(world.getBlock(far, 65, 0)).toBe(0);
    expect(types(a.link)).toEqual([MSG.BLOCK_DENY]);
  });

  it('chunk intocado vai vazio (o convidado gera da seed); modificado vai inteiro', async () => {
    const { room, world } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    a.link.sent.length = 0;
    const req = (id: number, cx: number, cz: number): Uint8Array =>
      new PacketWriter().reset(MSG.CHUNK_REQ).u32(id).i32(cx).i32(cz).view8().slice();
    (room as unknown as Internals).onMessage(a.g, req(1, 0, 0), true);
    await Promise.resolve();
    world.setBlock(5, 70, 5, makeState(STONE), 'player');
    (room as unknown as Internals).onMessage(a.g, req(2, 0, 0), true);
    await Promise.resolve();
    const replies = a.link.sent.filter((m) => m[0] === MSG.CHUNK).map((m) => new PacketReader(m));
    const first = replies[0];
    first.u8();
    expect([first.u32(), first.u8()]).toEqual([1, 0]);
    const second = replies[1];
    second.u8();
    expect([second.u32(), second.u8()]).toEqual([2, 1]);
    expect(deserializeChunk(second.rest().slice()).getBlock(5, 70, 5)).toBe(makeState(STONE));
  });

  it('o save do convidado é guardado com o id dele e o mundo do anfitrião', async () => {
    const { room } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    const json = JSON.stringify({ worldId: 'outro', playerId: 'falso', x: 7 });
    (room as unknown as Internals).onMessage(a.g, new PacketWriter().reset(MSG.SAVE).str(json).view8().slice(), true);
    await Promise.resolve();
    const record = (room as unknown as Internals).memory.get('aaaaaaaaaaaaaaaa');
    expect(record).toMatchObject({ worldId: 'mundo-1', playerId: 'aaaaaaaaaaaaaaaa', x: 7 });
  });

  it('pacote torto não derruba a sala', async () => {
    const { room } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    expect(() => (room as unknown as Internals).onMessage(a.g, Uint8Array.from([MSG.BLOCKS, 0]), true)).not.toThrow();
    expect(room.guests).toHaveLength(1);
  });
});
