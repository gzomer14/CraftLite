/**
 * Travessia de dimensão (doc 14 — M7).
 *
 * Três estados e nada mais: **parado**, **carregando** (a dimensão trocou e o
 * chunk de destino ainda não chegou) e **chegando** (o chunk chegou, falta pôr
 * o jogador do outro lado).
 *
 * O estado do meio existe porque o pipeline é assíncrono: trocar de dimensão
 * descarrega tudo, e o terreno do outro lado leva alguns frames para aparecer.
 * Sem esperar, o jogador cairia pelo mundo vazio — que foi exatamente o que a
 * primeira versão fez.
 *
 * Fica fora da `Session` para poder ser testado com um mundo de mentira: quem
 * troca pipeline, save e céu é o `main.ts`, e isso entra aqui como um callback.
 */

import { DIM_END, DIM_OVERWORLD } from '../data/dimensions';
import { arriveAt, destinationOf, isPortalBlock } from './portal';
import { buildEndPlatform, isEndPortal, type BlockChanged } from './endportal';
import { END_SPAWN_Z, endArrivalX } from '../world/gen/end';
import { freeStandY } from './spawnplacement';
import { WORLD_HEIGHT } from '../world/chunk';
import type { World } from '../world/world';
import { t } from '../core/i18n';

/**
 * Ticks dentro do portal até a travessia. 1 s — tempo de o jogador notar que
 * entrou, e curto o bastante para não parecer travado.
 */
export const PORTAL_TICKS = 20;
/**
 * Ticks de carência ao chegar, antes de o portal contar de novo.
 *
 * Sem ele o jogador sai dentro do portal do outro lado, a contagem recomeça e
 * ele volta sozinho — um pêndulo entre as dimensões.
 */
export const COOLDOWN_TICKS = 80;
/** Depois disto o mundo de destino é considerado perdido e a viagem é abortada. */
export const LOAD_TIMEOUT_TICKS = 600;

export type TravelPhase = 'idle' | 'loading' | 'done';

/**
 * Por onde se viaja (M16): o portal do Nether (ida e volta), o do End que
 * leva à ilha, e o portal de saída que traz para casa depois do dragão.
 */
export type TravelRoute = 'nether' | 'end_in' | 'end_out';

export interface TravelEvents {
  /**
   * A dimensão mudou: quem ouve troca o pipeline, o destino do save e o céu,
   * e **leva o jogador para `(x, z)`**. Chamado antes de o mundo novo ter
   * qualquer chunk.
   *
   * As coordenadas vêm junto porque o pipeline carrega o anel em volta do
   * jogador: deixá-lo onde estava faz o mundo nascer a 1/8 de distância do
   * destino e o chunk esperado não chega nunca. Ver `begin`.
   */
  onDimensionChange(dimension: number, x: number, z: number): void;
  /** O jogador saiu do outro lado, nestas coordenadas, pela rota dada. */
  onArrive(x: number, y: number, z: number, route: TravelRoute): void;
  /** Aviso curto para o HUD. */
  onMessage?(text: string): void;
  /**
   * Para onde o portal de saída do End leva (M16): a cama, com o Y dela, ou o
   * nascimento do mundo com Y −1 (o chão é procurado quando a coluna chegar).
   */
  homePoint?(): readonly [number, number, number];
  /** Um bloco mudou pela viagem (a plataforma do End): luz e fluidos. */
  blockChanged?: BlockChanged;
}

export class Travel {
  private readonly world: World;
  private readonly events: TravelEvents;

  /** Ticks acumulados dentro do portal. */
  private charge = 0;
  private cooldown = 0;
  private waiting = 0;
  /** Destino pendente enquanto o chunk não chega. */
  private targetX = 0;
  private targetZ = 0;
  /** Y de chegada já sabido (a cama), ou −1. */
  private targetY = -1;
  private route: TravelRoute = 'nether';

  phase: TravelPhase = 'idle';

  constructor(world: World, events: TravelEvents) {
    this.world = world;
    this.events = events;
  }

  /** 0..1 do carregamento do portal, para o HUD desenhar se quiser. */
  get progress(): number {
    return Math.min(1, this.charge / PORTAL_TICKS);
  }

