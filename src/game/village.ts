/**
 * A aldeia na thread principal (M9): quem mora onde, a reputação do jogador, o
 * sino e as portas que os aldeões abrem.
 *
 * **Moradores nascem com o chunk da casa, não com a geração.** A geração
 * (`world/gen/village.ts`) planta a casa; aqui, quando um chunk entra no mundo
 * — gerado agora ou lido do save —, o plano da seed diz se ele tem casa com
 * morador, e a cama é procurada na coluna. Achou a cama, nasce o aldeão com
 * casa, porta e posto de trabalho. É o que mantém a aldeia habitada mesmo
 * depois de o jogador mexer no chunk (chunk salvo não passa pela geração de
 * novo, e os marcos de geração se perderiam).
 *
 * Quando o chunk da casa sai do mundo, o morador sai junto: mob não vai para o
 * save (doc 11 §2, ver `game/savegame.ts`), e o chunk que voltar traz o morador
 * de volta. O golem segue o chunk do poço do mesmo jeito.
 *
 * A **reputação** é por aldeia (a chave é o chunk do poço): bater num aldeão
 * fecha as trocas da aldeia por um dia e vira os golems dela contra o jogador.
 * O prazo vai para a meta do mundo — recarregar não apaga a má fama.
 */

import { BLOCK_BY_NAME, blockIdOf, stateBitsOf } from '../data/blocks';
import { MOB_BY_NAME } from '../data/mobs';
import { WELL_BELL, VILLAGE_HOUSES } from '../data/structures';
import { BELL_RADIUS, TRADE_BAN_TICKS } from '../data/villagers';
import { ringAlarm } from '../entity/ai/villagegoals';
import { FLAG_ANGRY, FLAG_TRADING } from '../entity/mobstore';
import { WORLD_HEIGHT, type ChunkColumn } from '../world/chunk';
import { houseSlot, isVillageAnchor, slotOrigin, type HouseSlot } from '../world/gen/village';
import type { MobStore } from '../entity/mobstore';
import type { World } from '../world/world';
import { t } from '../core/i18n';

const VILLAGER = MOB_BY_NAME.get('villager')?.id ?? -1;
const GOLEM = MOB_BY_NAME.get('iron_golem')?.id ?? -1;
const BED = BLOCK_BY_NAME.get('bed')?.id ?? -1;
const BELL = BLOCK_BY_NAME.get('bell')?.id ?? -1;
/** Faixa de altura em que a cama e o sino são procurados. */
const SCAN_TOP = WORLD_HEIGHT - 8;
const SCAN_BOTTOM = 40;
/** Distância além da qual a troca aberta fecha sozinha. */
export const TRADE_REACH = 8;

export interface VillageHost {
  readonly world: World;
  readonly mobs: MobStore;
  readonly seed: number;
  /** Ticks desde o início do mundo — o relógio da reputação. */
  totalTicks(): number;
  sound(name: string, x: number, y: number, z: number): void;
  message(text: string): void;
  /** Abre a porta em `(x, y, z)` se `open` for diferente do estado atual. */
  toggleDoor(x: number, y: number, z: number): void;
  /** Pool de mobs cheio: libera um slot de mob comum. false se não há. */
  makeRoom(): boolean;
}

export class Villages {
  private readonly host: VillageHost;
  /** Até quando as trocas de cada aldeia estão fechadas, por chave do poço. */
  private readonly bans = new Map<string, number>();
  private readonly slot: HouseSlot = {
    ox: 0, oz: 0, profession: 0, occupied: false, anchorX: 0, anchorZ: 0,
  };
  private readonly origin = new Int32Array(2);

  constructor(host: VillageHost) {
    this.host = host;
  }

  // --- moradores ----------------------------------------------------------------

  /** Chunk entrou no mundo: nasce o morador da casa dele, e o golem no do poço. */
  onChunkLoaded(chunk: ChunkColumn): void {
    const { seed } = this.host;
    if (VILLAGER >= 0 && houseSlot(seed, chunk.cx, chunk.cz, this.slot) && this.slot.occupied) {
      this.settle(this.slot);
    }
    if (GOLEM >= 0 && isVillageAnchor(seed, chunk.cx, chunk.cz)) this.guard(chunk.cx, chunk.cz);
  }

