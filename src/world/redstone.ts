/**
 * Circuito de redstone (doc 14 — M7).
 *
 * O modelo é **declaradamente mais simples que o do gênero**, e isso é uma
 * decisão de orçamento, não um esquecimento. O original distingue energia forte
 * de fraca com regras que dependem de cada componente; aqui a distinção existe,
 * mas em uma frase só:
 *
 * - **forte** é o que um emissor dedicado (alavanca, botão, placa, tocha,
 *   repetidor) entrega ao bloco em que está encostado. Bloco sólido com energia
 *   forte alimenta pó vizinho com 15, sem perda.
 * - **fraca** é o que o pó entrega aos seis vizinhos. Bloco sólido com energia
 *   fraca **liga mecanismo** (porta, lâmpada, pistão) mas **não** realimenta pó
 *   — é o que impede o fio de atravessar parede e voltar a 15 do outro lado.
 *
 * O que ficou de fora, e por quê: não há comparador, observador, tremonha nem
 * queima de tocha por excesso de pulsos. Não há energia quasi-conectada. O pó
 * não muda de desenho com a conexão (ver `data/textures.ts`). Tudo isso é
 * complexidade que o alvo do projeto — um Android de 2016 — não paga.
 *
 * **Propagação.** Não há varredura do mundo: toda mudança de bloco entra numa
 * fila de posições a reavaliar, como em `fluids.ts` e `growth.ts`. A fila é
 * drenada **dentro do mesmo tick**, em laço, até esvaziar ou bater o teto de
 * `MAX_UPDATES_PER_TICK` — um fio de 60 blocos acende no tick em que a alavanca
 * é puxada, que é o que o jogador espera. O teto é o que garante que um
 * circuito patológico custe um frame ruim e não um travamento.
 */

import {
  AIR, BLOCKS, blockIdOf, defOf, makeState, stateBitsOf, type BlockDef,
} from '../data/blocks';
import { redstoneDefOf, type RedstoneDef, type RedstoneKind } from '../data/redstone';
import { MOUNT_CEILING, MOUNT_FLOOR, PISTON_STEP } from './mesh/shapes';
import { WORLD_HEIGHT } from './chunk';
import type { World } from './world';
import { partnerIdOf, partnerOffset } from './multiblock';

/** Teto de posições reavaliadas por tick. Mesma disciplina do doc 03 §9. */
export const MAX_UPDATES_PER_TICK = 1024;
/** Energia máxima que um emissor entrega. */
export const MAX_POWER = 15;
/** Atraso, em ticks, de tocha e repetidor. */
const TORCH_DELAY = 2;
/** Quantos blocos um pistão empurra de uma vez. */
export const PISTON_LIMIT = 12;

/**
 * Bit que marca "esta porta está aberta **por energia**" (M7).
 *
 * Sem ele o circuito e a mão brigam: abrir uma porta no clique dispara uma
 * reavaliação da posição, o circuito vê energia zero e fecha a porta no mesmo
 * tick — a porta nunca abriria na mão. Com ele, a porta só se mexe quando a
 * energia **muda**, e o clique manual é respeitado até a próxima mudança.
 *
 * É o bit 4 do estado porque 0..2 são de porta e portão e 0..3 de alçapão;
 * nenhum dos três usa o 4 (`world/mesh/shapes.ts`).
 */
const DOOR_POWERED_BIT = 16;
/** Deslocamento até a outra folha da porta. Reusado — o tick não aloca. */
const DOOR_PARTNER = new Int8Array(3);

/** Folga em Y ao procurar a placa sob os pés de uma entidade. */
const FOOT_EPSILON = 0.05;

/**
 * Vizinhos, na ordem de `PISTON_STEP`: +X, −X, +Z, −Z, +Y, −Y.
 * Os quatro primeiros coincidem com `FACING_STEP` de propósito.
 */
const DIRS = PISTON_STEP;

/** Direção oposta — o par (+X,−X) e afins fica a um XOR de distância. */
function opposite(dir: number): number {
  return dir ^ 1;
}

export interface RedstoneEvents {
  /** O bloco mudou de estado — quem ouve atualiza a luz. */
  onChanged?(x: number, y: number, z: number, previous: number, state: number): void;
  /** Perdeu o apoio e caiu: quem ouve dropa o item. */
  onBroken?(x: number, y: number, z: number, state: number): void;
  /** Som posicional de clique, de porta e de pistão. */
  onSound?(name: string, x: number, y: number, z: number): void;
}

/** Tarefa adiada: tocha que inverte, repetidor que dispara, botão que solta. */
interface Delayed {
  x: number;
  y: number;
  z: number;
  at: number;
}

/** Tabelas planas por id — o caminho quente não olha objeto. */
interface Roles {
  /** `KIND_*`; 0 = não participa do circuito. */
  kind: Uint8Array;
  /** Id do par ligado/desligado, ou 0. */
  pair: Uint16Array;
  /** 1 quando este id é o lado aceso do par. */
  lit: Uint8Array;
  /** Ticks que o botão fica apertado. */
  pressTicks: Uint16Array;
  sticky: Uint8Array;
  /** Bit de "aberto" de porta, portão e alçapão. 0 = não abre. */
  openBit: Uint8Array;
  /** 1 = bloco sólido e opaco, que transmite energia de bloco. */
  conductive: Uint8Array;
  /** 1 = pistão não move este bloco (ver `isImmovable`). */
  immovable: Uint8Array;
  /** 1 quando o bloco cai se perder o apoio (`support` da tabela de blocos). */
  needsSupport: Uint8Array;
}

