/**
 * Baú e fornalha do convidado (M20): duas sessões de verdade, anfitrião e
 * convidado, ligadas direto — sem WebRTC —, com `net/containersync.ts` no meio.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { BLOCK_BY_NAME, STONE, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, makeStack } from '../src/data/items';
import { GuestContainers, HostContainers } from '../src/net/containersync';
import { MSG, PacketReader, PacketWriter } from '../src/net/protocol';
import { HostSleep } from '../src/net/sleepsync';
import { GuestDimension, HostWorld } from '../src/net/dimensionsync';
import { placeMulti } from '../src/world/multiblock';
import type { GameHandles } from '../src/game/netgate';
import { Furnace } from '../src/game/container';

const GROUND = 63;
const CHEST = BLOCK_BY_NAME.get('chest')!.id;
const FURNACE = BLOCK_BY_NAME.get('furnace')!.id;
const item = (name: string): number => ITEM_BY_NAME.get(name)!.id;

function session(): Session {
  const world = new World(11);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  const player = new Player(0.5, GROUND + 1, 0.5);
  return new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
}

/** Anfitrião e convidado com o mesmo bloco em (2, 64, 2), ligados. */
function pair(block: number): { host: Session; guest: Session; hc: HostContainers<string>; gc: GuestContainers; tick(n: number): void } {
  const host = session();
  const guest = session();
  for (const s of [host, guest]) s.world.setBlock(2, GROUND + 1, 2, makeState(block), 'player');
  host.tiles.create(2, GROUND + 1, 2, block);
  let gc: GuestContainers | null = null;
  const hc = new HostContainers<string>(host, (_g, bytes) => {
    const r = new PacketReader(bytes.slice());
    const type = r.u8();
    if (type === MSG.CONTAINERS) gc!.receive(r);
    else if (type === MSG.CONTAINER_GONE) gc!.gone();
  }, () => ({ x: 0.5, y: GROUND + 1, z: 0.5 }));
  gc = new GuestContainers(guest, (bytes) => {
    const r = new PacketReader(bytes.slice());
    const type = r.u8();
    if (type === MSG.OPEN) hc.open('g', r);
    else if (type === MSG.CSET) hc.set('g', r);
    else if (type === MSG.CLOSE) hc.close('g');
  });
  return {
    host, guest, hc, gc,
    tick(n) { for (let i = 0; i < n; i++) { hc.tick(); gc!.tick(); } },
  };
}

describe('baú do convidado', () => {
  it('abre com o conteúdo do anfitrião; o que ele tira some lá também', () => {
    const { host, guest, tick } = pair(CHEST);
    host.tiles.at(2, GROUND + 1, 2)!.set(0, makeStack(item('diamond'), 5));
    expect(guest.workbench.open(2, GROUND + 1, 2)).toBe(true);
    expect(guest.workbench.openScreen).toBe('chest');
    const local = guest.tiles.at(2, GROUND + 1, 2)!;
    expect(local.get(0)?.count).toBe(5);
    local.set(0, null);
    tick(8);
    expect(host.tiles.at(2, GROUND + 1, 2)!.get(0)).toBeNull();
  });

  it('o que o anfitrião põe com a tela aberta aparece no convidado', () => {
    const { host, guest, tick } = pair(CHEST);
    guest.workbench.open(2, GROUND + 1, 2);
    host.tiles.at(2, GROUND + 1, 2)!.set(3, makeStack(item('stick'), 9));
    tick(8);
    expect(guest.tiles.at(2, GROUND + 1, 2)!.get(3)?.count).toBe(9);
  });

  it('fechar a tela esvazia a cópia: quebrar depois não duplica nada', () => {
    const { host, guest, tick } = pair(CHEST);
    host.tiles.at(2, GROUND + 1, 2)!.set(0, makeStack(item('diamond'), 5));
    guest.workbench.open(2, GROUND + 1, 2);
    guest.workbench.closeScreen();
    tick(2);
    expect(guest.tiles.at(2, GROUND + 1, 2)!.get(0)).toBeNull();
    expect(host.tiles.at(2, GROUND + 1, 2)!.get(0)?.count).toBe(5);
  });

  it('quebrado no anfitrião com a tela aberta: a tela do convidado fecha', () => {
    const { host, guest, tick } = pair(CHEST);
    guest.workbench.open(2, GROUND + 1, 2);
    host.world.setBlock(2, GROUND + 1, 2, 0, 'player');
    host.removeContainerAt(2, GROUND + 1, 2);
    tick(8);
    expect(guest.workbench.openScreen).toBe('none');
  });
});

describe('fornalha do convidado', () => {
  it('a barra de fundição anda no convidado, que não roda a fornalha', () => {
    const { host, guest, tick } = pair(FURNACE);
    const furnace = host.tiles.at(2, GROUND + 1, 2) as Furnace;
    guest.workbench.open(2, GROUND + 1, 2);
    furnace.cookTicks = 120;
    furnace.burnTicks = 800;
    furnace.burnTotal = 1600;
    tick(8);
    const local = guest.tiles.at(2, GROUND + 1, 2) as Furnace;
    expect(local.cookTicks).toBe(120);
    expect(local.burnTicks).toBe(800);
  });
});

