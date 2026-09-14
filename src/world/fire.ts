/**
 * Fogo que se espalha (doc 04: `flammable`; doc 03 §8: a chuva apaga).
 *
 * `flammable` está na tabela de blocos desde o M1 — madeira 5, folha e lã 30 —
 * e **nada no código a lia**. O isqueiro do M7 só acendia portal. O resultado
 * era um jogo em que a floresta não pega fogo e o número na tabela era enfeite.
 *
 * A disciplina é a mesma do crescimento (`world/growth.ts`) e pelo mesmo
 * motivo: **nada de random tick**. O mundo mantém um registro das posições que
 * estão queimando, alimentado pelo evento de mudança de bloco, e o tick
 * percorre esse registro em rodízio com teto duro. Um incêndio grande queima
 * mais devagar por chama e **nunca** derruba o frame — que é o trade-off certo
 * para o aparelho-alvo.
 *
 * Regras, todas derivadas da tabela e não de `case`:
 *
 * - a chama envelhece; sem nada inflamável por perto ela se apaga cedo;
 * - ela tenta pegar num vizinho inflamável, com chance proporcional ao
 *   `flammable` do bloco — lã pega muito mais rápido que tronco;
 * - o que queima vira fogo (e depois ar), então o incêndio anda;
 * - **a chuva apaga**, e a dimensão sem céu não tem chuva, então o Nether
 *   queima em paz;
 * - fogo sem apoio embaixo e sem vizinho inflamável não existe: ele some.
 */

import { AIR, BLOCK_BY_NAME, blockIdOf, defOf, makeState, stateBitsOf } from '../data/blocks';
import type { World } from './world';

/** Ticks de uma varredura completa do registro (1 s). */
export const SWEEP_TICKS = 20;
/** Teto de chamas visitadas por tick — o orçamento duro. */
export const MAX_PER_TICK = 12;
/** Idade máxima; ao passar dela a chama se apaga. */
export const MAX_AGE = 15;
/** Teto de chamas vivas ao mesmo tempo. */
export const MAX_FIRES = 256;

/** Limite de coordenada horizontal que a chave de posição comporta. */
const XZ_MASK = 0xfffff;
const XZ_SIGN = 0x80000;

/** Os seis vizinhos, na ordem em que a propagação os tenta. */
const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0],
];

export interface FireEvents {
  /** Um bloco foi consumido pelo fogo — quem ouve toca o som e avisa a luz. */
  onBurned?(x: number, y: number, z: number, state: number): void;
  /** Uma chama nova nasceu, por propagação ou pelo isqueiro. */
  onIgnited?(x: number, y: number, z: number): void;
}

export class Fire {
  private readonly world: World;
  private readonly events: FireEvents;
  private readonly fireId: number;
  /** Posições em chamas, em rodízio. */
  private readonly keys: number[] = [];
  /** Chave → índice em `keys`, para remover em O(1) trocando com o último. */
  private readonly index = new Map<number, number>();
  private cursor = 0;

  /**
   * Está chovendo **nesta dimensão**. Quem escreve é a sessão, uma vez por
   * tick: consultar o clima aqui obrigaria o fogo a conhecer o calendário.
   */
  raining = false;

  /** Aleatório do jogo; os testes injetam um determinístico. */
  random: () => number = Math.random;

  /** Quantas chamas foram visitadas no último tick (overlay de debug). */
  lastVisited = 0;

  constructor(world: World, events: FireEvents = {}) {
    this.world = world;
    this.events = events;
    this.fireId = fireBlockId();
  }

  get burning(): number {
    return this.keys.length;
  }

  /** Liga o registro ao mundo: toda mudança de bloco entra ou sai daqui. */
  attach(): () => void {
    return this.world.onBlockChange((change) => {
      this.onBlockChanged(change.x, change.y, change.z, change.previous, change.state);
    });
  }