export const KIND_NONE = 0;
const KIND_ORDER: readonly RedstoneKind[] = [
  'wire', 'source', 'lever', 'button', 'plate', 'torch', 'repeater', 'piston', 'lamp', 'door',
  'rail', 'detector',
];
const KIND_ID: Readonly<Record<RedstoneKind, number>> = Object.fromEntries(
  KIND_ORDER.map((name, i) => [name, i + 1]),
) as Record<RedstoneKind, number>;

export const KIND_WIRE = KIND_ID.wire;
export const KIND_SOURCE = KIND_ID.source;
export const KIND_LEVER = KIND_ID.lever;
export const KIND_BUTTON = KIND_ID.button;
export const KIND_PLATE = KIND_ID.plate;
export const KIND_TORCH = KIND_ID.torch;
export const KIND_REPEATER = KIND_ID.repeater;
export const KIND_PISTON = KIND_ID.piston;
export const KIND_LAMP = KIND_ID.lamp;
export const KIND_DOOR = KIND_ID.door;
export const KIND_RAIL = KIND_ID.rail;
export const KIND_DETECTOR = KIND_ID.detector;

/**
 * Bit de energizado do trilho (`RAIL_POWERED` de `world/mesh/shapes.ts`).
 *
 * Os bits 0..3 do trilho são a forma, que `world/rails.ts` escreve; o circuito
 * só toca no 4. Os dois sistemas escrevem no mesmo voxel sem se atropelar
 * porque cada um preserva os bits do outro.
 */
const RAIL_POWERED_BIT = 16;

/**
 * Blocos que o pistão não move: os que guardam conteúdo (o baú tem inventário
 * amarrado à posição), os que não deviam sair do lugar nunca (rocha-mãe) e os
 * caros demais para o gênero mover (obsidiana).
 */
const IMMOVABLE: ReadonlySet<string> = new Set([
  'bedrock', 'obsidian', 'chest', 'furnace', 'furnace_lit', 'enchanting_table', 'mob_spawner',
  'piston_head',
]);

function buildRoles(): Roles {
  const n = BLOCKS.length;
  const roles: Roles = {
    kind: new Uint8Array(n),
    pair: new Uint16Array(n),
    lit: new Uint8Array(n),
    pressTicks: new Uint16Array(n),
    sticky: new Uint8Array(n),
    openBit: new Uint8Array(n),
    conductive: new Uint8Array(n),
    immovable: new Uint8Array(n),
    needsSupport: new Uint8Array(n),
  };
  for (let id = 0; id < n; id++) {
    const def = BLOCKS[id];
    if (def === undefined) continue;
    roles.conductive[id] = def.opaque && def.solid ? 1 : 0;
    roles.needsSupport[id] = def.support === 'none' ? 0 : 1;
    roles.immovable[id] = IMMOVABLE.has(def.name) || def.hardness < 0 ? 1 : 0;
    roles.openBit[id] = openBitOf(def);

    const entry: RedstoneDef | undefined = redstoneDefOf(def);
    if (entry === undefined) continue;
    roles.kind[id] = KIND_ID[entry.kind];
    roles.lit[id] = entry.lit === true ? 1 : 0;
    roles.pressTicks[id] = entry.pressTicks ?? 0;
    roles.sticky[id] = entry.sticky === true ? 1 : 0;
    if (entry.pair !== undefined) {
      const other = BLOCKS.find((b) => b !== undefined && b.name === entry.pair);
      roles.pair[id] = other === undefined ? 0 : other.id;
    }
  }
  return roles;
}

/** Bit de "aberto" de cada forma que abre — o mesmo de `game/interaction.ts`. */
function openBitOf(def: BlockDef): number {
  if (def.shape === 'door' || def.shape === 'fence_gate') return 4;
  if (def.shape === 'trapdoor') return 8;
  return 0;
}

const ROLES = buildRoles();

/**
 * true se uma mudança neste bloco pode ser sentida a dois blocos de distância:
 * componente de circuito ou bloco que conduz energia de bloco.
 */
function reachesFar(state: number): boolean {
  const id = blockIdOf(state);
  return ROLES.kind[id] !== KIND_NONE || ROLES.conductive[id] === 1;
}

export class Redstone {
  private readonly world: World;
  private readonly events: RedstoneEvents;

  /** Fila de posições a reavaliar neste tick. */
  private queue: number[] = [];
  private readonly queued = new Set<number>();
  /** Tarefas com atraso, ordenadas por inserção (poucas dezenas no pior caso). */
  private delayed: Delayed[] = [];
  private tickCounter = 0;
  /** Posições de placa com alguém em cima, e o conjunto do tick anterior. */
  private pressed = new Set<number>();
  private scanning = new Set<number>();

