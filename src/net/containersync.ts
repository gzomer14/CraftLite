/**
 * Baú, fornalha, funil e suporte de preparo para o convidado (M20).
 *
 * O conteúdo mora no anfitrião, que é quem roda a fornalha e o funil. O
 * convidado que clica num contêiner pede o conteúdo (`OPEN`), recebe o
 * registro do save (`tileFrom`, o mesmo do banco) e abre a tela de sempre sobre
 * uma cópia local. Enquanto a tela está aberta, **os dois lados comparam** o
 * registro com o último que trocaram, cinco vezes por segundo, e mandam só o
 * que mudou: o convidado tira um item, o anfitrião fica sabendo; a fornalha
 * funde, o convidado vê a barra andar. Dois jogadores no mesmo baú: vale o
 * último a mexer — entre amigos, como o inventário (doc 15 §5).
 *
 * Fechada a tela, a cópia local é esvaziada: um baú quebrado depois pelo
 * convidado não deixa cair aqui o que ele viu da última vez. O conteúdo de
 * verdade cai no anfitrião e vai para quem quebrou (`host.ts`, `LOOT`).
 */

import { blockIdOf } from '../data/blocks';
import { Furnace, type Container } from '../game/container';
import { BrewingStand } from '../game/brewing';
import { tileFrom, type ContainerRecord } from '../game/savegame';
import { isContainerBlock } from '../game/tiles';
import type { Session } from '../game/session';
import { MSG, PacketWriter, type PacketReader } from './protocol';

/** Comparar e mandar a cada tantos ticks: 5 vezes por segundo. */
const SYNC_EVERY = 4;
/** O convidado só abre o que alcança, com folga do atraso. */
const OPEN_RANGE = 8;

const CHEST_NEIGHBORS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Copia um registro para um contêiner vivo. `slotsOnly` não mexe na fornalha. */
export function applyRecord(c: Container, record: ContainerRecord, slotsOnly: boolean): void {
  const size = Math.min(c.size, record.slots.length / 3);
  for (let i = 0; i < size; i++) {
    const item = record.slots[i * 3];
    const count = record.slots[i * 3 + 1];
    if (!(item > 0 && count > 0)) {
      c.slots[i] = null;
      continue;
    }
    const stack: { item: number; count: number; damage: number; ench: number; name?: string } = {
      item, count, damage: record.slots[i * 3 + 2], ench: record.enchants?.[i] ?? 0,
    };
    const name = record.names?.[i];
    if (typeof name === 'string' && name !== '') stack.name = name;
    c.slots[i] = stack;
  }
  c.persistent = record.persistent === true;
  if (!slotsOnly) {
    if (c instanceof Furnace && record.burn !== undefined) {
      [c.burnTicks, c.burnTotal, c.cookTicks] = record.burn;
    }
    if (c instanceof BrewingStand && record.brew !== undefined) [c.fuel, c.brewTicks] = record.brew;
  }
  c.onChange?.();
}

// --- anfitrião ---------------------------------------------------------------------

export class HostContainers<G> {
  /** Por convidado: posição → o último registro trocado, em JSON. */
  private readonly watching = new Map<G, Map<string, string>>();
  private readonly w = new PacketWriter(1024);
  private ticks = 0;

  constructor(
    private readonly session: Session,
    private readonly send: (g: G, bytes: Uint8Array) => void,
    private readonly position: (g: G) => { x: number; y: number; z: number },
  ) {}

  /** `OPEN`: manda o contêiner (e o baú do lado) e passa a vigiá-lo. */
  open(g: G, r: PacketReader): void {
    const x = r.i32(); const y = r.u16(); const z = r.i32();
    const at = this.position(g);
    const near = (x + 0.5 - at.x) ** 2 + (y + 0.5 - at.y) ** 2 + (z + 0.5 - at.z) ** 2 <= OPEN_RANGE * OPEN_RANGE;
    const { world, tiles } = this.session;
    const id = blockIdOf(world.getBlock(x, y, z));
    const records: ContainerRecord[] = [];
    const watch = new Map<string, string>();
    if (near && isContainerBlock(id)) {
      const add = (c: Container): void => {
        const record = tileFrom(c);
        records.push(record);
        watch.set(keyOf(c.x, c.y, c.z), JSON.stringify(record));
      };
      add(tiles.atOrCreate(x, y, z, id));
      for (const [dx, dz] of CHEST_NEIGHBORS) {
        if (blockIdOf(world.getBlock(x + dx, y, z + dz)) === id) add(tiles.atOrCreate(x + dx, y, z + dz, id));
      }
    }
    this.watching.set(g, watch);
    this.send(g, this.w.reset(MSG.CONTAINERS).u8(1).i32(x).u16(y).i32(z).str(JSON.stringify(records)).view8());
  }

