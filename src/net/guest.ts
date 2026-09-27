/**
 * O convidado de uma sala na rede local (M20, doc 12).
 *
 * O mundo **não é dele** e nada vai para o banco dele: o terreno sai da seed
 * (é determinístico), e o que difere da geração chega do anfitrião, coluna a
 * coluna, quando o pipeline pede (`loadChunk` no lugar do `loadSaved` do
 * save). Ao sair, fica nada: nem chunk, nem jogador — o jogador fica no mundo
 * do anfitrião, que o recebe a cada 10 s (`SAVE`).
 *
 * O que ele faz no mundo vai como pedido de bloco (`BLOCKS`, com o estado
 * anterior): aplica na hora, sem esperar a volta — a latência de pôr bloco é
 * a coisa mais perceptível (doc 12 §5) —, e desfaz se o anfitrião recusar
 * (`BLOCK_DENY`). O resto da simulação ele não roda (`net/follower.ts`).
 */

import { computeChunkLight } from '../world/gen/terrain';
import { decompressChunk, deserializeChunk } from '../save/serialize';
import { snapshotPlayer } from '../game/playersave';
import { newWorldMeta } from '../ui/menuflow';
import { TICKS_PER_DAY } from '../game/daynight';
import { t } from '../core/i18n';
import type { ChunkColumn } from '../world/chunk';
import type { GameHandles, RemoteStart } from '../game/netgate';
import type { PlayerSave, WorldMeta } from '../save/db';
import type { BlockChange } from '../world/world';
import { Avatars } from './avatars';
import { NameTags } from './nametags';
import { ChatBox, cleanChat, touchScreen } from './chat';
import { attachGuestCombat, type GuestCombat } from './guestcombat';
import { GuestContainers } from './containersync';
import { GuestSleep } from './sleepsync';
import { SignSync } from './signsync';
import { GuestDimension } from './dimensionsync';
import { reactToNetworkBlock } from './blockreact';
import { MobPuppets } from './mobsync';
import { makeFollower } from './follower';
import { activeModIds, localContent, playerId } from './identity';
import { Link } from './link';
import {
  MOVE_AWAY, MOVE_FLYING, MOVE_SNEAK, MOVE_UNTARGETABLE, MSG, PROTOCOL, PacketReader, PacketWriter, readWelcome, writeHello,
  type Welcome,
} from './protocol';
import type { Signal } from './signal';

/** A cada quanto o convidado manda o próprio save ao anfitrião. */
const SAVE_EVERY = 200;
const MAX_BATCH = 4000;

export type JoinOutcome =
  | { kind: 'welcome'; meta: WorldMeta; remote: RemoteStart }
  | { kind: 'refused'; reason: number; detail: string }
  | { kind: 'closed' };

export interface GuestEvents {
  message(text: string): void;
  /** A sala acabou (anfitrião saiu, caiu a rede, expulso). */
  ended(text: string): void;
}

export class GuestClient {
  private readonly w = new PacketWriter();
  private readonly wFast = new PacketWriter(256);
  private readonly chunks = new Map<number, (chunk: ChunkColumn | null) => void>();
  private nextReq = 1;
  private welcome: Welcome | null = null;
  private game: GameHandles | null = null;
  private avatars: Avatars | null = null;
  private chat: ChatBox | null = null;
  private combat: GuestCombat | null = null;
  private containers: GuestContainers | null = null;
  private sleep: GuestSleep | null = null;
  private signText: SignSync | null = null;
  private dimension: GuestDimension | null = null;
  /** A dimensão antes de o jogo estar de pé (a do save guardado no anfitrião). */
  private startDim = 0;
  private puppets: MobPuppets | null = null;
  /** Mudanças locais do tick: `x, y, z, estado, anterior`. */
  private readonly outgoing: number[] = [];
  /** Aplicando o que veio da rede: nada disso volta para o anfitrião. */
  private applying = false;
  private ticks = 0;
  private outcome: ((o: JoinOutcome) => void) | null = null;
  private events: GuestEvents | null = null;
  private over = false;

  private constructor(readonly link: Link, private readonly name: string) {
    link.onMessage = (data, reliable) => this.onMessage(new Uint8Array(data), reliable);
    link.onClose = () => this.end(t('net.connection_lost'));
  }