  /** Quantas posições foram reavaliadas no último tick (overlay de debug). */
  lastUpdates = 0;

  constructor(world: World, events: RedstoneEvents = {}) {
    this.world = world;
    this.events = events;
  }

  get pending(): number {
    return this.queue.length + this.delayed.length;
  }

  /**
   * Liga o circuito ao mundo: toda mudança de bloco agenda a vizinhança.
   *
   * Inclui as mudanças que o próprio circuito faz — é assim que um pulso anda
   * pelo fio sem ninguém percorrer o fio.
   */
  attach(): () => void {
    return this.world.onBlockChange((change) => {
      // A geração escreve milhões de voxels e nenhum deles é circuito.
      if (change.source === 'gen') return;
      this.scheduleNeighborhood(
        change.x, change.y, change.z,
        reachesFar(change.state) || reachesFar(change.previous),
      );
    });
  }

  /**
   * Agenda a posição e tudo que pode depender dela.
   *
   * O primeiro anel é sempre visitado. O **segundo** só quando o bloco que
   * mudou é parte de circuito ou conduz — são os dois casos em que alguém a
   * dois blocos de distância depende dele, seja porque o pó alimenta a parede
   * que liga o mecanismo do outro lado, seja porque a parede é o caminho. Sem
   * essa condição cada célula de água em movimento custaria 43 consultas ao
   * mundo em vez de 7.
   */
  scheduleNeighborhood(x: number, y: number, z: number, deep = true): void {
    this.schedule(x, y, z);
    for (let d = 0; d < 6; d++) {
      const step = DIRS[d];
      const nx = x + step[0];
      const ny = y + step[1];
      const nz = z + step[2];
      this.schedule(nx, ny, nz);
      if (!deep) continue;
      for (let e = 0; e < 6; e++) {
        const inner = DIRS[e];
        this.schedule(nx + inner[0], ny + inner[1], nz + inner[2]);
      }
    }
  }

  schedule(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const id = blockIdOf(this.world.getBlock(x, y, z));
    /*
     * Componente de circuito **ou** bloco que depende de apoio.
     *
     * A segunda metade da condição é uma correção de 2026-09-16: até aqui só
     * quem tinha papel de redstone entrava na fila, então trilho comum e tocha
     * — que declaram `support` na tabela de blocos e não são circuito — ficavam
     * flutuando quando o bloco de baixo era minerado. A checagem em si já
     * existia em `dropUnsupported`; o que faltava era alguém chamá-la.
     */
    if (ROLES.kind[id] === KIND_NONE && ROLES.needsSupport[id] === 0) return;
    const key = positionKey(x, y, z);
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
  }

  /** Adia uma reavaliação — tocha, repetidor e botão precisam disso. */
  private scheduleAt(x: number, y: number, z: number, ticks: number): void {
    for (let i = 0; i < this.delayed.length; i++) {
      const d = this.delayed[i];
      if (d.x === x && d.y === y && d.z === z) return;
    }
    this.delayed.push({ x, y, z, at: this.tickCounter + ticks });
  }

  // --- tick ----------------------------------------------------------------

  /**
   * Um tick: primeiro as tarefas vencidas, depois a fila, até esvaziar.
   *
   * Drenar em laço — e não uma posição por tick — é o que faz o fio inteiro
   * acender junto. O teto transforma um circuito em looping num frame ruim,
   * nunca numa aba travada.
   */
  tick(): void {
    this.tickCounter++;
    this.lastUpdates = 0;
    this.firePending();

    while (this.queue.length > 0 && this.lastUpdates < MAX_UPDATES_PER_TICK) {
      const key = this.queue.pop() as number;
      this.queued.delete(key);
      this.update(xOfKey(key), yOfKey(key), zOfKey(key));
      this.lastUpdates++;
    }
    // Se o teto estourou, o que sobrou continua na fila e em `queued`: entra no
    // tick seguinte sem ser reagendado nem duplicado.
  }

  /** Tarefas adiadas cujo prazo venceu. */
  private firePending(): void {
    if (this.delayed.length === 0) return;
    const remaining: Delayed[] = [];
    for (let i = 0; i < this.delayed.length; i++) {
      const task = this.delayed[i];
      if (task.at > this.tickCounter) {
        remaining.push(task);
        continue;
      }
      this.fire(task.x, task.y, task.z);
    }
    this.delayed = remaining;
  }

  /** Executa a tarefa adiada de acordo com o que estiver na posição. */
  private fire(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    const kind = ROLES.kind[id];
    if (kind === KIND_TORCH) this.applyTorch(x, y, z, id);
    else if (kind === KIND_REPEATER) this.applyRepeater(x, y, z, state, true);
    else if (kind === KIND_BUTTON) this.release(x, y, z, state);
  }

  // --- avaliação de uma posição -------------------------------------------

