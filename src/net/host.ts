/**
 * O anfitrião de uma sala na rede local (M20, doc 12).
 *
 * **O anfitrião é a autoridade**: o mundo roda só aqui — mobs, fluidos, fogo,
 * crescimento, circuito — e o convidado recebe o resultado. O que o convidado
 * faz no mundo chega como pedido de bloco, e só vale se passar pela validação
 * de alcance (doc 12 §6). O que é dele — inventário, vida, XP — ele mesmo
 * calcula e manda a cada 10 s; o anfitrião guarda no próprio mundo, sob o id
 * estável do convidado (`STORE_PLAYERS`, `[worldId, playerId]`). **Desvio
 * consciente do doc 12 §6:** o anfitrião não confere se o convidado tem o
 * item que usa; entre amigos na mesma rede, o custo não se paga ainda.
 *
 * Por tick (embrulhando o `tick` desta sessão, como um mod do M21):
 * - blocos mudados desde o último tick, em lote, para cada convidado menos quem
 *   pediu a mudança;
 * - a posição do anfitrião e os mobs perto de cada convidado, no canal rápido;
 * - a cada 5 s, o tempo do mundo (o clima sai dele, determinístico).
 *
 * Limites desta versão, conferidos pelo teste de sala: a sala é na superfície
 * (com o anfitrião em outra dimensão, os pedidos de bloco são recusados e os
 * chunks saem do banco), e o convidado só mexe onde o anfitrião tem o mundo
 * carregado (o alcance de visão dele).
 */

import { BLOCKS, blockIdOf } from '../data/blocks';
import { DIM_OVERWORLD } from '../data/dimensions';
import { t } from '../core/i18n';
import { serializeChunk } from '../save/serialize';
import type { PlayerSave } from '../save/db';
import type { GameHandles } from '../game/netgate';
import type { BlockChange } from '../world/world';
import { Avatars } from './avatars';
import { NameTags } from './nametags';
import { ChatBox, cleanChat, touchScreen } from './chat';
import { HostCombat, type Loot } from './hostcombat';
import { HostContainers } from './containersync';
import { HostSleep } from './sleepsync';
import { SignSync } from './signsync';
import { HostWorld } from './dimensionsync';
import { reactToNetworkBlock } from './blockreact';
import { activeModIds, localContent } from './identity';
import { Link } from './link';
import { writeMobs } from './mobsync';
import {
  MOVE_AWAY, MOVE_FLYING, MOVE_SNEAK, MOVE_UNTARGETABLE, MSG, PROTOCOL, PacketReader, PacketWriter, REFUSE,
  readHello, writeWelcome, type Hello,
} from './protocol';
import type { Signal } from './signal';

/** Alcance de um pedido de bloco: os 6 do jogador, com folga para o atraso. */
export const REACH = 10;
const TIME_EVERY = 100;
const MAX_BATCH = 4000;

export interface Guest {
  netId: number;
  name: string;
  playerId: string;
  link: Link;
  x: number; y: number; z: number;
  /** A dimensão em que ele está (a sala segue o anfitrião: `net/dimensionsync.ts`). */
  dim: number;
  /** Passou pelo `HELLO` e recebeu o `WELCOME`. */
  ready: boolean;
  record: PlayerSave | null;
}

export interface HostEvents {
  /** A lista mudou (entrou, saiu): a tela da sala se atualiza. */
  changed(): void;
  message(text: string): void;
}

export class HostRoom {
  readonly guests: Guest[] = [];
  readonly avatars: Avatars;
  private pending: Link | null = null;
  private readonly w = new PacketWriter();
  private readonly wFast = new PacketWriter(4096);
  /** Mudanças do tick: `x, y, z, state, origem` em sequência. */
  private readonly batch: number[] = [];
  private applyingFrom = 0;
  private ticks = 0;
  private unsubscribe: (() => void) | null = null;
  private baseTick: (() => void) | null = null;
  /** Convidados sem banco (modo privado): guardados só na memória. */
  private readonly memory = new Map<string, PlayerSave>();
  private open = false;

  constructor(
    private readonly game: GameHandles,
    private readonly hostName: string,
    private readonly maxGuests: number,
    private readonly events: HostEvents,
  ) {
    const { world, mobRenderer, entityAtlas, session } = game;
    this.avatars = new Avatars(world, mobRenderer, entityAtlas, () => session.dayNight.dayFactor);
    this.combat = new HostCombat(game, (g, bytes) => this.send(g, bytes));
    this.containers = new HostContainers<Guest>(session, (g, bytes) => this.send(g, bytes), (g) => g);
    this.sleep = new HostSleep<Guest>(game, () => this.ready(), (g, bytes) => this.send(g, bytes));
    this.worldSync = new HostWorld<Guest>(game, () => this.ready(), (g, bytes) => this.send(g, bytes));
  }