  /** Chunk saiu do mundo: quem mora nele sai junto (volta com ele). */
  onChunkUnloaded(chunk: ChunkColumn): void {
    const s = this.host.mobs;
    const v = s.village;
    for (let i = 0; i < s.active; i++) {
      if (v.member[i] === 0) continue;
      const homeX = v.hasHome[i] === 1 ? v.homeX[i] : v.centerX[i];
      const homeZ = v.hasHome[i] === 1 ? v.homeZ[i] : v.centerZ[i];
      if (homeX >> 4 !== chunk.cx || homeZ >> 4 !== chunk.cz) continue;
      s.removeAt(i);
      i--;
    }
  }

  private settle(slot: HouseSlot): void {
    const { mobs } = this.host;
    const house = VILLAGE_HOUSES[slot.profession];
    const bedX = slot.ox + house.bed[0];
    const bedZ = slot.oz + house.bed[2];
    // A cama diz a altura da casa — e se ela existe: bioma e relevo podem ter
    // impedido a casa de nascer, e o jogador pode ter quebrado a cama.
    const bedY = this.scanFor(bedX, bedZ, BED);
    if (bedY < 0) return;
    if (this.residentOf(bedX, bedY, bedZ) >= 0) return;

    const oy = bedY - house.bed[1];
    const i = this.spawn(
      VILLAGER, slot.ox + house.door[0] + 0.5, oy + 1, slot.oz + house.door[2] + 2.5, slot.profession,
    );
    if (i < 0) return;
    const v = mobs.village;
    v.setHome(
      i, bedX, bedY, bedZ,
      slot.ox + house.door[0], oy + house.door[1], slot.oz + house.door[2], house.doorOut,
    );
    v.setWork(i, slot.ox + house.work[0], oy + house.work[1], slot.oz + house.work[2]);
    slotOrigin(this.host.seed, slot.anchorX, slot.anchorZ, this.origin);
    v.setCenter(i, this.origin[0] + 2, oy, this.origin[1] + 2);
  }

  private guard(cx: number, cz: number): void {
    const { mobs } = this.host;
    slotOrigin(this.host.seed, cx, cz, this.origin);
    const bellX = this.origin[0] + WELL_BELL[0];
    const bellZ = this.origin[1] + WELL_BELL[2];
    const bellY = this.scanFor(bellX, bellZ, BELL);
    if (bellY < 0) return;
    const floor = bellY - WELL_BELL[1] + 1;
    const v = mobs.village;
    for (let k = 0; k < mobs.active; k++) {
      if (mobs.type[k] === GOLEM && v.member[k] === 1
        && v.centerX[k] === bellX && v.centerZ[k] === bellZ) return;
    }
    // Ao lado do poço, fora do anel de caminho.
    const i = this.spawn(GOLEM, this.origin[0] - 2.5, floor, this.origin[1] + 2.5);
    if (i < 0) return;
    v.setCenter(i, bellX, floor, bellZ);
  }

  /** Nasce com prioridade: com o pool cheio, toma a vaga de um mob comum. */
  private spawn(type: number, x: number, y: number, z: number, variant = 0): number {
    const { mobs } = this.host;
    const i = mobs.spawn(type, x, y, z, variant);
    if (i >= 0 || !this.host.makeRoom()) return i;
    return mobs.spawn(type, x, y, z, variant);
  }

  /** Altura do bloco `id` na coluna `(x, z)`, de cima para baixo, ou −1. */
  private scanFor(x: number, z: number, id: number): number {
    const world = this.host.world;
    for (let y = SCAN_TOP; y >= SCAN_BOTTOM; y--) {
      if (blockIdOf(world.getBlock(x, y, z)) === id) return y;
    }
    return -1;
  }