  private update(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    const kind = ROLES.kind[id];
    // O apoio vem antes do papel: quem cai não precisa ser circuito.
    if (this.dropUnsupported(x, y, z, state, id)) return;
    if (kind === KIND_NONE) return;

    switch (kind) {
      case KIND_WIRE: this.applyWire(x, y, z, state); break;
      case KIND_TORCH: this.scheduleTorch(x, y, z, id); break;
      case KIND_REPEATER: this.applyRepeater(x, y, z, state, false); break;
      case KIND_LAMP: this.applyLamp(x, y, z, id); break;
      case KIND_DOOR: this.applyDoor(x, y, z, state, id); break;
      case KIND_PISTON: this.applyPiston(x, y, z, state); break;
      case KIND_RAIL: this.applyRail(x, y, z, state, id); break;
      case KIND_BUTTON: this.rearm(x, y, z, state, id); break;
      default: break; // alavanca, placa e bloco de redstone só emitem
    }
  }

  /**
   * Botão apertado que ficou sem tarefa de soltura volta a ter uma.
   *
   * A fila de tarefas adiadas **não vai para o save** (doc 11 §2: o save guarda
   * voxel, não agenda). Sem isto, sair do mundo com o botão apertado o deixaria
   * apertado para sempre.
   */
  private rearm(x: number, y: number, z: number, state: number, id: number): void {
    if ((stateBitsOf(state) & 8) === 0) return;
    this.scheduleAt(x, y, z, ROLES.pressTicks[id]);
  }

  /**
   * Cataloga os componentes de um chunk que acabou de entrar no mundo.
   *
   * Mesma técnica de `growth.ts`: a paleta da section é filtrada antes dos 4096
   * voxels, então um chunk sem circuito nenhum — o caso comum — custa uma volta
   * curta por section e nada mais.
   */
  scanChunk(chunk: {
    cx: number; cz: number;
    sections: { paletteLen: number; palette: Uint16Array; getByIndex(i: number): number }[];
  }): void {
    for (let sy = 0; sy < chunk.sections.length; sy++) {
      const section = chunk.sections[sy];
      let interesting = false;
      for (let p = 0; p < section.paletteLen; p++) {
        if (ROLES.kind[blockIdOf(section.palette[p])] !== KIND_NONE) { interesting = true; break; }
      }
      if (!interesting) continue;

      for (let i = 0; i < 4096; i++) {
        if (ROLES.kind[blockIdOf(section.getByIndex(i))] === KIND_NONE) continue;
        const x = chunk.cx * 16 + (i & 15);
        const z = chunk.cz * 16 + ((i >> 4) & 15);
        const y = sy * 16 + (i >> 8);
        const key = positionKey(x, y, z);
        if (this.queued.has(key)) continue;
        this.queued.add(key);
        this.queue.push(key);
      }
    }
  }

  /**
   * Quem perde o apoio vira item, como a plantação de `growth.ts`.
   * Devolve true se o bloco saiu do mundo.
   */
  private dropUnsupported(
    x: number, y: number, z: number, state: number, id: number,
  ): boolean {
    const def = BLOCKS[id];
    if (def === undefined || def.support === 'none') return false;

    let sx = x;
    let sy = y - 1;
    let sz = z;
    if (def.support === 'mount') {
      const dir = mountDir(stateBitsOf(state) & 7);
      sx = x + dir[0]; sy = y + dir[1]; sz = z + dir[2];
    }
    const supportId = blockIdOf(this.world.getBlock(sx, sy, sz));
    if (ROLES.conductive[supportId] === 1) return false;
    // Cana e cacto em coluna: o de cima pisa num igual, que não é opaco.
    if (def.stackable && supportId === id) return false;

    if (!this.world.setBlock(x, y, z, AIR, 'physics')) return false;
    this.events.onChanged?.(x, y, z, state, AIR);
    this.events.onBroken?.(x, y, z, state);
    return true;
  }

  // --- pó ------------------------------------------------------------------

  /** Energia que este pó deveria ter, dado o que o cerca. */
  private wirePowerAt(x: number, y: number, z: number): number {
    let best = 0;
    for (let d = 0; d < 6; d++) {
      const step = DIRS[d];
      const nx = x + step[0];
      const ny = y + step[1];
      const nz = z + step[2];
      const nState = this.world.getBlock(nx, ny, nz);
      const nId = blockIdOf(nState);
      const nKind = ROLES.kind[nId];

      if (nKind === KIND_WIRE) {
        best = Math.max(best, (stateBitsOf(nState) & 0xf) - 1);
        continue;
      }
      // Emissor encostado: entrega direto, sem perda.
      best = Math.max(best, this.emitted(nState, nId, opposite(d)));
      // Bloco sólido com energia **forte** realimenta o fio com 15.
      if (ROLES.conductive[nId] === 1 && this.strongInto(nx, ny, nz) > 0) best = MAX_POWER;
      if (best >= MAX_POWER) return MAX_POWER;
    }
    // Pó sobe e desce degrau: o vizinho diagonal conta quando não há bloco
    // opaco cortando o caminho.
    best = Math.max(best, this.stepWire(x, y, z, true));
    best = Math.max(best, this.stepWire(x, y, z, false));
    return Math.min(MAX_POWER, Math.max(0, best));
  }