  private readonly containers: HostContainers<Guest>;
  private readonly sleep: HostSleep<Guest>;
  private readonly worldSync: HostWorld<Guest>;
  private signText: SignSync | null = null;

  private readonly combat: HostCombat;

  private tags: NameTags | null = null;
  private chat: ChatBox | null = null;

  get isOpen(): boolean {
    return this.open;
  }

  /** Liga a sala: ouvinte de blocos, tick, bonecos. */
  start(): void {
    if (this.open) return;
    this.open = true;
    const { world, session, sceneFeed, flow } = this.game;
    this.unsubscribe = world.onBlockChange((change) => this.onBlock(change));
    this.combat.install();
    this.sleep.install();
    this.signText = new SignSync(session.signs, (bytes) => {
      for (const g of this.ready()) this.send(g, bytes);
    });
    const base = session.tick.bind(session);
    this.baseTick = base;
    session.tick = (): void => {
      base();
      this.tick();
    };
    if (typeof document !== 'undefined') {
      this.tags = new NameTags(this.game.camera, this.game.canvas);
      this.chat = new ChatBox((text) => this.say(text), touchScreen());
    }
    sceneFeed.extraEntities = (alpha) => {
      this.avatars.draw(alpha);
      this.tags?.update(this.avatars.list, alpha);
    };
    sceneFeed.extraItems = (items, alpha) => this.avatars.drawItems(items, alpha);
    flow.roomOpen = true;
  }

  /** Fecha a sala: avisa todo mundo, guarda quem estava dentro, desfaz os ganchos. */
  async close(): Promise<void> {
    if (!this.open) return;
    this.open = false;
    for (const g of this.guests.slice()) {
      this.send(g, this.w.reset(MSG.BYE).u8(REFUSE.CLOSED).view8());
      await this.persist(g);
      g.link.close();
    }
    this.guests.length = 0;
    this.pending?.close();
    this.pending = null;
    this.unsubscribe?.();
    this.combat.uninstall();
    this.sleep.uninstall();
    this.worldSync.uninstall();
    this.signText?.restore();
    this.signText = null;
    if (this.baseTick !== null) this.game.session.tick = this.baseTick;
    this.game.sceneFeed.extraEntities = null;
    this.game.sceneFeed.extraItems = null;
    this.tags?.dispose();
    this.tags = null;
    this.chat?.dispose();
    this.chat = null;
    this.game.flow.roomOpen = false;
    this.events.changed();
  }

  // --- convite -----------------------------------------------------------------

  /** Uma oferta nova para o próximo convidado (a anterior, se sobrou, morre). */
  async invite(): Promise<Signal> {
    this.pending?.close();
    const { link, offer } = await Link.host();
    this.pending = link;
    return offer;
  }

  /** A resposta do convidado chegou: liga e espera o `HELLO`. */
  async accept(answer: Signal): Promise<void> {
    const link = this.pending;
    if (link === null) throw new Error('nenhum convite em aberto');
    this.pending = null;
    const guest: Guest = {
      netId: 0, name: '', playerId: '', link, x: 0, y: 0, z: 0, dim: DIM_OVERWORLD, ready: false, record: null,
    };
    link.onMessage = (data, reliable) => this.onMessage(guest, new Uint8Array(data), reliable);
    link.onClose = () => { void this.drop(guest); };
    await link.accept(answer);
  }

  kick(netId: number): void {
    const g = this.guests.find((x) => x.netId === netId);
    if (g === undefined) return;
    this.send(g, this.w.reset(MSG.BYE).u8(REFUSE.KICKED).view8());
    void this.drop(g);
  }

  // --- mensagens -----------------------------------------------------------------

  private onMessage(g: Guest, bytes: Uint8Array, reliable: boolean): void {
    const r = new PacketReader(bytes);
    let type: number;
    try {
      type = r.u8();
      if (!g.ready) {
        if (type === MSG.HELLO && reliable) void this.hello(g, readHello(r));
        return;
      }
      switch (type) {
        case MSG.MOVE: this.move(g, r); break;
        case MSG.BLOCKS: this.blocks(g, r); break;
        case MSG.CHUNK_REQ: void this.chunk(g, r.u32(), r.i32(), r.i32(), r.u8()); break;
        case MSG.SAVE: this.saved(g, r.str()); break;
        case MSG.CHAT: this.heard(g, cleanChat(r.str())); break;
        case MSG.ATTACK: this.combat.attack(g, r); break;
        case MSG.OPEN: this.containers.open(g, r); break;
        case MSG.CSET: this.containers.set(g, r); break;
        case MSG.CLOSE: this.containers.close(g); break;
        case MSG.SLEEP: this.sleep.request(g, r); break;
        case MSG.SIGN: this.signFrom(g, r); break;
        case MSG.BYE: void this.drop(g); break;
        default: break;
      }
    } catch {
      // Pacote torto não derruba a sala: é ignorado.
    }
  }