describe('dormir na sala', () => {
  const BED = BLOCK_BY_NAME.get('bed')!.id;

  function room(): { host: Session; hs: HostSleep<{ x: number; y: number; z: number }>; guest: { x: number; y: number; z: number }; sent: number[]; messages: string[] } {
    const host = session();
    placeMulti(host.world, 4, GROUND + 1, 4, makeState(BED, 2), () => true);
    host.dayNight.setTimeOfDay(18000);
    const guest = { x: 6.5, y: GROUND + 1, z: 4.5 };
    const sent: number[] = [];
    const messages: string[] = [];
    const game = {
      session: host, world: host.world, player: host.player,
      hud: { showMessage: (text: string) => { messages.push(text); } },
    } as unknown as GameHandles;
    const hs = new HostSleep(game, () => [guest], (_g, bytes) => { sent.push(bytes[0]); });
    hs.install();
    return { host, hs, guest, sent, messages };
  }

  const bedAt = (x: number, y: number, z: number): PacketReader => {
    const r = new PacketReader(new PacketWriter().reset(MSG.SLEEP).i32(x).u16(y).i32(z).view8().slice());
    r.u8();
    return r;
  };

  it('o anfitrião deita e a noite não passa sozinha: espera o convidado', () => {
    const { host, messages } = room();
    host.player.setPosition(4.5, GROUND + 1, 4.5);
    expect(host.blockUse.bed(4, GROUND + 1, 4)).toBe(true);
    expect(host.dayNight.time).toBe(18000);
    expect(messages[messages.length - 1]).toContain('1');
    expect(messages[messages.length - 1]).toContain('2');
  });

  it('com os dois deitados a tempo, amanhece e o convidado recebe WAKE', () => {
    const { host, hs, guest, sent } = room();
    host.player.setPosition(4.5, GROUND + 1, 4.5);
    host.blockUse.bed(4, GROUND + 1, 4);
    hs.request(guest, bedAt(4, GROUND + 1, 4));
    expect(host.dayNight.time).toBe(0);
    expect(sent).toContain(MSG.WAKE);
  });

  it('quem se afasta da cama levanta, e a noite continua', () => {
    const { host, hs, guest } = room();
    host.player.setPosition(4.5, GROUND + 1, 4.5);
    host.blockUse.bed(4, GROUND + 1, 4);
    host.player.setPosition(20.5, GROUND + 1, 4.5);
    hs.tick();
    hs.request(guest, bedAt(4, GROUND + 1, 4));
    expect(host.dayNight.time).toBe(18000);
  });

  it('de dia, o convidado ouve que só de noite', () => {
    const { host, hs, guest, sent } = room();
    host.dayNight.setTimeOfDay(6000);
    hs.request(guest, bedAt(4, GROUND + 1, 4));
    expect(sent).toEqual([MSG.SLEEP_STATE]);
    expect(host.dayNight.time).toBe(6000);
  });
});

describe('a sala segue o anfitrião entre dimensões', () => {
  const NETHER = 1;

  it('convidado noutra dimensão recebe DIMENSION com a posição do anfitrião; na mesma, vira âncora', () => {
    const host = session();
    host.world.dimension = NETHER;
    const anchors: number[][] = [];
    const sent: [string, number][] = [];
    const game = {
      session: host, world: host.world, player: host.player,
      pipeline: { setAnchors: (list: readonly number[]) => { anchors.push(list.slice()); } },
    } as unknown as GameHandles;
    const a = { name: 'a', x: 40.5, y: 70, z: 8.5, dim: 0 };
    const b = { name: 'b', x: 3.5, y: 70, z: 3.5, dim: NETHER };
    const hw = new HostWorld(game, () => [a, b], (g, bytes) => { sent.push([g.name, bytes[0]]); });
    for (let t = 0; t < 10; t++) hw.tick();
    expect(sent).toEqual([['a', MSG.DIMENSION]]);
    expect(anchors[anchors.length - 1]).toEqual([0, 0]);
    // Não puxa de novo logo em seguida: a ida leva um tempo.
    for (let t = 0; t < 10; t++) hw.tick();
    expect(sent).toHaveLength(1);
  });

  it('o convidado atravessa, fica parado até o chão chegar e aparece onde o anfitrião está', () => {
    const guest = session();
    const game = { session: guest, world: guest.world, player: guest.player } as unknown as GameHandles;
    const gd = new GuestDimension(game);
    const r = new PacketReader(new PacketWriter().reset(MSG.DIMENSION).u8(NETHER).f32(40.5).f32(33).f32(8.5).view8().slice());
    r.u8();
    gd.apply(r);
    expect(guest.world.dimension).toBe(NETHER);
    expect(guest.travel.isTravelling).toBe(true);
    expect(guest.travel.tick(0, 0, 0)).toBe(true);
    // O chão do outro lado chega.
    guest.world.addChunk(new ChunkColumn(2, 0));
    expect(guest.travel.tick(0, 0, 0)).toBe(false);
    expect(guest.travel.isTravelling).toBe(false);
    expect([guest.player.x, guest.player.y, guest.player.z]).toEqual([40.5, 33, 8.5]);
  });
});

describe('bichos em volta do convidado', () => {
  it('o ciclo de spawn roda também em volta de cada convidado na mesma dimensão', () => {
    const host = session();
    const calls: number[][] = [];
    host.spawner.runCycle = (_c, x, y, z) => { calls.push([x, y, z]); return 0; };
    const game = {
      session: host, world: host.world, player: host.player, pipeline: { setAnchors: () => undefined },
    } as unknown as GameHandles;
    const near = { x: 20.5, y: 64, z: 4.5, dim: 0 };
    const away = { x: 1, y: 64, z: 1, dim: 1 };
    const hw = new HostWorld(game, () => [near, away], () => undefined);
    for (let t = 0; t < 40; t++) hw.tick();
    expect(calls).toEqual([[20.5, 64, 4.5], [20.5, 64, 4.5]]);
  });
});