  /**
   * Acende fogo na posição, se couber ali. Devolve false quando não coube —
   * é o que o isqueiro usa para decidir se gastou durabilidade.
   */
  ignite(x: number, y: number, z: number): boolean {
    if (this.keys.length >= MAX_FIRES) return false;
    if (this.raining) return false;
    const target = this.world.getBlock(x, y, z);
    if (!defOf(target).replaceable || blockIdOf(target) === this.fireId) return false;
    if (!this.canBurnAt(x, y, z)) return false;
    this.world.setBlock(x, y, z, makeState(this.fireId, 0), 'physics');
    this.events.onIgnited?.(x, y, z);
    return true;
  }

  /**
   * Um tick: visita uma fatia do registro. A fatia fecha uma volta a cada
   * `SWEEP_TICKS`, respeitando o teto por tick.
   */
  tick(): void {
    const total = this.keys.length;
    if (total === 0) {
      this.lastVisited = 0;
      return;
    }
    const slice = Math.min(MAX_PER_TICK, Math.max(1, Math.ceil(total / SWEEP_TICKS)));
    let visited = 0;
    for (let n = 0; n < slice && this.keys.length > 0; n++) {
      if (this.cursor >= this.keys.length) this.cursor = 0;
      const k = this.keys[this.cursor];
      const kept = this.visit(unpackX(k), unpackY(k), unpackZ(k));
      // `visit` que remove já trouxe outra chave para este índice.
      if (kept) this.cursor++;
      visited++;
    }
    this.lastVisited = visited;
  }

  /** true se a posição ainda está no registro depois da visita. */
  private visit(x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(x, y, z);
    if (blockIdOf(state) !== this.fireId) {
      this.remove(key(x, y, z));
      return false;
    }

    // Chuva apaga (doc 03 §8). Sem céu não chove, e o corte já vem pronto.
    if (this.raining) {
      this.extinguish(x, y, z);
      return false;
    }

    const fuel = this.fuelAround(x, y, z);
    const supported = this.canBurnAt(x, y, z);
    if (!supported) {
      this.extinguish(x, y, z);
      return false;
    }

    const age = stateBitsOf(state);
    /*
     * Envelhecer: sem combustível a chama vive pouco, com combustível ela se
     * arrasta. É o que faz o fogo do isqueiro sobre a pedra apagar sozinho e o
     * da floresta durar até acabar a floresta.
     */
    if (age >= MAX_AGE || (fuel === 0 && age >= 4)) {
      this.burnOut(x, y, z);
      return false;
    }
    this.world.setBlock(x, y, z, makeState(this.fireId, age + 1), 'physics');

    if (fuel > 0) this.trySpread(x, y, z, age);
    return true;
  }

  /**
   * Tenta pegar num vizinho. A chance sai do `flammable` do bloco vizinho, e a
   * idade da chama a reduz — fogo velho espalha menos que fogo novo.
   */
  private trySpread(x: number, y: number, z: number, age: number): void {
    if (this.keys.length >= MAX_FIRES) return;
    const start = (this.random() * NEIGHBORS.length) | 0;
    for (let n = 0; n < NEIGHBORS.length; n++) {
      const step = NEIGHBORS[(start + n) % NEIGHBORS.length];
      const nx = x + step[0];
      const ny = y + step[1];
      const nz = z + step[2];
      const neighbor = this.world.getBlock(nx, ny, nz);
      const flammable = defOf(neighbor).flammable;
      if (flammable <= 0) continue;
      // `flammable` vai de 5 (tronco) a 30 (lã): a chance segue a escala dele.
      const chance = (flammable / 300) * (1 - age / (MAX_AGE * 2));
      if (this.random() >= chance) continue;
      this.consume(nx, ny, nz, neighbor);
      return;
    }
  }

  /** O bloco vira fogo: o incêndio anda para dentro dele. */
  private consume(x: number, y: number, z: number, state: number): void {
    this.world.setBlock(x, y, z, makeState(this.fireId, 0), 'physics');
    this.events.onBurned?.(x, y, z, state);
    this.events.onIgnited?.(x, y, z);
  }

  /** Apaga sem consumir nada: sobra ar. */
  private extinguish(x: number, y: number, z: number): void {
    this.world.setBlock(x, y, z, AIR, 'physics');
  }

  private burnOut(x: number, y: number, z: number): void {
    this.extinguish(x, y, z);
  }

