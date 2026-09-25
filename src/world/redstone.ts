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
 * O que ficou de fora, e por quê: não há queima de tocha por excesso de
 * pulsos nem energia quasi-conectada, e o pó não muda de desenho com a conexão
 * (ver `data/textures.ts`). Comparador, observador e funil entraram no M15,
 * com as contas em `redstoneparts.ts` — o circuito passou a mexer em item.
 *
 * **Propagação.** Não há varredura do mundo: toda mudança de bloco entra numa
 * fila de posições a reavaliar, como em `fluids.ts` e `growth.ts`. A fila é
 * drenada **dentro do mesmo tick**, em laço, até esvaziar ou bater o teto de
 * `MAX_UPDATES_PER_TICK` — um fio de 60 blocos acende no tick em que a alavanca
 * é puxada, que é o que o jogador espera. O teto é o que garante que um
 * circuito patológico custe um frame ruim e não um travamento.
 */

import { AIR, BLOCKS, blockIdOf, makeState, stateBitsOf } from '../data/blocks';
import { WORLD_HEIGHT } from './chunk';
import type { World } from './world';
import { partnerIdOf, partnerOffset } from './multiblock';
import {
  COMPARATOR_DELAY, OBSERVER_PULSE, comparatorOutput, comparatorPower, observerWatches,
  type ComparatorInputs,
} from './redstoneparts';
import {
  ACTIVE_BIT, DIRS, DOOR_PARTNER, DOOR_POWERED_BIT, KIND_BUTTON, KIND_COMPARATOR,
  KIND_DISPENSER, KIND_DOOR, KIND_HOPPER, KIND_LAMP, KIND_LEVER, KIND_NONE, KIND_OBSERVER,
  KIND_PISTON, KIND_RAIL, KIND_REPEATER, KIND_TORCH, KIND_WIRE, MAX_POWER,
  MAX_UPDATES_PER_TICK,
  RAIL_POWERED_BIT, ROLES, TORCH_DELAY, mountDir, opposite, positionKey, reachesFar, xOfKey, yOfKey,
  zOfKey, type CircuitWriter,
} from './redstoneroles';
import {
  emitted, powerAt, poweredAt, strongInto, weakInto, wirePowerAt,
} from './redstonepower';
import { applyPiston } from './redstonepiston';
import { PressurePlates } from './redstoneplates';

export { MAX_POWER, MAX_UPDATES_PER_TICK, PISTON_LIMIT } from './redstoneroles';

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


export class Redstone implements ComparatorInputs {
  private readonly world: World;
  private readonly events: RedstoneEvents;
  /**
   * Sinal do contêiner numa posição, 0..15, ou −1 (M15). Quem responde é
   * `game/itemflow.ts`; sem ele o comparador só lê energia.
   */
  signalOf: ((x: number, y: number, z: number) => number) | null = null;
  /** Dispensador ou liberador recebeu energia agora (M15): quem ouve dispara. */
  onTrigger: ((x: number, y: number, z: number) => void) | null = null;

  /** Fila de posições a reavaliar neste tick. */
  private queue: number[] = [];
  private readonly queued = new Set<number>();
  /** Tarefas com atraso, ordenadas por inserção (poucas dezenas no pior caso). */
  private delayed: Delayed[] = [];
  private tickCounter = 0;

  /** Quantas posições foram reavaliadas no último tick (overlay de debug). */
  lastUpdates = 0;

  /** O pistão e as placas escrevem pelo `replace` do circuito. */
  private readonly writer: CircuitWriter;
  private readonly plates: PressurePlates;