  /** Lê a oferta do anfitrião e prepara a resposta. */
  static async answer(offer: Signal, name: string): Promise<{ client: GuestClient; answer: Signal }> {
    const { link, answer } = await Link.guest(offer);
    return { client: new GuestClient(link, name), answer };
  }

  /** Espera a ligação abrir, apresenta-se e devolve o que o anfitrião disse. */
  join(): Promise<JoinOutcome> {
    return new Promise((resolve) => {
      this.outcome = resolve;
      const hello = (): void => {
        this.link.send(writeHello(this.w, {
          protocol: PROTOCOL, content: localContent(), name: this.name, playerId: playerId(),
          mods: activeModIds(),
        }), true);
      };
      if (this.link.isOpen) hello();
      else this.link.onOpen = hello;
    });
  }

  cancel(): void {
    this.over = true;
    this.link.close();
  }

  // --- mensagens -------------------------------------------------------------------

  private onMessage(bytes: Uint8Array, reliable: boolean): void {
    const r = new PacketReader(bytes);
    try {
      const type = r.u8();
      switch (type) {
        case MSG.WELCOME: this.onWelcome(readWelcome(r)); break;
        case MSG.REFUSE: this.settle({ kind: 'refused', reason: r.u8(), detail: r.str() }); break;
        case MSG.CHUNK: this.onChunk(r); break;
        case MSG.BLOCKS:
        case MSG.BLOCK_DENY: this.onBlocks(r, type === MSG.BLOCKS); break;
        case MSG.MOVE: if (!reliable) this.onMove(r); break;
        case MSG.MOBS: this.puppets?.receive(bytes); break;
        case MSG.JOIN: this.onJoin(r.u8(), r.str()); break;
        case MSG.LEAVE: this.onLeave(r.u8()); break;
        case MSG.TIME: this.onTime(r.f64()); break;
        case MSG.CHAT: this.onChat(r.u8(), cleanChat(r.str())); break;
        case MSG.LOOT: this.combat?.loot(r); break;
        case MSG.HURT: this.combat?.hurt(r); break;
        case MSG.SPLASH: this.combat?.splash(r); break;
        case MSG.CONTAINERS: this.containers?.receive(r); break;
        case MSG.CONTAINER_GONE: this.containers?.gone(); break;
        case MSG.SLEEP_STATE: this.sleep?.state(r); break;
        case MSG.WAKE: this.sleep?.wake(r); break;
        case MSG.SIGN: this.signText?.apply(r); break;
        case MSG.DIMENSION: this.dimension?.apply(r); break;
        case MSG.BYE: this.end(t('net.host_left')); break;
        default: break;
      }
    } catch {
      // Pacote torto: ignorado.
    }
  }

  private settle(o: JoinOutcome): void {
    const done = this.outcome;
    this.outcome = null;
    done?.(o);
  }

  private onWelcome(m: Welcome): void {
    this.welcome = m;
    const meta = newWorldMeta(m.worldName, m.seed, m.creative ? 'creative' : 'survival',
      Math.max(0, Math.min(3, m.difficulty)) as 0 | 1 | 2 | 3);
    // O mundo é o do anfitrião: a mesma seed de fato, o mesmo nascimento.
    meta.id = m.worldId;
    meta.seedHash = m.seedHash;
    meta.spawn = m.spawn;
    meta.spawnFound = true;
    meta.totalTicks = m.totalTicks;
    meta.time = m.totalTicks;
    let saved: PlayerSave | null = null;
    if (m.saved !== '') {
      try {
        saved = JSON.parse(m.saved) as PlayerSave;
        this.startDim = saved.dimension ?? 0;
      } catch {
        saved = null;
      }
    }
    this.settle({
      kind: 'welcome', meta,
      remote: {
        saved,
        loadChunk: (cx, cz) => this.requestChunk(cx, cz),
        attach: (game) => this.attach(game),
      },
    });
  }