  private async hello(g: Guest, h: Hello): Promise<void> {
    const refuse = (reason: number, detail = ''): void => {
      this.send(g, this.w.reset(MSG.REFUSE).u8(reason).str(detail).view8());
      setTimeout(() => g.link.close(), 500);
    };
    if (h.protocol !== PROTOCOL || h.content !== localContent()) {
      refuse(REFUSE.VERSION);
      return;
    }
    const mods = activeModIds();
    if (mods.join(',') !== h.mods.join(',')) {
      refuse(REFUSE.MODS, mods.join(','));
      return;
    }
    // O mesmo aparelho voltando antes de a queda ser percebida: fica o novo.
    const old = this.guests.find((x) => x.playerId === h.playerId);
    if (old !== undefined) await this.drop(old);
    if (this.guests.length >= this.maxGuests) {
      refuse(REFUSE.FULL);
      return;
    }
    g.name = h.name.slice(0, 16) || '?';
    g.playerId = h.playerId;
    g.netId = this.freeNetId();
    g.record = (await this.game.save?.loadPlayerRecord(g.playerId)) ?? this.memory.get(g.playerId) ?? null;
    if (g.record !== null) {
      g.x = g.record.x; g.y = g.record.y; g.z = g.record.z;
      g.dim = g.record.dimension ?? DIM_OVERWORLD;
    }
    const { meta, session } = this.game;
    this.send(g, writeWelcome(this.w, {
      netId: g.netId, worldId: meta.id, worldName: meta.name, seed: meta.seed, seedHash: meta.seedHash,
      creative: meta.gameMode === 'creative', difficulty: session.survival.difficulty,
      spawn: [meta.spawn[0], meta.spawn[1], meta.spawn[2]],
      totalTicks: session.dayNight.totalTicks,
      saved: g.record === null ? '' : JSON.stringify(g.record),
      players: [{ netId: 0, name: this.hostName }, ...this.ready().map((x) => ({ netId: x.netId, name: x.name }))],
    }));
    g.ready = true;
    this.guests.push(g);
    for (const other of this.ready()) {
      if (other !== g) this.send(other, this.w.reset(MSG.JOIN).u8(g.netId).str(g.name).view8());
    }
    this.avatars.add(g.netId, g.name);
    if (g.record !== null) this.avatars.move(g.netId, g.x, g.y, g.z, g.record.yaw, g.record.pitch, 0);
    this.combat.refresh(this.ready());
    this.events.message(g.name);
    this.chat?.add(null, `${g.name} — ${t('net.joined')}`);
    this.events.changed();
  }

  /** O anfitrião falou: na tela dele e em todos. */
  private say(text: string): void {
    this.chat?.add(this.hostName, text);
    const bytes = this.w.reset(MSG.CHAT).u8(0).str(text).view8();
    for (const g of this.ready()) this.send(g, bytes);
  }

  /** Um convidado falou: na tela do anfitrião e nos outros convidados. */
  private heard(from: Guest, text: string): void {
    if (text === '') return;
    this.chat?.add(from.name, text);
    const bytes = this.w.reset(MSG.CHAT).u8(from.netId).str(text).view8();
    for (const g of this.ready()) if (g !== from) this.send(g, bytes);
  }

  private move(g: Guest, r: PacketReader): void {
    r.u8();
    const x = r.f32(); const y = r.f32(); const z = r.f32();
    const yaw = r.f32(); const pitch = r.f32(); const flags = r.u8(); const held = r.u16(); const dim = r.u8();
    g.x = x; g.y = y; g.z = z; g.dim = dim;
    // Noutra dimensão (a caminho, ou recém-renascido): nem boneco aqui, nem alvo.
    const away = dim === this.game.world.dimension ? 0 : MOVE_AWAY | MOVE_UNTARGETABLE;
    this.avatars.move(g.netId, x, y, z, yaw, pitch, flags | away, held);
    this.combat.moved(g, flags | away, held);
    const out = this.wFast.reset(MSG.MOVE).u8(g.netId).f32(x).f32(y).f32(z).f32(yaw).f32(pitch).u8(flags)
      .u16(held).u8(dim).view8();
    for (const other of this.guests) if (other !== g && other.ready) other.link.send(out, false);
  }

