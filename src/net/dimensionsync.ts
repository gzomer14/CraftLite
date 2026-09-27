/**
 * A sala segue o anfitrião (M20): dimensão, colunas e bichos em volta de quem
 * está longe.
 *
 * **Uma dimensão por vez.** O anfitrião guarda uma dimensão carregada por vez
 * (é do M7: num aparelho de 2 GB, as duas custariam o dobro). Então a sala
 * inteira está onde ele está: quando ele atravessa um portal, os convidados
 * vão junto e aparecem ao lado dele. O convidado não atravessa sozinho — o
 * portal é do anfitrião —, e quem renasce na superfície com o anfitrião no
 * Nether é trazido de volta para perto dele. A regra é uma só, conferida duas
 * vezes por segundo: convidado noutra dimensão recebe `DIMENSION` com a
 * dimensão e a posição do anfitrião.
 *
 * **Colunas em volta de cada convidado.** O anel do anfitrião é em volta dele;
 * o convidado que se afasta precisa do mundo rodando lá — para pôr bloco,
 * para os bichos andarem. Cada convidado é uma âncora do pipeline
 * (`world/pipeline.ts`), com raio 3 e sem malha.
 *
 * **Bichos nascem perto do convidado também**: o ciclo de spawn roda em volta
 * de cada um, com o mesmo teto por categoria (o mundo não fica mais cheio por
 * ter mais gente, como no gênero sem regra por jogador).
 */

import { CATEGORIES, SPAWN_INTERVAL } from '../entity/spawn';
import type { GameHandles } from '../game/netgate';
import { MSG, PacketWriter, type PacketReader } from './protocol';

/** Conferir a cada tantos ticks (meio segundo). */
const CHECK_EVERY = 10;
/** Não puxar o mesmo convidado de novo antes disto: a ida leva um tempo. */
const PULL_AGAIN = 100;
/** Desiste de esperar o chão do outro lado depois disto (30 s). */
const ARRIVE_TIMEOUT = 600;

export interface RoomMember { x: number; y: number; z: number; dim: number }

export class HostWorld<G extends RoomMember> {
  private readonly w = new PacketWriter(32);
  private readonly pulledAt = new Map<G, number>();
  private readonly anchors: number[] = [];
  private ticks = 0;
  private cursor = 0;

  constructor(
    private readonly game: GameHandles,
    private readonly guests: () => readonly G[],
    private readonly send: (g: G, bytes: Uint8Array) => void,
  ) {}

  tick(): void {
    this.ticks++;
    const guests = this.guests();
    const { world, player, session, pipeline } = this.game;
    if (this.ticks % SPAWN_INTERVAL === 0 && session.spawner.difficulty !== 0) {
      for (const g of guests) {
        if (g.dim !== world.dimension) continue;
        session.spawner.runCycle(CATEGORIES[this.cursor++ % CATEGORIES.length], g.x, g.y, g.z);
      }
    }
    if (this.ticks % CHECK_EVERY !== 0) return;
    const settled = !session.travel.isTravelling && world.isLoaded(Math.floor(player.x), Math.floor(player.z));
    const anchors = this.anchors;
    anchors.length = 0;
    for (const g of guests) {
      if (g.dim === world.dimension) {
        anchors.push(Math.floor(g.x) >> 4, Math.floor(g.z) >> 4);
        continue;
      }
      if (!settled || this.ticks - (this.pulledAt.get(g) ?? -PULL_AGAIN) < PULL_AGAIN) continue;
      this.pulledAt.set(g, this.ticks);
      this.send(g, this.w.reset(MSG.DIMENSION).u8(world.dimension).f32(player.x).f32(player.y).f32(player.z).view8());
    }
    pipeline.setAnchors(anchors);
  }

  left(g: G): void {
    this.pulledAt.delete(g);
  }

  uninstall(): void {
    this.game.pipeline.setAnchors([]);
    this.pulledAt.clear();
  }
}

/**
 * Convidado: atravessa quando o anfitrião manda, e fica parado — a física
 * congelada, como numa viagem de portal — até o chão do outro lado chegar.
 * O portal daqui não leva a lugar nenhum: a sala vai com o anfitrião.
 */
export class GuestDimension {
  private target: [number, number, number] | null = null;
  private waited = 0;

  constructor(private readonly game: GameHandles) {
    game.session.travel.tick = () => this.tick();
  }

  /** `DIMENSION`: a sala está ali. */
  apply(r: PacketReader): void {
    const dim = r.u8(); const x = r.f32(); const y = r.f32(); const z = r.f32();
    const { session } = this.game;
    session.workbench.closeScreen();
    if (dim !== session.world.dimension) session.enterDimension(dim, Math.floor(x), Math.floor(z));
    this.target = [x, y, z];
    this.waited = 0;
    session.travel.phase = 'loading';
  }

  private tick(): boolean {
    const target = this.target;
    if (target === null) return false;
    const { world, player, session } = this.game;
    this.waited++;
    if (!world.isLoaded(Math.floor(target[0]), Math.floor(target[2])) && this.waited < ARRIVE_TIMEOUT) return true;
    player.setPosition(target[0], target[1], target[2]);
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.fallDistance = 0;
    this.target = null;
    session.travel.phase = 'idle';
    return false;
  }
}