  get isTravelling(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * Um tick. `(x, y, z)` são os pés do jogador.
   *
   * Devolve true enquanto a viagem estiver em curso — o chamador usa isso para
   * congelar a física: cair pelo mundo vazio enquanto o destino carrega não é
   * viagem, é morte.
   */
  tick(x: number, y: number, z: number): boolean {
    if (this.cooldown > 0) this.cooldown--;
    if (this.phase === 'loading') {
      this.tickLoading();
      return true;
    }

    let kind = this.cooldown > 0 ? null : this.portalAt(x, y, z);
    // No End o portal de obsidiana não leva a lugar nenhum, como no gênero.
    if (kind === 'nether' && this.world.dimension === DIM_END) kind = null;
    if (kind === null) {
      this.charge = 0;
      return false;
    }
    this.charge++;
    // O do End leva na hora, como no gênero; o do Nether carrega um segundo.
    if (kind === 'nether' && this.charge < PORTAL_TICKS) return false;

    this.begin(Math.floor(x), Math.floor(z), kind);
    return true;
  }

  /**
   * Começa a travessia a partir da dimensão atual.
   *
   * **O jogador vai para o destino agora**, antes de o terreno existir, e é por
   * isso que o evento leva as coordenadas. O pipeline carrega o anel em volta
   * dele; com a escala 1:8, deixá-lo parado onde estava punha o anel a até 700
   * blocos do chunk que a viagem espera — que então não chegava nunca, a
   * viagem estourava o tempo limite e o jogador ficava preso dentro da rocha,
   * sem portal (relato de campo 2026-09-13). Funcionava só perto da origem,
   * onde a diferença entre a posição antiga e o destino cabe no render
   * distance. A física está congelada enquanto isto dura, então mover antes de
   * haver chão é seguro — o Y certo sai de `arriveAt` na chegada.
   */
  begin(x: number, z: number, kind: 'nether' | 'end' = 'nether'): void {
    let dimension: number;
    let message: string;
    this.targetY = -1;
    if (kind === 'end' && this.world.dimension === DIM_END) {
      // Portal de saída: para casa, na cama ou no nascimento do mundo.
      const home = this.events.homePoint?.() ?? [0, -1, 0];
      this.route = 'end_out';
      this.targetX = Math.floor(home[0]);
      this.targetY = home[1];
      this.targetZ = Math.floor(home[2]);
      dimension = DIM_OVERWORLD;
      message = t('travel.home');
    } else if (kind === 'end') {
      this.route = 'end_in';
      this.targetX = endArrivalX(this.world.seed);
      this.targetZ = END_SPAWN_Z;
      dimension = DIM_END;
      message = t('travel.end');
    } else {
      const destination = destinationOf(x, z, this.world.dimension);
      this.route = 'nether';
      this.targetX = destination.x;
      this.targetZ = destination.z;
      dimension = destination.dimension;
      message = dimension === DIM_OVERWORLD ? t('travel.overworld') : t('travel.nether');
    }
    this.charge = 0;
    this.waiting = 0;
    this.phase = 'loading';
    this.events.onDimensionChange(dimension, this.targetX, this.targetZ);
    this.events.onMessage?.(message);
  }

  /**
   * Espera o chunk de destino. Só há uma condição de saída boa — o chunk
   * carregado — e uma ruim, o tempo limite, que devolve o jogador ao lugar onde
   * estava em vez de deixá-lo num mundo vazio.
   */
  private tickLoading(): void {
    this.waiting++;
    if (!this.world.isLoaded(this.targetX, this.targetZ)) {
      if (this.waiting < LOAD_TIMEOUT_TICKS) return;
      this.fail();
      return;
    }

    const spot = this.arrival();
    if (spot === null) {
      this.fail();
      return;
    }
    this.phase = 'done';
    this.cooldown = COOLDOWN_TICKS;
    this.events.onArrive(spot.x, spot.y, spot.z, this.route);
    this.phase = 'idle';
  }

  /** Onde a rota põe o jogador, com o chunk de destino já carregado. */
  private arrival(): { x: number; y: number; z: number } | null {
    if (this.route === 'end_in') {
      return buildEndPlatform(this.world, this.events.blockChanged ?? noChange);
    }
    if (this.route === 'end_out') {
      const x = this.targetX;
      const z = this.targetZ;
      if (this.targetY >= 0) return { x: x + 0.5, y: this.targetY, z: z + 0.5 };
      const chunk = this.world.getChunk(x >> 4, z >> 4);
      const height = chunk?.heightMap[((z & 15) << 4) | (x & 15)] ?? 70;
      const y = freeStandY(this.world, x, Math.min(height + 1, WORLD_HEIGHT - 2), z);
      return { x: x + 0.5, y, z: z + 0.5 };
    }
    return arriveAt(this.world, this.targetX, this.targetZ, this.world.dimension);
  }

  private fail(): void {
    this.phase = 'idle';
    this.cooldown = COOLDOWN_TICKS;
    this.events.onMessage?.(t('travel.no_exit'));
  }

  /** Que portal ocupa um dos dois blocos do jogador, ou `null`. */
  private portalAt(x: number, y: number, z: number): 'nether' | 'end' | null {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const by = Math.floor(y + 0.1);
    for (let dy = 0; dy <= 1; dy++) {
      const state = this.world.getBlock(bx, by + dy, bz);
      if (isPortalBlock(state)) return 'nether';
      if (isEndPortal(state)) return 'end';
    }
    return null;
  }
}

function noChange(): void { /* ninguém ouve */ }