  /** Soma do `flammable` dos seis vizinhos. Zero = a chama não tem o que comer. */
  private fuelAround(x: number, y: number, z: number): number {
    let total = 0;
    for (const step of NEIGHBORS) {
      total += defOf(this.world.getBlock(x + step[0], y + step[1], z + step[2])).flammable;
    }
    return total;
  }

  /**
   * Fogo precisa de chão sólido embaixo **ou** de algo inflamável ao lado.
   * Sem os dois ele fica boiando no ar, que é o defeito clássico.
   */
  private canBurnAt(x: number, y: number, z: number): boolean {
    const below = defOf(this.world.getBlock(x, y - 1, z));
    if (below.solid && below.opaque) return true;
    return this.fuelAround(x, y, z) > 0;
  }

  private onBlockChanged(
    x: number, y: number, z: number, previous: number, state: number,
  ): void {
    if (blockIdOf(state) === this.fireId) this.add(key(x, y, z));
    else if (blockIdOf(previous) === this.fireId) this.remove(key(x, y, z));
  }

  /**
   * Varre uma coluna recém-carregada atrás de fogo já gravado.
   *
   * Fogo é bloco, então ele **vai para o save**: um mundo salvo com a floresta
   * queimando volta com ela queimando. Sem esta varredura as chamas antigas
   * ficariam paradas para sempre, acesas e sem consumir nada — luz eterna de
   * graça, que é pior que o incêndio.
   *
   * Só olha sections cuja **paleta** contém fogo, pelo mesmo motivo do
   * crescimento: sem o filtro seriam 32 mil consultas por coluna, quase todas
   * em pedra.
   */
  scanChunk(chunk: {
    cx: number; cz: number;
    sections: { paletteLen: number; palette: Uint16Array; getByIndex(i: number): number }[];
  }): void {
    for (let sy = 0; sy < chunk.sections.length; sy++) {
      const section = chunk.sections[sy];
      let interesting = false;
      for (let p = 0; p < section.paletteLen; p++) {
        if (blockIdOf(section.palette[p]) === this.fireId) { interesting = true; break; }
      }
      if (!interesting) continue;

      for (let i = 0; i < 4096; i++) {
        if (blockIdOf(section.getByIndex(i)) !== this.fireId) continue;
        const x = chunk.cx * 16 + (i & 15);
        const z = chunk.cz * 16 + ((i >> 4) & 15);
        const y = sy * 16 + (i >> 8);
        this.add(key(x, y, z));
      }
    }
  }

  /** Esquece tudo que estava registrado nesta coluna (chunk descarregado). */
  forgetChunk(cx: number, cz: number): void {
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const k = this.keys[i];
      if ((unpackX(k) >> 4) === cx && (unpackZ(k) >> 4) === cz) this.remove(k);
    }
  }

  private add(k: number): void {
    if (this.index.has(k)) return;
    if (this.keys.length >= MAX_FIRES) return;
    this.index.set(k, this.keys.length);
    this.keys.push(k);
  }

  private remove(k: number): void {
    const at = this.index.get(k);
    if (at === undefined) return;
    const last = this.keys.length - 1;
    if (at !== last) {
      this.keys[at] = this.keys[last];
      this.index.set(this.keys[at], at);
    }
    this.keys.pop();
    this.index.delete(k);
  }
}

/** Id do bloco de fogo, resolvido uma vez a partir da tabela. */
let cachedFireId = -1;
export function fireBlockId(): number {
  if (cachedFireId < 0) cachedFireId = BLOCK_BY_NAME.get('fire')?.id ?? 0;
  return cachedFireId;
}

export function key(x: number, y: number, z: number): number {
  return ((x & XZ_MASK) * (XZ_MASK + 1) + (z & XZ_MASK)) * 128 + (y & 127);
}

function unpackY(k: number): number {
  return k % 128;
}

function unpackZ(k: number): number {
  return signed(Math.floor(k / 128) % (XZ_MASK + 1));
}

function unpackX(k: number): number {
  return signed(Math.floor(k / (128 * (XZ_MASK + 1))));
}

function signed(v: number): number {
  return v >= XZ_SIGN ? v - (XZ_MASK + 1) : v;
}
