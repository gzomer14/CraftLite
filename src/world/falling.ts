/**
 * Blocos que caem: areia, areia vermelha e cascalho (doc 03 §9, doc 04 §2.1).
 *
 * A flag `gravity` estava na tabela de blocos desde o M1 e **nenhum módulo a
 * lia** — uma torre de areia ficava de pé sem base. Este módulo é o leitor.
 *
 * Duas metades, como o fogo e o crescimento:
 *
 * 1. **Quem cai.** Toda mudança de bloco (que não seja de geração) olha a
 *    própria posição e os seis vizinhos. Um bloco com `gravity` que ficou com
 *    espaço livre embaixo entra numa fila e, no tick seguinte, sai do mundo e
 *    vira entidade. O atraso de um tick é o que faz uma torre desabar em
 *    cascata, de baixo para cima, em vez de sumir inteira no mesmo instante.
 * 2. **Como cai.** A entidade vive em arrays paralelos com um pool, como os
 *    itens do chão: um desabamento de 60 blocos não pode gerar 60 objetos.
 *    Ela desce com a gravidade e o arrasto dos itens e **para no primeiro bloco
 *    sólido**. Pousa na célula em que está se ela estiver livre; senão vira
 *    item — é assim que uma tocha no caminho "quebra" a areia.
 *
 * "Livre" e "sólido" são perguntas diferentes de propósito. Para **começar** a
 * cair, a célula de baixo precisa ser livre (ar, fluido, fogo, planta
 * substituível): areia apoiada numa tocha fica parada. Para **parar** de cair,
 * basta a célula de baixo ter colisão: uma tocha no caminho não segura nada, e
 * a areia chega à célula dela, não consegue substituí-la e cai como item.
 *
 * Geração não dispara queda (`source === 'gen'`): o teto de areia sobre uma
 * caverna fica onde nasceu até alguém mexer do lado, como no gênero.
 */

import { AIR, blockIdOf, defOf, makeState } from '../data/blocks';
import type { World } from './world';

/** Mesmos números dos itens do chão: é o que faz a queda "pesar" igual. */
const GRAVITY = -0.04;
const DRAG = 0.98;
/** Uma queda que não pousa em 30 s (buraco sem fundo, chunk sumindo) desiste. */
const MAX_AGE = 600;
/** Teto de posições conferidas por tick: a cascata respeita orçamento. */
export const MAX_CHECKS_PER_TICK = 64;
/** Teto de entidades vivas. Um desabamento maior espera na fila. */
export const MAX_FALLING = 128;

/** Seis vizinhos mais a própria posição. */
const NEIGHBORS = new Int8Array([
  0, 0, 0,
  0, 1, 0, 0, -1, 0,
  1, 0, 0, -1, 0, 0,
  0, 0, 1, 0, 0, -1,
]);

export interface FallingEvents {
  /** O bloco saiu ou entrou no mundo — a luz precisa saber. */
  onChanged?(x: number, y: number, z: number, previous: number, state: number): void;
  /** Pousou numa célula ocupada: vira o item do bloco, como se quebrado. */
  onBroken?(x: number, y: number, z: number, state: number): void;
  /** Pousou — o som é o do bloco colocado. */
  onLanded?(x: number, y: number, z: number, state: number): void;
}

/** A célula aceita receber um bloco que cai (e deixa um bloco começar a cair). */
export function isFreeForFalling(state: number): boolean {
  if (blockIdOf(state) === AIR) return true;
  const def = defOf(state);
  return def.replaceable;
}

export class FallingBlocks {
  private readonly world: World;
  private readonly events: FallingEvents;

  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly prevY: Float64Array;
  private readonly vy: Float32Array;
  private readonly state: Uint16Array;
  private readonly age: Int32Array;
  private activeCount = 0;

  /** Posições a conferir no próximo tick, como triplas. */
  private pending: number[] = [];
  /** Buffer da troca: o tick lê um e o evento escreve no outro. */
  private next: number[] = [];
  /** Chaves já na fila, para não conferir a mesma posição sete vezes. */
  private readonly queued = new Set<number>();

  constructor(world: World, events: FallingEvents = {}, capacity = MAX_FALLING) {
    this.world = world;
    this.events = events;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.prevY = new Float64Array(capacity);
    this.vy = new Float32Array(capacity);
    this.state = new Uint16Array(capacity);
    this.age = new Int32Array(capacity);
  }

  get active(): number {
    return this.activeCount;
  }

  /** Posições esperando conferência (testes e debug). */
  get queuedChecks(): number {
    return this.next.length / 3;
  }

  /** Liga ao mundo: toda mudança que não é geração olha em volta. */
  attach(): () => void {
    return this.world.onBlockChange((change) => {
      if (change.source === 'gen') return;
      this.checkAround(change.x, change.y, change.z);
    });
  }

  /** Enfileira a posição e os seis vizinhos. */
  checkAround(x: number, y: number, z: number): void {
    for (let i = 0; i < NEIGHBORS.length; i += 3) {
      this.schedule(x + NEIGHBORS[i], y + NEIGHBORS[i + 1], z + NEIGHBORS[i + 2]);
    }
  }