  private requestChunk(cx: number, cz: number): Promise<ChunkColumn | null> {
    if (this.over) return Promise.resolve(null);
    const req = this.nextReq++;
    return new Promise((resolve) => {
      this.chunks.set(req, resolve);
      this.link.send(this.w.reset(MSG.CHUNK_REQ).u32(req).i32(cx).i32(cz).u8(this.currentDim()).view8(), true);
    });
  }

  private onChunk(r: PacketReader): void {
    const req = r.u32();
    const kind = r.u8();
    const resolve = this.chunks.get(req);
    if (resolve === undefined) return;
    this.chunks.delete(req);
    if (kind === 0) {
      resolve(null);
      return;
    }
    const data = r.rest().slice();
    if (kind === 1) {
      resolve(lit(deserializeChunk(data)));
      return;
    }
    // Do banco do anfitrião: ainda comprimido.
    void decompressChunk(data).then((chunk) => resolve(lit(chunk)), () => resolve(null));
  }

  private currentDim(): number {
    return this.game?.world.dimension ?? this.startDim;
  }

  private onBlocks(r: PacketReader, fact: boolean): void {
    if (this.game === null) return;
    const { world, session } = this.game;
    // Blocos de outra dimensão (a sala está mudando): não são deste mundo.
    if (fact && r.u8() !== world.dimension) return;
    const count = r.u16();
    this.applying = true;
    for (let n = 0; n < count; n++) {
      const x = r.i32(); const y = r.u16(); const z = r.i32(); const state = r.u16();
      if (fact) r.u16();
      const before = world.getBlock(x, y, z);
      if (world.setBlock(x, y, z, state, 'network')) reactToNetworkBlock(session, x, y, z, before, state, false);
    }
    this.applying = false;
    if (!fact) this.events?.message(t('net.denied'));
  }

  private onMove(r: PacketReader): void {
    const netId = r.u8();
    const x = r.f32(); const y = r.f32(); const z = r.f32(); const yaw = r.f32(); const pitch = r.f32();
    const flags = r.u8(); const held = r.u16(); const dim = r.u8();
    this.avatars?.move(netId, x, y, z, yaw, pitch, flags | (dim === this.currentDim() ? 0 : MOVE_AWAY), held);
  }

  private onJoin(netId: number, name: string): void {
    this.avatars?.add(netId, name);
    this.events?.message(`${name} — ${t('net.joined')}`);
    this.chat?.add(null, `${name} — ${t('net.joined')}`);
  }

  private onLeave(netId: number): void {
    const gone = this.avatars?.remove(netId);
    if (gone === undefined) return;
    this.events?.message(`${gone.name} — ${t('net.left')}`);
    this.chat?.add(null, `${gone.name} — ${t('net.left')}`);
  }

  private onChat(netId: number, text: string): void {
    if (text === '') return;
    this.chat?.add(this.avatars?.get(netId)?.name ?? '?', text);
  }

  private onTime(totalTicks: number): void {
    const dayNight = this.game?.session.dayNight;
    if (dayNight === undefined) return;
    dayNight.totalTicks = totalTicks;
    dayNight.time = totalTicks % TICKS_PER_DAY;
  }

  // --- o jogo de pé ---------------------------------------------------------------

  private attach(game: GameHandles): void {
    this.game = game;
    const m = this.welcome;
    const { session, world, sceneFeed, hud } = game;
    this.events = {
      message: (text) => hud.showMessage(text, 80),
      ended: (text) => hud.showMessage(text, 200),
    };
    makeFollower(session);
    this.containers = new GuestContainers(session, (bytes) => this.link.send(bytes, true));
    this.dimension = new GuestDimension(game);
    this.signText = new SignSync(session.signs, (bytes) => this.link.send(bytes, true));
    this.sleep = new GuestSleep(game, (bytes) => this.link.send(bytes, true), (totalTicks) => this.onTime(totalTicks));
    this.avatars = new Avatars(world, game.mobRenderer, game.entityAtlas, () => session.dayNight.dayFactor);
    if (m !== null) {
      for (const p of m.players) this.avatars.add(p.netId, p.name);
      this.onTime(m.totalTicks);
    }
    this.puppets = new MobPuppets(session.mobs.store);
    this.combat = attachGuestCombat(session, this.puppets, (bytes) => this.link.send(bytes, true));
    const tags = new NameTags(game.camera, game.canvas);
    const me = this.name;
    this.chat = new ChatBox((text) => {
      this.chat?.add(me, text);
      this.link.send(this.w.reset(MSG.CHAT).str(text).view8(), true);
    }, touchScreen());
    sceneFeed.extraEntities = (alpha) => {
      if (this.avatars === null) return;
      this.avatars.draw(alpha);
      tags.update(this.avatars.list, alpha);
    };
    sceneFeed.extraItems = (items, alpha) => this.avatars?.drawItems(items, alpha);
    world.onBlockChange((change) => this.onLocalBlock(change));
    const base = session.tick.bind(session);
    session.tick = (): void => {
      base();
      this.tick();
    };
    hud.showMessage(t('net.connected'), 100);
  }

