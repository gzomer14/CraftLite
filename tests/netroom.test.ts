/**
 * A sala na rede local sem navegador (M20): o protocolo, os mobs vistos pelo
 * convidado, e o anfitrião de verdade — com um mundo de verdade e ligações
 * falsas no lugar do WebRTC.
 *
 * A ligação real, com dois Chrome jogando juntos, é `npm run smoke:room`.
 */
import { describe, expect, it } from 'vitest';
import {
  MOVE_AWAY, MSG, PROTOCOL, PacketReader, PacketWriter, REFUSE, contentHash, readHello, readWelcome, writeHello, writeWelcome,
} from '../src/net/protocol';
import { MobPuppets, writeMobs, MOB_RADIUS } from '../src/net/mobsync';
import { HostRoom, REACH, type Guest } from '../src/net/host';
import { localContent } from '../src/net/identity';
import { Avatars } from '../src/net/avatars';
import { MobStore } from '../src/entity/mobstore';
import { Mobs } from '../src/entity/mobs';
import { MOB_BY_NAME } from '../src/data/mobs';
import { FLAG_IGNITES } from '../src/entity/projectile';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { STONE, makeState } from '../src/data/blocks';
import { deserializeChunk } from '../src/save/serialize';
import type { GameHandles } from '../src/game/netgate';
import { Lighting } from '../src/world/lighting';
import { computeChunkLight } from '../src/world/gen/terrain';
import { reactToNetworkBlock } from '../src/net/blockreact';
import { SignStore } from '../src/game/signs';

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

/** Um chão de pedra de Y=60 a 63, com a luz do céu já calculada. */
function stoneFloor(world: World): void {
  const stone = makeState(STONE);
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const column = new ChunkColumn(cx, cz);
      for (let y = 60; y < 64; y++) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) column.setBlock(x, y, z, stone);
      computeChunkLight(column);
      world.addChunk(column);
    }
  }
}

interface Rig { room: HostRoom; world: World; saved: string[]; mobs: Mobs; hostHits: number[]; hostDrops: number[] }

function setup(): Rig {
  const world = new World(42);
  stoneFloor(world);
  const saved: string[] = [];
  const hostHits: number[] = [];
  const hostDrops: number[] = [];
  const mobs = new Mobs(world, {
    onDrop: (item) => { hostDrops.push(item); },
    onXp: () => { /* sem orbe */ },
    onSound: () => { /* sem som */ },
    onHitPlayer: (damage) => { hostHits.push(damage); },
    onExplode: () => { /* sem explosão */ },
    onBreakBlock: () => { /* nada */ },
    onArrow: () => { /* nada */ },
  }, 16);
  const game = {
    world,
    player: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, sneaking: false, flying: false },
    session: {
      tick() { /* o tick do jogo */ },
      mobs,
      projectiles: { onHit: null, onPotion: null },
      combat: { explodeAt() { /* sem mundo */ } },
      inventory: { held: null },
      blockUse: { bed() { return false; } },
      travel: { isTravelling: false },
      spawner: { difficulty: 0 },
      lighting: new Lighting(world),
      signs: new SignStore(),
      tiles: { create() { /* sem contêiner */ }, at() { return undefined; } },
      fluids: { scheduleAround() { /* sem água */ } },
      removeContainerAt() { /* sem contêiner */ },
      dayNight: { totalTicks: 1000, dayFactor: 1 },
      survival: { difficulty: 1 },
    },
    pipeline: { setAnchors() { /* sem pipeline */ } },
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
  return { room, world, saved, mobs, hostHits, hostDrops };
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
    netId: 0, name: '', playerId: '', link: link as never, x: 0, y: 0, z: 0, dim: 0, ready: false, record: null,
  };
  await (room as unknown as Internals).hello(g, { protocol: PROTOCOL, content, name, playerId: id, mods: [] });
  return { g, link };
}

function types(link: FakeLink): number[] {
  return link.sent.map((b) => b[0]);
}