  /**
   * Melhor vizinho de pó um degrau acima (`up`) ou abaixo.
   *
   * Subir exige que o bloco em cima do pó não seja opaco; descer exige que o
   * bloco sobre o vizinho de baixo também não seja. São as duas regras que
   * fazem um fio acompanhar uma escada sem precisar de bloco de canto.
   */
  private stepWire(x: number, y: number, z: number, up: boolean): number {
    if (up && ROLES.conductive[blockIdOf(this.world.getBlock(x, y + 1, z))] === 1) return 0;
    let best = 0;
    for (let d = 0; d < 4; d++) {
      const step = DIRS[d];
      const nx = x + step[0];
      const nz = z + step[2];
      const ny = up ? y + 1 : y - 1;
      if (!up && ROLES.conductive[blockIdOf(this.world.getBlock(nx, y, nz))] === 1) continue;
      const state = this.world.getBlock(nx, ny, nz);
      if (ROLES.kind[blockIdOf(state)] !== KIND_WIRE) continue;
      best = Math.max(best, (stateBitsOf(state) & 0xf) - 1);
    }
    return best;
  }

  private applyWire(x: number, y: number, z: number, state: number): void {
    const power = this.wirePowerAt(x, y, z);
    if ((stateBitsOf(state) & 0xf) === power) return;
    this.replace(x, y, z, makeState(blockIdOf(state), power));
  }

  // --- energia entregue por um vizinho ------------------------------------

  /**
   * Energia que um bloco entrega ao vizinho na direção `toDir`.
   *
   * É o coração do modelo: cada papel responde uma linha. O pó entrega a energia
   * que tem; alavanca, botão, placa e bloco de redstone entregam 15 para todo
   * lado; a tocha acesa entrega 15 para todo lado **menos** para o próprio
   * apoio; o repetidor só entrega para a frente.
   */
  private emitted(state: number, id: number, toDir: number): number {
    switch (ROLES.kind[id]) {
      case KIND_WIRE:
        return stateBitsOf(state) & 0xf;
      case KIND_SOURCE:
        return MAX_POWER;
      case KIND_LEVER:
      case KIND_BUTTON:
        return (stateBitsOf(state) & 8) !== 0 ? MAX_POWER : 0;
      case KIND_PLATE:
        return (stateBitsOf(state) & 1) !== 0 ? MAX_POWER : 0;
      case KIND_DETECTOR:
        // Quem liga o bit é o carrinho passando por cima (`entity/minecart.ts`).
        return (stateBitsOf(state) & RAIL_POWERED_BIT) !== 0 ? MAX_POWER : 0;
      case KIND_TORCH:
        // O apoio da tocha fica embaixo; ela não energiza o que a segura.
        if (ROLES.lit[id] === 0) return 0;
        return toDir === 5 ? 0 : MAX_POWER;
      case KIND_REPEATER:
        if ((stateBitsOf(state) & 16) === 0) return 0;
        return toDir === (stateBitsOf(state) & 3) ? MAX_POWER : 0;
      default:
        return 0;
    }
  }

  /**
   * Energia **forte** que os emissores injetam no bloco em `(x,y,z)`.
   *
   * Só conta quem está encostado por definição: alavanca, botão e placa no
   * bloco que os segura, tocha no bloco de cima, repetidor no bloco da frente.
   */
  private strongInto(x: number, y: number, z: number): number {
    let best = 0;
    for (let d = 0; d < 6; d++) {
      const step = DIRS[d];
      const nx = x + step[0];
      const ny = y + step[1];
      const nz = z + step[2];
      const state = this.world.getBlock(nx, ny, nz);
      const id = blockIdOf(state);
      const kind = ROLES.kind[id];
      const toDir = opposite(d);

      if (kind === KIND_LEVER || kind === KIND_BUTTON) {
        if ((stateBitsOf(state) & 8) === 0) continue;
        if (mountIndexOf(stateBitsOf(state) & 7) === toDir) best = MAX_POWER;
      } else if (kind === KIND_PLATE) {
        if ((stateBitsOf(state) & 1) !== 0 && toDir === 5) best = MAX_POWER;
      } else if (kind === KIND_DETECTOR) {
        // Como a placa: energiza forte o bloco que o segura, que fica embaixo.
        if ((stateBitsOf(state) & RAIL_POWERED_BIT) !== 0 && toDir === 5) best = MAX_POWER;
      } else if (kind === KIND_TORCH) {
        if (ROLES.lit[id] === 1 && toDir === 4) best = MAX_POWER;
      } else if (kind === KIND_REPEATER) {
        if ((stateBitsOf(state) & 16) !== 0 && toDir === (stateBitsOf(state) & 3)) {
          best = MAX_POWER;
        }
      }
      if (best >= MAX_POWER) return MAX_POWER;
    }
    return best;
  }

  /**
   * true se um mecanismo em `(x,y,z)` está energizado.
   *
   * Duas fontes: alguém encostado entregando energia direto, ou um bloco sólido
   * vizinho que esteja energizado — forte ou fraco. É a energia fraca por bloco
   * que faz o pó correndo por cima da parede abrir a porta do outro lado.
   */
  poweredAt(x: number, y: number, z: number): boolean {
    for (let d = 0; d < 6; d++) {
      const step = DIRS[d];
      const nx = x + step[0];
      const ny = y + step[1];
      const nz = z + step[2];
      const state = this.world.getBlock(nx, ny, nz);
      const id = blockIdOf(state);
      if (this.emitted(state, id, opposite(d)) > 0) return true;
      if (ROLES.conductive[id] !== 1) continue;
      if (this.strongInto(nx, ny, nz) > 0) return true;
      if (this.weakInto(nx, ny, nz) > 0) return true;
    }
    return false;
  }