  /** `CSET`: o convidado mexeu. Só nos slots, e só no que ele está vendo. */
  set(g: G, r: PacketReader): void {
    const watch = this.watching.get(g);
    let record: ContainerRecord;
    try {
      record = JSON.parse(r.str()) as ContainerRecord;
    } catch {
      return;
    }
    const key = keyOf(record.x, record.y, record.z);
    if (watch?.has(key) !== true || !Array.isArray(record.slots)) return;
    const c = this.session.tiles.at(record.x, record.y, record.z);
    if (c === undefined) return;
    applyRecord(c, record, true);
    watch.set(key, JSON.stringify(tileFrom(c)));
  }

  close(g: G): void {
    this.watching.delete(g);
  }

  /** Um tick: o que mudou aqui (fornalha, funil, outro jogador) vai a quem vê. */
  tick(): void {
    if (this.watching.size === 0 || ++this.ticks % SYNC_EVERY !== 0) return;
    const tiles = this.session.tiles;
    for (const [g, watch] of this.watching) {
      for (const [key, last] of watch) {
        const [x, y, z] = key.split(',').map(Number);
        const c = tiles.at(x, y, z);
        if (c === undefined) {
          // Quebrado com a tela aberta: fecha lá, antes que alguém tire dali.
          this.send(g, this.w.reset(MSG.CONTAINER_GONE).i32(x).u16(y).i32(z).view8());
          this.watching.delete(g);
          break;
        }
        const json = JSON.stringify(tileFrom(c));
        if (json === last) continue;
        watch.set(key, json);
        this.send(g, this.w.reset(MSG.CONTAINERS).u8(0).i32(x).u16(y).i32(z).str(`[${json}]`).view8());
      }
    }
  }
}

// --- convidado ---------------------------------------------------------------------

export class GuestContainers {
  /** Posição → o último registro trocado, em JSON. */
  private readonly watching = new Map<string, string>();
  private readonly w = new PacketWriter(1024);
  private pending: string | null = null;
  private ticks = 0;
  private readonly baseOpen: (x: number, y: number, z: number) => boolean;

  constructor(private readonly session: Session, private readonly send: (bytes: Uint8Array) => void) {
    const workbench = session.workbench;
    this.baseOpen = workbench.open.bind(workbench);
    workbench.open = (x, y, z) => {
      if (!isContainerBlock(blockIdOf(session.world.getBlock(x, y, z)))) return this.baseOpen(x, y, z);
      // O clique vale, mas a tela só abre quando o conteúdo chegar.
      this.pending = keyOf(x, y, z);
      this.send(this.w.reset(MSG.OPEN).i32(x).u16(y).i32(z).view8());
      return true;
    };
  }

  /** `CONTAINERS`: a resposta do `OPEN` (`opening`) ou uma mudança do anfitrião. */
  receive(r: PacketReader): void {
    const opening = r.u8() === 1;
    const x = r.i32(); const y = r.u16(); const z = r.i32();
    let records: ContainerRecord[];
    try {
      records = JSON.parse(r.str()) as ContainerRecord[];
    } catch {
      return;
    }
    const key = keyOf(x, y, z);
    if (opening) {
      if (this.pending !== key || records.length === 0) return;
      this.pending = null;
      this.watching.clear();
    } else if (!this.watching.has(key)) {
      return;
    }
    const { world, tiles } = this.session;
    for (const record of records) {
      const id = blockIdOf(world.getBlock(record.x, record.y, record.z));
      if (!isContainerBlock(id)) continue;
      applyRecord(tiles.atOrCreate(record.x, record.y, record.z, id), record, false);
      this.watching.set(keyOf(record.x, record.y, record.z), JSON.stringify(record));
    }
    if (opening) this.baseOpen(x, y, z);
  }

  /** `CONTAINER_GONE`: quebraram o contêiner com a tela aberta. */
  gone(): void {
    this.session.workbench.closeScreen();
    this.release();
  }

  /** Um tick: a tela fechou? Senão, o que o jogador mexeu vai ao anfitrião. */
  tick(): void {
    if (this.watching.size === 0) return;
    if (this.session.workbench.openScreen === 'none') {
      this.send(this.w.reset(MSG.CLOSE).view8());
      this.release();
      return;
    }
    if (++this.ticks % SYNC_EVERY !== 0) return;
    for (const [key, last] of this.watching) {
      const [x, y, z] = key.split(',').map(Number);
      const c = this.session.tiles.at(x, y, z);
      if (c === undefined) continue;
      const json = JSON.stringify(tileFrom(c));
      if (json === last) continue;
      this.watching.set(key, json);
      this.send(this.w.reset(MSG.CSET).str(json).view8());
    }
  }

  /** Esvazia as cópias locais: quebrar depois não deixa cair nada aqui. */
  private release(): void {
    for (const key of this.watching.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      const c = this.session.tiles.at(x, y, z);
      if (c !== undefined) c.slots.fill(null);
    }
    this.watching.clear();
  }
}