  private onLocalBlock(change: BlockChange): void {
    if (this.applying || change.source === 'gen' || change.source === 'network') return;
    // Como no anfitrião: sai quando a tarefa em curso termina, sem esperar o tick.
    if (this.outgoing.length === 0) queueMicrotask(() => this.flushBlocks());
    this.outgoing.push(change.x, change.y, change.z, change.state, change.previous);
  }

  private tick(): void {
    const game = this.game;
    if (game === null || this.over) return;
    this.avatars?.tick();
    this.puppets?.tick();
    this.flushBlocks();
    this.containers?.tick();
    const p = game.player;
    const { session } = game;
    const safe = session.survival.isDead || p.mode !== 'survival';
    const flags = (p.sneaking ? MOVE_SNEAK : 0) | (p.flying ? MOVE_FLYING : 0) | (safe ? MOVE_UNTARGETABLE : 0);
    this.link.send(this.wFast.reset(MSG.MOVE).u8(0).f32(p.x).f32(p.y).f32(p.z)
      .f32(p.yaw).f32(p.pitch).u8(flags).u16(session.inventory.held?.item ?? 0xffff)
      .u8(game.world.dimension).view8(), false);
    if (++this.ticks % SAVE_EVERY === 0) this.sendSave();
  }

  private flushBlocks(): void {
    const b = this.outgoing;
    const p = this.game?.player;
    let at = 0;
    while (at < b.length) {
      const w = this.w.reset(MSG.BLOCKS).u8(this.currentDim()).f32(p?.x ?? 0).f32(p?.y ?? 0).f32(p?.z ?? 0);
      const countAt = w.length;
      w.u16(0);
      let count = 0;
      for (; at < b.length && count < MAX_BATCH; at += 5, count++) {
        w.i32(b[at]).u16(b[at + 1]).i32(b[at + 2]).u16(b[at + 3]).u16(b[at + 4]);
      }
      const bytes = w.view8();
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(countAt, count);
      this.link.send(bytes, true);
    }
    b.length = 0;
  }

  private sendSave(): void {
    const game = this.game;
    const m = this.welcome;
    if (game === null || m === null) return;
    const record = snapshotPlayer(game.session, game.player, m.worldId, playerId());
    this.link.send(this.w.reset(MSG.SAVE).str(JSON.stringify(record)).view8(), true);
  }

  /** Saída pelo menu: o último save, o adeus e um instante para a mensagem sair. */
  async leave(): Promise<void> {
    if (this.over) return;
    this.flushBlocks();
    this.sendSave();
    this.link.send(this.w.reset(MSG.BYE).u8(0).view8(), true);
    this.over = true;
    await new Promise((r) => setTimeout(r, 300));
    this.link.close();
  }

  private end(text: string): void {
    if (this.over) return;
    this.over = true;
    for (const resolve of this.chunks.values()) resolve(null);
    this.chunks.clear();
    if (this.outcome !== null) {
      this.settle({ kind: 'closed' });
      return;
    }
    this.events?.ended(text);
    // Sem o anfitrião, o mundo não existe: volta ao título.
    setTimeout(() => location.reload(), 4000);
  }
}

/** A luz não viaja (doc 11 §2): recalcula antes de entregar ao pipeline. */
function lit(chunk: ChunkColumn): ChunkColumn {
  computeChunkLight(chunk);
  return chunk;
}