  /** Energia fraca num bloco sólido: o pó encostado nele. */
  private weakInto(x: number, y: number, z: number): number {
    let best = 0;
    for (let d = 0; d < 6; d++) {
      const step = DIRS[d];
      const state = this.world.getBlock(x + step[0], y + step[1], z + step[2]);
      if (ROLES.kind[blockIdOf(state)] !== KIND_WIRE) continue;
      best = Math.max(best, stateBitsOf(state) & 0xf);
      if (best >= MAX_POWER) return MAX_POWER;
    }
    return best;
  }

  /** Energia do pó numa posição; 0 se não houver pó. Serve a teste e debug. */
  powerAt(x: number, y: number, z: number): number {
    const state = this.world.getBlock(x, y, z);
    if (ROLES.kind[blockIdOf(state)] !== KIND_WIRE) return 0;
    return stateBitsOf(state) & 0xf;
  }

  // --- componentes ---------------------------------------------------------

  /**
   * Tocha: acesa quando o apoio **não** está energizado. Inverte com atraso,
   * que é o que permite montar um oscilador sem travar o tick.
   */
  private scheduleTorch(x: number, y: number, z: number, id: number): void {
    const powered = ROLES.conductive[blockIdOf(this.world.getBlock(x, y - 1, z))] === 1
      && (this.strongInto(x, y - 1, z) > 0 || this.weakInto(x, y - 1, z) > 0);
    const lit = ROLES.lit[id] === 1;
    if (lit !== powered) return; // já está no estado certo
    this.scheduleAt(x, y, z, TORCH_DELAY);
  }

  private applyTorch(x: number, y: number, z: number, id: number): void {
    const powered = ROLES.conductive[blockIdOf(this.world.getBlock(x, y - 1, z))] === 1
      && (this.strongInto(x, y - 1, z) > 0 || this.weakInto(x, y - 1, z) > 0);
    const lit = ROLES.lit[id] === 1;
    if (lit !== powered) return;
    const other = ROLES.pair[id];
    if (other === 0) return;
    this.replace(x, y, z, makeState(other, stateBitsOf(this.world.getBlock(x, y, z))));
  }

  /**
   * Repetidor: lê o bloco de trás e repete 15 para a frente, depois do atraso.
   *
   * `immediate` distingue as duas entradas: a reavaliação normal **agenda**, e
   * a tarefa vencida **aplica**. Sem isso o repetidor responderia no mesmo tick
   * e deixaria de ser um repetidor.
   */
  private applyRepeater(
    x: number, y: number, z: number, state: number, immediate: boolean,
  ): void {
    const bits = stateBitsOf(state);
    const back = DIRS[opposite(bits & 3)];
    const bx = x + back[0];
    const bz = z + back[2];
    const backState = this.world.getBlock(bx, y, bz);
    const backId = blockIdOf(backState);
    const input = this.emitted(backState, backId, bits & 3) > 0
      || (ROLES.conductive[backId] === 1
        && (this.strongInto(bx, y, bz) > 0 || this.weakInto(bx, y, bz) > 0));

    const powered = (bits & 16) !== 0;
    if (input === powered) return;
    if (!immediate) {
      this.scheduleAt(x, y, z, ((bits >> 2) & 3) + 1);
      return;
    }
    this.replace(x, y, z, makeState(blockIdOf(state), input ? bits | 16 : bits & ~16));
  }

  /**
   * Trilho motorizado: o bit 4 segue a energia, e os bits de forma ficam onde
   * `world/rails.ts` os deixou.
   */
  private applyRail(x: number, y: number, z: number, state: number, id: number): void {
    const bits = stateBitsOf(state);
    const powered = this.poweredAt(x, y, z);
    if (powered === ((bits & RAIL_POWERED_BIT) !== 0)) return;
    this.replace(x, y, z, makeState(
      id, powered ? bits | RAIL_POWERED_BIT : bits & ~RAIL_POWERED_BIT,
    ));
  }

  private applyLamp(x: number, y: number, z: number, id: number): void {
    const lit = ROLES.lit[id] === 1;
    const powered = this.poweredAt(x, y, z);
    if (lit === powered) return;
    const other = ROLES.pair[id];
    if (other !== 0) this.replace(x, y, z, makeState(other));
  }