function blocksRequest(px: number, py: number, pz: number, entries: number[][]): Uint8Array {
  const w = new PacketWriter().reset(MSG.BLOCKS).u8(0).f32(px).f32(py).f32(pz).u16(entries.length);
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

  it('o buraco aberto pelo convidado recebe a luz do céu (defeito de aparelho: ficava escuro)', async () => {
    const { room, world } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    const stone = makeState(STONE);
    expect(world.getSkyLight(3, 62, 3)).toBe(0);
    (room as unknown as Internals).onMessage(a.g, blocksRequest(2, 64, 2, [[3, 63, 3, 0, stone], [3, 62, 3, 0, stone]]), true);
    expect(world.getBlock(3, 62, 3)).toBe(0);
    expect(world.getSkyLight(3, 62, 3)).toBeGreaterThan(10);
  });

  it('no convidado, o bloco que chega do anfitrião também acende', () => {
    const world = new World(42);
    stoneFloor(world);
    const lighting = new Lighting(world);
    const session = { lighting, signs: { remove() { /* sem placa */ } } } as never;
    const stone = makeState(STONE);
    world.setBlock(5, 63, 5, 0, 'network');
    reactToNetworkBlock(session, 5, 63, 5, stone, 0, false);
    expect(world.getSkyLight(5, 63, 5)).toBeGreaterThan(10);
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
      new PacketWriter().reset(MSG.CHUNK_REQ).u32(id).i32(cx).i32(cz).u8(0).view8().slice();
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

describe('mobs e convidados', () => {
  const move = (x: number, y: number, z: number, flags = 0): Uint8Array =>
    new PacketWriter().reset(MSG.MOVE).u8(0).f32(x).f32(y).f32(z).f32(0).f32(0).u8(flags).u16(0xffff).u8(0).view8().slice();

  it('o zumbi vai atrás do convidado mais perto, e o golpe vira HURT para ele', async () => {
    const { room, mobs, hostHits } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    (room as unknown as Internals).onMessage(a.g, move(20.5, 64, 20.5), false);
    a.link.sent.length = 0;
    mobs.isDay = false;
    mobs.spawn(MOB_BY_NAME.get('zombie')!.id, 21.5, 64, 20.5);
    // O anfitrião longe: 40 blocos do zumbi.
    const host = { x: -8, y: 64, z: -8, eyeY: 65.6, held: -1, alive: true };
    for (let t = 0; t < 80; t++) mobs.tick(host);
    expect(types(a.link)).toContain(MSG.HURT);
    expect(hostHits).toEqual([]);
  });

  it('convidado morto ou no criativo não é alvo', async () => {
    const { room, mobs, hostHits } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    (room as unknown as Internals).onMessage(a.g, move(20.5, 64, 20.5, 16), false);
    a.link.sent.length = 0;
    mobs.isDay = false;
    mobs.spawn(MOB_BY_NAME.get('zombie')!.id, 21.5, 64, 20.5);
    const host = { x: -8, y: 64, z: -8, eyeY: 65.6, held: -1, alive: true };
    for (let t = 0; t < 80; t++) mobs.tick(host);
    expect(types(a.link)).not.toContain(MSG.HURT);
    void hostHits;
  });

  it('o golpe do convidado mata no anfitrião, e o saque vai para ele (LOOT), não para o chão daqui', async () => {
    const { room, mobs, hostDrops } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    (room as unknown as Internals).onMessage(a.g, move(5.5, 64, 5.5), false);
    a.link.sent.length = 0;
    const cow = MOB_BY_NAME.get('cow')!.id;
    const slot = mobs.spawn(cow, 6.5, 64, 5.5);
    const attack = new PacketWriter().reset(MSG.ATTACK).u16(slot).u8(cow).f32(100).u8(0).view8().slice();
    (room as unknown as Internals).onMessage(a.g, attack, true);
    expect(mobs.store.active).toBe(0);
    expect(types(a.link)).toContain(MSG.LOOT);
    expect(hostDrops).toEqual([]);
  });

  it('golpe com tipo trocado (o slot virou outro mob no caminho) não vale', async () => {
    const { room, mobs } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    (room as unknown as Internals).onMessage(a.g, move(5.5, 64, 5.5), false);
    const slot = mobs.spawn(MOB_BY_NAME.get('cow')!.id, 6.5, 64, 5.5);
    const attack = new PacketWriter().reset(MSG.ATTACK).u16(slot).u8(MOB_BY_NAME.get('zombie')!.id).f32(100).u8(0).view8().slice();
    (room as unknown as Internals).onMessage(a.g, attack, true);
    expect(mobs.store.active).toBe(1);
  });
});

describe('placas', () => {
  it('o texto que o convidado escreve fica no anfitrião e vai aos outros', async () => {
    const { room } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    const b = await join(room, 'B', 'bbbbbbbbbbbbbbbb');
    a.link.sent.length = 0;
    b.link.sent.length = 0;
    const sign = new PacketWriter().reset(MSG.SIGN).i32(3).u16(64).i32(3).str('["FERRARIA","do Zé"]').view8().slice();
    (room as unknown as Internals).onMessage(a.g, sign, true);
    const host = (room as unknown as { game: GameHandles }).game;
    expect(host.session.signs.get(3, 64, 3)).toEqual(['FERRARIA', 'DO ZÉ', '', '']);
    expect(types(b.link)).toContain(MSG.SIGN);
    expect(types(a.link)).not.toContain(MSG.SIGN);
  });

  it('o texto que o anfitrião escreve vai a todos', async () => {
    const { room } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    a.link.sent.length = 0;
    const host = (room as unknown as { game: GameHandles }).game;
    host.session.signs.set(1, 64, 1, ['OLA']);
    expect(types(a.link)).toContain(MSG.SIGN);
  });
});

describe('fogo e frasco no convidado', () => {
  const move = (x: number, y: number, z: number): Uint8Array =>
    new PacketWriter().reset(MSG.MOVE).u8(0).f32(x).f32(y).f32(z).f32(0).f32(0).u8(0).u16(0xffff).u8(0).view8().slice();

  it('a bola do blaze no convidado fere e põe fogo nele', async () => {
    const { room } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    (room as unknown as Internals).onMessage(a.g, move(5.5, 64, 5.5), false);
    a.link.sent.length = 0;
    const host = (room as unknown as { game: GameHandles }).game;
    expect(host.session.projectiles.onHit!(5.5, 64.9, 5.5, 5, false, FLAG_IGNITES)).toBe(true);
    const hurt = a.link.sent.find((m) => m[0] === MSG.HURT)!;
    const r = new PacketReader(hurt);
    r.u8();
    expect(r.f32()).toBe(5);
    r.u8(); r.f32(); r.f32();
    expect(r.u16()).toBeGreaterThan(0);
  });

  it('o frasco da bruxa que quebra perto do convidado vai para ele (SPLASH); longe, não', async () => {
    const { room } = setup();
    const a = await join(room, 'A', 'aaaaaaaaaaaaaaaa');
    (room as unknown as Internals).onMessage(a.g, move(5.5, 64, 5.5), false);
    a.link.sent.length = 0;
    const host = (room as unknown as { game: GameHandles }).game;
    host.session.projectiles.onPotion!(6, 64.5, 6, 1);
    host.session.projectiles.onPotion!(40, 64.5, 40, 1);
    expect(types(a.link).filter((t) => t === MSG.SPLASH)).toHaveLength(1);
  });
});

describe('item na mão do boneco', () => {
  it('o item vai ao passe dos itens na altura da mão, e some com a mão vazia ou noutra dimensão', () => {
    const avatars = new Avatars(null as never, null as never, null as never, () => 1);
    avatars.add(3, 'A');
    const added: number[][] = [];
    const items = { add: (x: number, y: number, z: number, item: number) => { added.push([x, y, z, item]); } } as never;
    avatars.move(3, 10, 64, 10, 0, 0, 0, 0xffff);
    avatars.drawItems(items, 1);
    expect(added).toEqual([]);
    avatars.move(3, 10, 64, 10, 0, 0, 0, 42);
    avatars.drawItems(items, 1);
    expect(added).toHaveLength(1);
    expect(added[0][3]).toBe(42);
    expect(added[0][1]).toBeGreaterThan(64);
    expect(added[0][1]).toBeLessThan(65.8);
    expect(Math.hypot(added[0][0] - 10, added[0][2] - 10)).toBeLessThan(0.7);
    avatars.move(3, 10, 64, 10, 0, 0, MOVE_AWAY, 42);
    avatars.drawItems(items, 1);
    expect(added).toHaveLength(1);
  });
});