  /**
   * Pedidos de bloco do convidado: a posição dele na hora, e `x, y, z, estado,
   * anterior` por bloco. A posição vem **junto**, no canal confiável: a do
   * `MOVE` vem pelo rápido e pode chegar depois do pedido — o primeiro bloco
   * de quem acabou de entrar seria medido a partir de (0, 0, 0) e recusado.
   */
  private blocks(g: Guest, r: PacketReader): void {
    const { world } = this.game;
    const dim = r.u8();
    g.x = r.f32(); g.y = r.f32(); g.z = r.f32();
    const count = r.u16();
    const deny = this.w.reset(MSG.BLOCK_DENY);
    const denyCountAt = deny.length;
    deny.u16(0);
    let denied = 0;
    for (let n = 0; n < count; n++) {
      const x = r.i32(); const y = r.u16(); const z = r.i32(); const state = r.u16(); const previous = r.u16();
      const valid = BLOCKS[state & 0x3ff] !== undefined;
      const dx = x + 0.5 - g.x; const dy = y + 0.5 - (g.y + 1.6); const dz = z + 0.5 - g.z;
      const near = dx * dx + dy * dy + dz * dz <= REACH * REACH;
      // Pedido de outra dimensão (a sala mudou no meio): volta, sem ler o mundo daqui.
      const here = dim === world.dimension && world.isLoaded(x, z);
      if (valid && near && here) {
        const before = world.getBlock(x, y, z);
        const spilled = this.spill(before, state, x, y, z);
        this.applyingFrom = g.netId;
        if (world.setBlock(x, y, z, state, 'network')) reactToNetworkBlock(this.game.session, x, y, z, before, state, true);
        this.applyingFrom = 0;
        if (spilled !== null) this.combat.loot(g, spilled);
      } else {
        deny.i32(x).u16(y).i32(z).u16(here ? world.getBlock(x, y, z) : previous);
        denied++;
      }
    }
    if (denied > 0) {
      const bytes = deny.view8();
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(denyCountAt, denied);
      this.send(g, bytes);
    }
  }

  /**
   * O convidado quebrou um contêiner: o conteúdo é dele, e não do chão daqui.
   * Esvazia antes da quebra, e o `removeContainerAt` não deixa cair nada.
   */
  private spill(before: number, state: number, x: number, y: number, z: number): Loot | null {
    if (blockIdOf(before) === blockIdOf(state)) return null;
    const c = this.game.session.tiles.at(x, y, z);
    if (c === undefined) return null;
    const drops: Loot['drops'] = [];
    for (let i = 0; i < c.size; i++) {
      const stack = c.slots[i];
      if (stack !== null) drops.push([x + 0.5, y + 0.5, z + 0.5, stack]);
    }
    c.slots.fill(null);
    return { drops, xp: 0, at: [x + 0.5, y + 0.5, z + 0.5] };
  }

  /**
   * Um chunk para o convidado. Carregado aqui: vai **na hora**, serializado sem
   * compressão — comprimir é assíncrono, e uma mudança de bloco mandada nesse
   * meio-tempo chegaria antes do chunk e se perderia. Fora da memória: sai do
   * banco já comprimido. Nunca modificado: nada, e o convidado gera da seed.
   */
  private async chunk(g: Guest, req: number, cx: number, cz: number, dim: number): Promise<void> {
    const { world, save } = this.game;
    const reply = (kind: number, data: Uint8Array | null): void => {
      const w = this.w.reset(MSG.CHUNK).u32(req).u8(kind);
      if (data !== null) w.bytes(data);
      this.send(g, w.view8());
    };
    if (world.dimension === dim) {
      const column = world.getChunk(cx, cz);
      if (column !== undefined) {
        reply(column.modified ? 1 : 0, column.modified ? serializeChunk(column) : null);
        this.signText?.column(cx, cz, (bytes) => this.send(g, bytes));
        return;
      }
    }
    const stored = save === null ? undefined : await save.loadChunkData(dim, cx, cz);
    reply(stored === undefined ? 0 : 2, stored ?? null);
  }

  /** Um convidado escreveu numa placa: grava aqui e passa aos outros. */
  private signFrom(from: Guest, r: PacketReader): void {
    const sync = this.signText;
    const change = sync === null ? null : sync.apply(r);
    if (sync === null || change === null) return;
    const bytes = sync.write(change.x, change.y, change.z, change.lines);
    for (const g of this.ready()) if (g !== from) this.send(g, bytes);
  }