  /** O aldeão que mora na cama `(x, y, z)`, ou −1. */
  private residentOf(x: number, y: number, z: number): number {
    const s = this.host.mobs;
    const v = s.village;
    for (let i = 0; i < s.active; i++) {
      if (v.hasHome[i] === 1 && v.homeX[i] === x && v.homeY[i] === y && v.homeZ[i] === z) return i;
    }
    return -1;
  }

  // --- reputação ---------------------------------------------------------------

  /** O jogador acertou um mob: se é da aldeia, a aldeia lembra. */
  onHurtByPlayer(i: number): void {
    const s = this.host.mobs;
    const v = s.village;
    if (v.member[i] === 0 || s.type[i] !== VILLAGER) return;
    const key = keyOf(v.centerX[i], v.centerZ[i]);
    this.bans.set(key, this.host.totalTicks() + TRADE_BAN_TICKS);
    // Os golems da aldeia se viram contra quem bateu.
    for (let k = 0; k < s.active; k++) {
      if (s.type[k] !== GOLEM || v.member[k] === 0) continue;
      if (keyOf(v.centerX[k], v.centerZ[k]) !== key) continue;
      s.setFlag(k, FLAG_ANGRY, true);
      s.hasTarget[k] = 1;
    }
  }

  /** true se a aldeia deste aldeão não negocia com o jogador agora. */
  isBanned(i: number): boolean {
    const v = this.host.mobs.village;
    if (v.member[i] === 0) return false;
    const until = this.bans.get(keyOf(v.centerX[i], v.centerZ[i]));
    return until !== undefined && this.host.totalTicks() < until;
  }

  /** Prazos em aberto, para a meta do mundo: `[x, z, até, x, z, até, …]`. */
  saveBans(): number[] {
    const now = this.host.totalTicks();
    const out: number[] = [];
    for (const [key, until] of this.bans) {
      if (until <= now) continue;
      const [x, z] = key.split(',').map(Number);
      out.push(x, z, until);
    }
    return out;
  }

  loadBans(flat: readonly number[] | undefined): void {
    this.bans.clear();
    if (flat === undefined) return;
    for (let i = 0; i + 2 < flat.length; i += 3) this.bans.set(keyOf(flat[i], flat[i + 1]), flat[i + 2]);
  }

  // --- sino e porta ------------------------------------------------------------

  /** Clique no sino: toca, e os aldeões por perto correm para casa. */
  ringBell(x: number, y: number, z: number): boolean {
    if (blockIdOf(this.host.world.getBlock(x, y, z)) !== BELL) return false;
    this.host.sound('block/bell', x + 0.5, y + 0.5, z + 0.5);
    const count = ringAlarm(this.host.mobs, x + 0.5, z + 0.5, BELL_RADIUS);
    if (count > 0) this.host.message(t('msg.villagers_home'));
    return true;
  }

  /** Um aldeão quer a porta aberta (ou fechada): só mexe se estiver no outro estado. */
  onDoor(x: number, y: number, z: number, open: boolean): void {
    const state = this.host.world.getBlock(x, y, z);
    const isOpen = (stateBitsOf(state) & 4) !== 0;
    if (isOpen !== open) this.host.toggleDoor(x, y, z);
  }

  // --- troca -------------------------------------------------------------------

  /** O aldeão com a tela de troca aberta, ou −1. Achado pela marca, não pelo índice. */
  trader(): number {
    const s = this.host.mobs;
    for (let i = 0; i < s.active; i++) {
      if (s.type[i] === VILLAGER && s.hasFlag(i, FLAG_TRADING)) return i;
    }
    return -1;
  }

  /** Solta todo mundo que estava negociando (a tela fechou). */
  stopTrading(): void {
    const s = this.host.mobs;
    for (let i = 0; i < s.active; i++) s.setFlag(i, FLAG_TRADING, false);
  }

  /** true se o mob é um aldeão (o clique direito nele abre a troca). */
  isVillager(i: number): boolean {
    return this.host.mobs.type[i] === VILLAGER;
  }
}

function keyOf(x: number, z: number): string {
  return `${x},${z}`;
}