  /**
   * Porta, portão e alçapão seguem a energia — mas só quando ela **muda**.
   *
   * O bit de `DOOR_POWERED_BIT` guarda o que o circuito fez da última vez. Se
   * ele bate com a energia de agora, nada acontece, e a porta que o jogador
   * abriu na mão continua aberta.
   */
  private applyDoor(x: number, y: number, z: number, state: number, id: number): void {
    const bit = ROLES.openBit[id];
    if (bit === 0) return;
    const bits = stateBitsOf(state);
    const powered = this.poweredAt(x, y, z);
    if (powered === ((bits & DOOR_POWERED_BIT) !== 0)) return;

    const next = powered
      ? bits | bit | DOOR_POWERED_BIT
      : (bits & ~bit) & ~DOOR_POWERED_BIT;
    this.replace(x, y, z, makeState(id, next));
    /*
     * A porta tem duas folhas (M8) e uma alavanca costuma alcançar só uma
     * delas. A folha tocada arrasta a outra: sem isso, metade da porta abre e
     * a outra metade continua barrando a passagem.
     */
    if (partnerOffset(state, DOOR_PARTNER)) {
      const px = x + DOOR_PARTNER[0];
      const py = y + DOOR_PARTNER[1];
      const pz = z + DOOR_PARTNER[2];
      const other = this.world.getBlock(px, py, pz);
      const otherId = blockIdOf(other);
      if (otherId === partnerIdOf(id) && ROLES.openBit[otherId] !== 0) {
        const otherBits = stateBitsOf(other);
        const otherNext = powered
          ? otherBits | ROLES.openBit[otherId] | DOOR_POWERED_BIT
          : (otherBits & ~ROLES.openBit[otherId]) & ~DOOR_POWERED_BIT;
        if (otherNext !== otherBits) this.replace(px, py, pz, makeState(otherId, otherNext));
      }
    }
    this.events.onSound?.('block/door', x, y, z);
  }

  // --- pistão --------------------------------------------------------------

  /**
   * **Desvio consciente:** o pistão move os blocos de uma vez, sem os quadros
   * de animação do original. Animar exigiria uma entidade de bloco em
   * movimento, com colisão própria e re-meshing a cada quadro — caro demais
   * para o que o olho ganha num alvo de 30 FPS.
   */
  private applyPiston(x: number, y: number, z: number, state: number): void {
    const bits = stateBitsOf(state);
    const dir = bits & 7;
    const extended = (bits & 8) !== 0;
    const powered = this.poweredAt(x, y, z);
    if (powered === extended) return;

    if (powered) {
      if (!this.push(x, y, z, dir)) return;
      this.replace(x, y, z, makeState(blockIdOf(state), bits | 8));
      const step = DIRS[dir];
      const head = makeState(
        PISTON_HEAD_ID, dir | (ROLES.sticky[blockIdOf(state)] === 1 ? 8 : 0),
      );
      this.place(x + step[0], y + step[1], z + step[2], head);
      this.events.onSound?.('block/piston', x, y, z);
      return;
    }
    this.retract(x, y, z, state, bits, dir);
  }

  /** Empurra a coluna à frente. Devolve false se ela não cabe ou não sai. */
  private push(x: number, y: number, z: number, dir: number): boolean {
    const step = DIRS[dir];
    let count = 0;
    let cx = x + step[0];
    let cy = y + step[1];
    let cz = z + step[2];

    while (count <= PISTON_LIMIT) {
      if (cy < 0 || cy >= WORLD_HEIGHT) return false;
      const state = this.world.getBlock(cx, cy, cz);
      const id = blockIdOf(state);
      if (id === AIR || defOf(state).replaceable) break;
      if (ROLES.immovable[id] === 1) return false;
      count++;
      cx += step[0]; cy += step[1]; cz += step[2];
    }
    if (count > PISTON_LIMIT) return false;

    // Move de trás para a frente, senão a coluna se sobrescreve.
    for (let i = count; i >= 1; i--) {
      const fx = x + step[0] * i;
      const fy = y + step[1] * i;
      const fz = z + step[2] * i;
      const moving = this.world.getBlock(fx, fy, fz);
      this.place(fx + step[0], fy + step[1], fz + step[2], moving);
      this.place(fx, fy, fz, AIR);
    }
    return true;
  }

  /** Recolhe: tira o braço e, se for pegajoso, traz o bloco da ponta de volta. */
  private retract(
    x: number, y: number, z: number, state: number, bits: number, dir: number,
  ): void {
    const step = DIRS[dir];
    const hx = x + step[0];
    const hy = y + step[1];
    const hz = z + step[2];
    if (blockIdOf(this.world.getBlock(hx, hy, hz)) === PISTON_HEAD_ID) {
      this.place(hx, hy, hz, AIR);
    }
    this.replace(x, y, z, makeState(blockIdOf(state), bits & ~8));

    if (ROLES.sticky[blockIdOf(state)] !== 1) {
      this.events.onSound?.('block/piston', x, y, z);
      return;
    }
    const gx = hx + step[0];
    const gy = hy + step[1];
    const gz = hz + step[2];
    const grabbed = this.world.getBlock(gx, gy, gz);
    const grabbedId = blockIdOf(grabbed);
    if (grabbedId !== AIR && ROLES.immovable[grabbedId] !== 1 && !defOf(grabbed).replaceable) {
      this.place(gx, gy, gz, AIR);
      this.place(hx, hy, hz, grabbed);
    }
    this.events.onSound?.('block/piston', x, y, z);
  }

  // --- entrada do jogador --------------------------------------------------