  private saved(g: Guest, json: string): void {
    let record: PlayerSave;
    try {
      record = JSON.parse(json) as PlayerSave;
    } catch {
      return;
    }
    // O convidado não escolhe em que mundo nem sob que nome é guardado.
    record.worldId = this.game.meta.id;
    record.playerId = g.playerId;
    record.savedAt = Date.now();
    g.record = record;
    void this.persist(g);
  }

  private async persist(g: Guest): Promise<void> {
    if (g.record === null || g.playerId === '') return;
    this.memory.set(g.playerId, g.record);
    try {
      await this.game.save?.savePlayerRecord(g.record);
    } catch {
      // O aviso de save que falhou já sai pelo caminho de sempre.
    }
  }

  private async drop(g: Guest): Promise<void> {
    const i = this.guests.indexOf(g);
    if (i < 0) {
      g.link.close();
      return;
    }
    this.guests.splice(i, 1);
    this.combat.refresh(this.ready());
    this.containers.close(g);
    this.sleep.left(g);
    this.worldSync.left(g);
    this.avatars.remove(g.netId);
    for (const other of this.ready()) this.send(other, this.w.reset(MSG.LEAVE).u8(g.netId).view8());
    if (g.ready) this.chat?.add(null, `${g.name} — ${t('net.left')}`);
    await this.persist(g);
    g.link.close();
    this.events.changed();
  }

  // --- tick ------------------------------------------------------------------------

  private onBlock(change: BlockChange): void {
    if (change.source === 'gen') return;
    if (this.guests.length === 0) return;
    // O lote sai assim que a tarefa em curso termina, e não no fim do tick:
    // até 50 ms a menos entre pôr o bloco e o outro ver. Uma rajada dentro da
    // mesma tarefa (água se espalhando) continua indo num pacote só.
    if (this.batch.length === 0) queueMicrotask(() => this.flushBlocks());
    this.batch.push(change.x, change.y, change.z, change.state, this.applyingFrom);
  }

  private tick(): void {
    this.avatars.tick();
    if (this.guests.length === 0) {
      this.batch.length = 0;
      return;
    }
    this.flushBlocks();
    this.containers.tick();
    this.sleep.tick();
    this.worldSync.tick();
    this.ticks++;
    const { world, player, session } = this.game;
    const flags = (player.sneaking ? MOVE_SNEAK : 0) | (player.flying ? MOVE_FLYING : 0)
      | (session.travel.isTravelling ? MOVE_AWAY : 0);
    const move = this.wFast.reset(MSG.MOVE).u8(0).f32(player.x).f32(player.y).f32(player.z)
      .f32(player.yaw).f32(player.pitch).u8(flags).u16(session.inventory.held?.item ?? 0xffff)
      .u8(world.dimension).view8();
    for (const g of this.guests) if (g.ready) g.link.send(move, false);
    for (const g of this.guests) {
      if (!g.ready) continue;
      // Noutra dimensão, os mobs daqui não são os dele: some tudo.
      if (g.dim === world.dimension) g.link.send(writeMobs(this.wFast, session.mobs.store, g.x, g.z), false);
      else g.link.send(this.wFast.reset(MSG.MOBS).u8(0).view8(), false);
    }
    if (this.ticks % TIME_EVERY === 0) {
      const time = this.w.reset(MSG.TIME).f64(session.dayNight.totalTicks).view8();
      for (const g of this.guests) if (g.ready) this.send(g, time);
    }
  }

  private flushBlocks(): void {
    const b = this.batch;
    if (b.length === 0) return;
    for (const g of this.guests) {
      if (!g.ready) continue;
      let at = 0;
      while (at < b.length) {
        const w = this.w.reset(MSG.BLOCKS).u8(this.game.world.dimension);
        const countAt = w.length;
        w.u16(0);
        let count = 0;
        for (; at < b.length && count < MAX_BATCH; at += 5) {
          if (b[at + 4] === g.netId) continue;
          w.i32(b[at]).u16(b[at + 1]).i32(b[at + 2]).u16(b[at + 3]).u16(0);
          count++;
        }
        if (count === 0) continue;
        const bytes = w.view8();
        new DataView(bytes.buffer, bytes.byteOffset).setUint16(countAt, count);
        this.send(g, bytes);
      }
    }
    b.length = 0;
  }

  private ready(): Guest[] {
    return this.guests.filter((g) => g.ready);
  }

  private freeNetId(): number {
    for (let id = 1; id < 255; id++) {
      if (!this.guests.some((g) => g.netId === id)) return id;
    }
    return 255;
  }

  private send(g: Guest, bytes: Uint8Array): void {
    g.link.send(bytes, true);
  }
}