  private schedule(x: number, y: number, z: number): void {
    // Filtro barato antes da fila: só interessa bloco que cai.
    if (!defOf(this.world.getBlock(x, y, z)).gravity) return;
    const k = key(x, y, z);
    if (this.queued.has(k)) return;
    this.queued.add(k);
    this.next.push(x, y, z);
  }

  tick(): void {
    this.startFalls();
    this.moveEntities();
  }

  /** Confere a fila do tick anterior; quem tem espaço embaixo vira entidade. */
  private startFalls(): void {
    const list = this.next;
    this.next = this.pending;
    this.pending = list;
    this.next.length = 0;

    let checked = 0;
    let i = 0;
    for (; i < list.length; i += 3) {
      if (checked >= MAX_CHECKS_PER_TICK || this.activeCount >= this.x.length) break;
      checked++;
      const x = list[i];
      const y = list[i + 1];
      const z = list[i + 2];
      this.queued.delete(key(x, y, z));
      const state = this.world.getBlock(x, y, z);
      if (!defOf(state).gravity) continue;
      if (y <= 0 || !this.world.isLoaded(x, z)) continue;
      if (!isFreeForFalling(this.world.getBlock(x, y - 1, z))) continue;
      if (!this.world.setBlock(x, y, z, makeState(AIR), 'physics')) continue;
      this.events.onChanged?.(x, y, z, state, makeState(AIR));
      this.spawn(x + 0.5, y, z + 0.5, state);
    }
    // Sobrou orçamento? Não: sobrou fila. Ela volta para o próximo tick.
    for (; i < list.length; i += 3) this.next.push(list[i], list[i + 1], list[i + 2]);
    list.length = 0;
  }

  /** Cria a entidade. `y` é a base do bloco. Devolve o índice, ou −1 se lotado. */
  spawn(x: number, y: number, z: number, state: number): number {
    if (this.activeCount >= this.x.length) return -1;
    const i = this.activeCount++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.prevY[i] = y;
    this.vy[i] = 0;
    this.state[i] = state;
    this.age[i] = 0;
    return i;
  }

  private moveEntities(): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.prevY[i] = this.y[i];
      this.age[i]++;
      const bx = Math.floor(this.x[i]);
      const bz = Math.floor(this.z[i]);
      if (this.age[i] > MAX_AGE || !this.world.isLoaded(bx, bz)) {
        this.remove(i--);
        continue;
      }

      const vy = (this.vy[i] + GRAVITY) * DRAG;
      const cell = Math.floor(this.y[i]);
      const target = this.y[i] + vy;
      // Desce célula por célula até o alvo: uma queda rápida atravessaria uma
      // laje fina se só olhasse o destino.
      let landed = false;
      let landY = cell;
      for (let cy = cell - 1; cy >= Math.floor(target); cy--) {
        if (cy < 0) break;
        if (defOf(this.world.getBlock(bx, cy, bz)).solid) {
          landed = true;
          landY = cy + 1;
          break;
        }
      }
      if (target < 0 && !landed) {
        // Caiu do mundo: some, como o jogador no vazio.
        this.remove(i--);
        continue;
      }
      if (landed) {
        this.land(bx, landY, bz, this.state[i]);
        this.remove(i--);
        continue;
      }
      this.vy[i] = vy;
      this.y[i] = target;
    }
  }

  private land(x: number, y: number, z: number, state: number): void {
    const here = this.world.getBlock(x, y, z);
    if (!isFreeForFalling(here) || !this.world.setBlock(x, y, z, state, 'physics')) {
      this.events.onBroken?.(x, y, z, state);
      return;
    }
    this.events.onChanged?.(x, y, z, here, state);
    this.events.onLanded?.(x, y, z, state);
  }

  /** Troca com o último: remoção O(1) sem buraco no pool. */
  private remove(i: number): void {
    const last = --this.activeCount;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.z[i] = this.z[last];
    this.prevY[i] = this.prevY[last];
    this.vy[i] = this.vy[last];
    this.state[i] = this.state[last];
    this.age[i] = this.age[last];
  }

  /** Esquece tudo (troca de dimensão). O que estava no ar se perde. */
  clear(): void {
    this.activeCount = 0;
    this.pending.length = 0;
    this.next.length = 0;
    this.queued.clear();
  }

  /**
   * Visita cada entidade com a posição interpolada da base do bloco.
   * `x`/`z` são o centro; o render desloca meio bloco.
   */
  forEach(
    fn: (x: number, y: number, z: number, state: number) => void, alpha = 1,
  ): void {
    for (let i = 0; i < this.activeCount; i++) {
      const y = this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha;
      fn(this.x[i], y, this.z[i], this.state[i]);
    }
  }
}

/** Chave de posição para o conjunto da fila. Colisão só afeta deduplicação. */
function key(x: number, y: number, z: number): number {
  return ((x & 0xfffff) * 128 + (y & 127)) * 1048576 + (z & 0xfffff);
}