  constructor(world: World, events: RedstoneEvents = {}) {
    this.world = world;
    this.events = events;
    this.writer = {
      world,
      replace: (x, y, z, state) => this.replace(x, y, z, state),
      onSound: (name, x, y, z) => this.events.onSound?.(name, x, y, z),
    };
    this.plates = new PressurePlates(this.writer);
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
      this.notifyObservers(change.x, change.y, change.z);
    });
  }

  /**
   * Observador (M15): quem vigia a posição que mudou solta um pulso. Seis
   * leituras por mudança de bloco — o observador é achado por quem muda, e não
   * varre nada.
   */
  private notifyObservers(x: number, y: number, z: number): void {
    for (let d = 0; d < 6; d++) {
      const step = DIRS[d];
      const ox = x + step[0];
      const oy = y + step[1];
      const oz = z + step[2];
      const state = this.world.getBlock(ox, oy, oz);
      const id = blockIdOf(state);
      if (ROLES.kind[id] !== KIND_OBSERVER) continue;
      const bits = stateBitsOf(state);
      if ((bits & ACTIVE_BIT) !== 0) continue;
      if (!observerWatches(ox, oy, oz, bits & 7, x, y, z)) continue;
      this.replace(ox, oy, oz, makeState(id, bits | ACTIVE_BIT));
      this.scheduleAt(ox, oy, oz, OBSERVER_PULSE);
    }
  }

  // --- entradas do comparador (M15) ----------------------------------------

  containerSignal(x: number, y: number, z: number): number {
    return this.signalOf === null ? -1 : this.signalOf(x, y, z);
  }

  /** Energia que chega a `(x,y,z)` do vizinho na direção `fromDir`. */
  powerFrom(x: number, y: number, z: number, fromDir: number): number {
    const step = DIRS[fromDir];
    const nx = x + step[0];
    const ny = y + step[1];
    const nz = z + step[2];
    const state = this.world.getBlock(nx, ny, nz);
    const id = blockIdOf(state);
    const direct = emitted(state, id, opposite(fromDir));
    if (direct > 0 || ROLES.conductive[id] !== 1) return direct;
    if (strongInto(this.world, nx, ny, nz) > 0) return MAX_POWER;
    return weakInto(this.world, nx, ny, nz);
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
    else if (kind === KIND_COMPARATOR) this.applyComparator(x, y, z, state, id, true);
    else if (kind === KIND_OBSERVER) {
      this.replace(x, y, z, makeState(id, stateBitsOf(state) & ~ACTIVE_BIT));
    }
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
      case KIND_COMPARATOR: this.applyComparator(x, y, z, state, id, false); break;
      case KIND_HOPPER: this.applyHopper(x, y, z, state, id); break;
      case KIND_DISPENSER: this.applyDispenser(x, y, z, state, id); break;
      case KIND_OBSERVER: this.rearmObserver(x, y, z, state); break;
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

  // --- pó ------------------------------------------------------------------

  private applyWire(x: number, y: number, z: number, state: number): void {
    const power = wirePowerAt(this.world, x, y, z);
    if ((stateBitsOf(state) & 0xf) === power) return;
    this.replace(x, y, z, makeState(blockIdOf(state), power));
  }

  /**
   * true se um mecanismo em `(x,y,z)` está energizado (`redstonepower.ts`).
   */
  poweredAt(x: number, y: number, z: number): boolean {
    return poweredAt(this.world, x, y, z);
  }

  /** Energia do pó numa posição; 0 se não houver pó. Serve a teste e debug. */
  powerAt(x: number, y: number, z: number): number {
    return powerAt(this.world, x, y, z);
  }


  // --- componentes ---------------------------------------------------------

  /**
   * Tocha: acesa quando o apoio **não** está energizado. Inverte com atraso,
   * que é o que permite montar um oscilador sem travar o tick.
   */
  private scheduleTorch(x: number, y: number, z: number, id: number): void {
    const powered = ROLES.conductive[blockIdOf(this.world.getBlock(x, y - 1, z))] === 1
      && (strongInto(this.world, x, y - 1, z) > 0 || weakInto(this.world, x, y - 1, z) > 0);
    const lit = ROLES.lit[id] === 1;
    if (lit !== powered) return; // já está no estado certo
    this.scheduleAt(x, y, z, TORCH_DELAY);
  }

  private applyTorch(x: number, y: number, z: number, id: number): void {
    const powered = ROLES.conductive[blockIdOf(this.world.getBlock(x, y - 1, z))] === 1
      && (strongInto(this.world, x, y - 1, z) > 0 || weakInto(this.world, x, y - 1, z) > 0);
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
    const input = emitted(backState, backId, bits & 3) > 0
      || (ROLES.conductive[backId] === 1
        && (strongInto(this.world, bx, y, bz) > 0 || weakInto(this.world, bx, y, bz) > 0));

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

  // --- oficina (M15) -------------------------------------------------------

  /**
   * Comparador: a conta é de `redstoneparts.ts`; aqui, o atraso — como o
   * repetidor, a reavaliação agenda e a tarefa vencida aplica.
   */
  private applyComparator(
    x: number, y: number, z: number, state: number, id: number, immediate: boolean,
  ): void {
    const bits = stateBitsOf(state);
    const power = comparatorOutput(this, x, y, z, bits & 3, ROLES.lit[id] === 1);
    if (power === comparatorPower(state)) return;
    if (!immediate) {
      this.scheduleAt(x, y, z, COMPARATOR_DELAY);
      return;
    }
    this.replace(x, y, z, makeState(id, (bits & 3) | (power << 2)));
  }

  /** Funil: travado (bit 3) enquanto energizado. Quem move item lê o bit. */
  private applyHopper(x: number, y: number, z: number, state: number, id: number): void {
    const bits = stateBitsOf(state);
    const powered = this.poweredAt(x, y, z);
    if (powered === ((bits & ACTIVE_BIT) !== 0)) return;
    this.replace(x, y, z, makeState(id, powered ? bits | ACTIVE_BIT : bits & ~ACTIVE_BIT));
  }

  /**
   * Dispensador e liberador: disparam **na subida** da energia. O bit 3
   * lembra que já dispararam, para energia constante não virar metralhadora.
   */
  private applyDispenser(x: number, y: number, z: number, state: number, id: number): void {
    const bits = stateBitsOf(state);
    const powered = this.poweredAt(x, y, z);
    const armed = (bits & ACTIVE_BIT) !== 0;
    if (powered === armed) return;
    this.replace(x, y, z, makeState(id, powered ? bits | ACTIVE_BIT : bits & ~ACTIVE_BIT));
    if (powered) this.onTrigger?.(x, y, z);
  }

  /** Observador pulsando que ficou sem tarefa (save no meio do pulso) volta a ter. */
  private rearmObserver(x: number, y: number, z: number, state: number): void {
    if ((stateBitsOf(state) & ACTIVE_BIT) === 0) return;
    this.scheduleAt(x, y, z, OBSERVER_PULSE);
  }

  // --- pistão --------------------------------------------------------------

  private applyPiston(x: number, y: number, z: number, state: number): void {
    applyPiston(this.writer, x, y, z, state, this.poweredAt(x, y, z));
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
      case KIND_COMPARATOR: {
        // Clique troca o modo: comparar ↔ subtrair, que são dois ids (M15).
        const other = ROLES.pair[id];
        if (other === 0) return false;
        this.replace(x, y, z, makeState(other, bits));
        this.events.onSound?.('block/click', x, y, z);
        this.schedule(x, y, z);
        return true;
      }
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

  // --- placas de pressão (`redstoneplates.ts`) ---------------------------

  beginPlateScan(): void {
    this.plates.begin();
  }

  markEntity(x: number, y: number, z: number): void {
    this.plates.mark(x, y, z);
  }

  endPlateScan(): void {
    this.plates.end();
  }

  // --- escrita no mundo ----------------------------------------------------

  /** Troca o bloco avisando a luz. Toda mutação do circuito passa por aqui. */
  private replace(x: number, y: number, z: number, state: number): void {
    const previous = this.world.getBlock(x, y, z);
    if (previous === state) return;
    if (!this.world.setBlock(x, y, z, state, 'physics')) return;
    this.events.onChanged?.(x, y, z, previous, state);
  }

}
