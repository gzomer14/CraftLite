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

import { DIM_OVERWORLD } from '../data/dimensions';
import { arriveAt, destinationOf, isPortalBlock } from './portal';
import type { World } from '../world/world';

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

export interface TravelEvents {
  /**
   * A dimensão mudou: quem ouve troca o pipeline, o destino do save e o céu.
   * Chamado **antes** de o mundo novo ter qualquer chunk.
   */
  onDimensionChange(dimension: number): void;
  /** O jogador saiu do outro lado, nestas coordenadas. */
  onArrive(x: number, y: number, z: number): void;
  /** Aviso curto para o HUD. */
  onMessage?(text: string): void;
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

    if (this.cooldown > 0 || !this.insidePortal(x, y, z)) {
      this.charge = 0;
      return false;
    }
    this.charge++;
    if (this.charge < PORTAL_TICKS) return false;

    this.begin(Math.floor(x), Math.floor(z));
    return true;
  }

  /** Começa a travessia a partir da dimensão atual. */
  begin(x: number, z: number): void {
    const destination = destinationOf(x, z, this.world.dimension);
    this.targetX = destination.x;
    this.targetZ = destination.z;
    this.charge = 0;
    this.waiting = 0;
    this.phase = 'loading';
    this.events.onDimensionChange(destination.dimension);
    this.events.onMessage?.(
      destination.dimension === DIM_OVERWORLD ? 'Voltando à superfície…' : 'Entrando no Nether…',
    );
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

    const spot = arriveAt(this.world, this.targetX, this.targetZ, this.world.dimension);
    if (spot === null) {
      this.fail();
      return;
    }
    this.phase = 'done';
    this.cooldown = COOLDOWN_TICKS;
    this.events.onArrive(spot.x, spot.y, spot.z);
    this.phase = 'idle';
  }

  private fail(): void {
    this.phase = 'idle';
    this.cooldown = COOLDOWN_TICKS;
    this.events.onMessage?.('O portal não encontrou saída.');
  }

  /** true se algum dos dois blocos ocupados pelo jogador é portal. */
  private insidePortal(x: number, y: number, z: number): boolean {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const by = Math.floor(y + 0.1);
    return isPortalBlock(this.world.getBlock(bx, by, bz))
      || isPortalBlock(this.world.getBlock(bx, by + 1, bz));
  }
}