  /**
   * Clique direito num componente. Devolve true se ele respondeu — o chamador
   * usa isso para não colocar bloco em cima.
   */
  use(x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    const bits = stateBitsOf(state);
    switch (ROLES.kind[id]) {
      case KIND_LEVER:
        this.replace(x, y, z, makeState(id, bits ^ 8));
        this.events.onSound?.('block/click', x, y, z);
        return true;
      case KIND_BUTTON:
        if ((bits & 8) !== 0) return true; // já apertado: o clique não empilha
        this.replace(x, y, z, makeState(id, bits | 8));
        this.events.onSound?.('block/click', x, y, z);
        this.scheduleAt(x, y, z, ROLES.pressTicks[id]);
        return true;
      case KIND_REPEATER: {
        // Quatro atrasos em ciclo, como na referência.
        const delay = ((bits >> 2) + 1) & 3;
        this.replace(x, y, z, makeState(id, (bits & ~12) | (delay << 2)));
        this.events.onSound?.('block/click', x, y, z);
        return true;
      }
      default:
        return false;
    }
  }

  private release(x: number, y: number, z: number, state: number): void {
    const bits = stateBitsOf(state);
    if ((bits & 8) === 0) return;
    this.replace(x, y, z, makeState(blockIdOf(state), bits & ~8));
    this.events.onSound?.('block/click', x, y, z);
  }

  // --- placas de pressão ---------------------------------------------------

  /**
   * Varredura de placas do tick: a sessão marca a posição de cada entidade e o
   * diff com o tick anterior liga e desliga as placas.
   *
   * Não há registro de placas no mundo — quem pisa é que é procurado. Uma roça
   * de mil placas custa zero enquanto ninguém andar nelas.
   */
  beginPlateScan(): void {
    this.scanning.clear();
  }

  /**
   * Marca o bloco em que a entidade pisa; ignora o que não for placa.
   *
   * O `+ FOOT_EPSILON` no Y não é frescura: a resolução de colisão pousa o pé
   * um décimo de milésimo **abaixo** do topo do bloco (ver `TOUCH_EPSILON` em
   * `physics.ts`), e sem a folga um `Math.floor` cairia no bloco de baixo e a
   * placa nunca afundaria.
   */
  markEntity(x: number, y: number, z: number): void {
    const bx = Math.floor(x);
    const by = Math.floor(y + FOOT_EPSILON);
    const bz = Math.floor(z);
    if (ROLES.kind[blockIdOf(this.world.getBlock(bx, by, bz))] !== KIND_PLATE) return;
    this.scanning.add(positionKey(bx, by, bz));
  }

  endPlateScan(): void {
    for (const key of this.scanning) {
      if (!this.pressed.has(key)) this.setPlate(key, true);
    }
    for (const key of this.pressed) {
      if (!this.scanning.has(key)) this.setPlate(key, false);
    }
    const previous = this.pressed;
    this.pressed = this.scanning;
    this.scanning = previous;
  }

  private setPlate(key: number, down: boolean): void {
    const x = xOfKey(key);
    const y = yOfKey(key);
    const z = zOfKey(key);
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    if (ROLES.kind[id] !== KIND_PLATE) return;
    const bits = stateBitsOf(state);
    if (((bits & 1) !== 0) === down) return;
    this.replace(x, y, z, makeState(id, down ? bits | 1 : bits & ~1));
    this.events.onSound?.('block/click', x, y, z);
  }

  // --- escrita no mundo ----------------------------------------------------

  /** Troca o bloco avisando a luz. Toda mutação do circuito passa por aqui. */
  private replace(x: number, y: number, z: number, state: number): void {
    const previous = this.world.getBlock(x, y, z);
    if (previous === state) return;
    if (!this.world.setBlock(x, y, z, state, 'physics')) return;
    this.events.onChanged?.(x, y, z, previous, state);
  }

  /** Idem, mas para o pistão, que escreve em posições que não são a dele. */
  private place(x: number, y: number, z: number, state: number): void {
    this.replace(x, y, z, state);
  }
}

const PISTON_HEAD_ID = (() => {
  const def = BLOCKS.find((b) => b !== undefined && b.name === 'piston_head');
  return def === undefined ? 0 : def.id;
})();

/**
 * Direção em que fica o apoio de um encaixe (`MOUNT_*` de `shapes.ts`).
 * Encaixe no chão procura embaixo; no teto, em cima; na parede, do lado.
 */
function mountDir(mount: number): readonly [number, number, number] {
  return DIRS[mountIndexOf(mount)];
}

/** Índice em `DIRS` do apoio de um encaixe. */
function mountIndexOf(mount: number): number {
  if (mount === MOUNT_FLOOR) return 5;
  if (mount === MOUNT_CEILING) return 4;
  return mount & 3;
}

/** 26 bits por eixo horizontal e 8 para Y cabem folgado em um double. */
function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}

function yOfKey(key: number): number {
  return key % 128;
}

function xOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(Math.floor(xz / 0x4000000));
}

function zOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(xz % 0x4000000);
}

/** Devolve o sinal a um inteiro de 26 bits. */
function signed26(value: number): number {
  return value >= 0x2000000 ? value - 0x4000000 : value;
}
