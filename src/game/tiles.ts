/**
 * Contêineres que existem no mundo: baú e fornalha, a tampa que levanta, o
 * loot de estrutura e o que vai para o save (doc 08 §3.8–§3.9, doc 11).
 *
 * Saiu da `Session` em 2026-09-22 (M13). O que é **tela** — a grade de
 * criação, a bancada, a mesa de encantamento — está em `game/workbench.ts`;
 * aqui fica o que tem posição no mundo e sobrevive a fechar a tela.
 */

import { BLOCK_BY_NAME, blockIdOf, makeState, stateBitsOf } from '../data/blocks';
import { ITEM_BY_NAME, type ItemStack } from '../data/items';
import { rollChestLoot } from '../world/gen/structures';
import { CHEST_SLOTS, Container, DoubleChestView, Furnace } from './container';
import type { World } from '../world/world';

const FURNACE = BLOCK_BY_NAME.get('furnace')?.id ?? -1;
const FURNACE_LIT = BLOCK_BY_NAME.get('furnace_lit')?.id ?? -1;
const CHEST = BLOCK_BY_NAME.get('chest')?.id ?? -1;
export const HOPPER = BLOCK_BY_NAME.get('hopper')?.id ?? -1;
const DISPENSER = BLOCK_BY_NAME.get('dispenser')?.id ?? -1;
const DROPPER = BLOCK_BY_NAME.get('dropper')?.id ?? -1;

/** Slots de funil, dispensador e liberador (M15). */
export const HOPPER_SLOTS = 5;
export const DISPENSER_SLOTS = 9;

/** Os quatro vizinhos horizontais, para achar a outra metade do baú duplo. */
const CHEST_NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export interface TileEvents {
  /** O bloco da fornalha acendeu ou apagou — a luz precisa saber. */
  onChanged(x: number, y: number, z: number, previous: number, state: number): void;
  /** O conteúdo de um contêiner quebrado cai no chão. */
  onDrop(stack: ItemStack, x: number, y: number, z: number): void;
  /** O conteúdo de um contêiner mudou (M15: o comparador ao lado relê). */
  onContents?(x: number, y: number, z: number): void;
}

export function isContainerBlock(id: number): boolean {
  return id === FURNACE || id === FURNACE_LIT || id === CHEST
    || id === HOPPER || id === DISPENSER || id === DROPPER;
}

/** true se o contêiner abre na grade simples (baú, funil, dispensador, liberador). */
export function isGridContainer(id: number): boolean {
  return id === HOPPER || id === DISPENSER || id === DROPPER;
}

/** Um contêiner novo para o bloco `id`, na posição dada. */
function containerFor(id: number, x: number, y: number, z: number): Container {
  if (isFurnaceBlock(id)) return new Furnace(x, y, z);
  if (id === HOPPER) {
    const hopper = new Container('hopper', HOPPER_SLOTS, x, y, z);
    // Vai para o save mesmo vazio: é assim que o funil volta a sugar depois de
    // recarregar o mundo, sem ninguém abri-lo antes.
    hopper.persistent = true;
    return hopper;
  }
  if (id === DISPENSER) return new Container('dispenser', DISPENSER_SLOTS, x, y, z);
  if (id === DROPPER) return new Container('dropper', DISPENSER_SLOTS, x, y, z);
  return new Container('chest', CHEST_SLOTS, x, y, z);
}

export function isFurnaceBlock(id: number): boolean {
  return id === FURNACE || id === FURNACE_LIT;
}

export class Tiles {
  private readonly world: World;
  private readonly events: TileEvents;
  /** Tile entities por posição empacotada. */
  private readonly containers = new Map<number, Container>();
  /** Baús com a tampa levantada, como triplas `(x, y, z)` (M8). */
  private readonly openLids: number[] = [];
  /** Os funis, para quem move item não varrer todo contêiner (M15). */
  readonly hoppers = new Set<Container>();

  constructor(world: World, events: TileEvents) {
    this.world = world;
    this.events = events;
  }

  /** Cria o tile entity quando um baú ou fornalha é colocado. */
  create(x: number, y: number, z: number, blockId: number): void {
    if (!isContainerBlock(blockId)) return;
    this.track(containerFor(blockId, x, y, z));
  }

  /** Registra o contêiner: posição, lista de funis e aviso de conteúdo. */
  private track(container: Container): void {
    const { x, y, z } = container;
    this.containers.set(positionKey(x, y, z), container);
    if (container.kind === 'hopper') this.hoppers.add(container);
    container.onChange = () => { this.events.onContents?.(x, y, z); };
  }

  /** Remove o tile entity e dropa o conteúdo. Devolve o que saiu, se havia. */
  remove(x: number, y: number, z: number): Container | undefined {
    const key = positionKey(x, y, z);
    const container = this.containers.get(key);
    if (container === undefined) return undefined;
    this.containers.delete(key);
    this.hoppers.delete(container);
    container.onChange = null;
    for (const stack of container.slots) {
      if (stack !== null) this.events.onDrop(stack, x + 0.5, y + 0.5, z + 0.5);
    }
    return container;
  }

  at(x: number, y: number, z: number): Container | undefined {
    return this.containers.get(positionKey(x, y, z));
  }

  /** O contêiner da posição, criando na hora se o bloco veio da geração. */
  atOrCreate(x: number, y: number, z: number, blockId: number): Container {
    const key = positionKey(x, y, z);
    let container = this.containers.get(key);
    if (container === undefined) {
      container = containerFor(blockId, x, y, z);
      this.track(container);
    }
    return container;
  }

  /**
   * Visão de baú duplo, se houver um baú colado (doc 08 §3.9).
   *
   * A ordem é fixa — o baú de menor `(x, z)` fica com os primeiros 27 slots —
   * para que abrir pela esquerda ou pela direita mostre a mesma coisa.
   */
  findDoubleChest(x: number, y: number, z: number): DoubleChestView | null {
    for (const [dx, dz] of CHEST_NEIGHBORS) {
      const nx = x + dx;
      const nz = z + dz;
      if (blockIdOf(this.world.getBlock(nx, y, nz)) !== CHEST) continue;
      const here = this.atOrCreate(x, y, z, CHEST);
      const there = this.atOrCreate(nx, y, nz, CHEST);
      const hereFirst = x < nx || z < nz;
      return hereFirst ? new DoubleChestView(here, there) : new DoubleChestView(there, here);
    }
    return null;
  }

  /**
   * Levanta a tampa do baú aberto — e a do par, se for baú duplo (M8).
   *
   * A tampa é **estado de bloco**, não animação: ver `mesh/complex.ts`. Por
   * isso abrir custa um `setBlock`, que suja a section e a remesha uma vez.
   */
  openLid(x: number, y: number, z: number): void {
    this.closeLids();
    this.setLid(x, y, z, true);
    for (const [dx, dz] of CHEST_NEIGHBORS) {
      if (blockIdOf(this.world.getBlock(x + dx, y, z + dz)) !== CHEST) continue;
      this.setLid(x + dx, y, z + dz, true);
      break;
    }
  }

  /** Fecha toda tampa que este jogador tenha levantado. */
  closeLids(): void {
    const open = this.openLids;
    for (let i = 0; i < open.length; i += 3) this.setLid(open[i], open[i + 1], open[i + 2], false);
    open.length = 0;
  }

  private setLid(x: number, y: number, z: number, open: boolean): void {
    const state = this.world.getBlock(x, y, z);
    if (blockIdOf(state) !== CHEST) return;
    const bits = stateBitsOf(state);
    const next = makeState(CHEST, open ? bits | 1 : bits & ~1);
    if (next === state) return;
    // `source: 'player'` é a mesma porta de sempre: nenhuma mutação de voxel
    // escapa do `setBlock` (regra nº 3 do projeto).
    this.world.setBlock(x, y, z, next, 'player');
    if (open) this.openLids.push(x, y, z);
  }

  /** Fornalhas queimam com a tela fechada (doc 05 §7). */
  tick(): void {
    for (const container of this.containers.values()) {
      if (!(container instanceof Furnace)) continue;
      container.tick();
      this.syncFurnaceBlock(container);
    }
  }

  /**
   * A boca da fornalha acende enquanto ela queima (M8).
   *
   * São dois ids de bloco, como a lâmpada de redstone: a emissão de luz é
   * coluna da tabela indexada por id. Trocar o bloco **precisa** avisar a luz,
   * senão a fornalha acende na textura e a caverna em volta continua escura.
   * A troca só acontece quando o estado muda de verdade.
   */
  private syncFurnaceBlock(furnace: Furnace): void {
    const { x, y, z } = furnace;
    const current = this.world.getBlock(x, y, z);
    const id = blockIdOf(current);
    if (!isFurnaceBlock(id)) return;
    const wanted = furnace.isLit ? FURNACE_LIT : FURNACE;
    if (id === wanted) return;
    const next = makeState(wanted, stateBitsOf(current));
    if (!this.world.setBlock(x, y, z, next, 'physics')) return;
    this.events.onChanged(x, y, z, current, next);
  }

  /**
   * Baú de estrutura: enche na primeira vez que o chunk entra. Um baú que
   * **já existe** (veio do save) não é reabastecido — é o que impede duplicar
   * loot recarregando o mundo.
   */
  fillLoot(x: number, y: number, z: number, table: string): void {
    const key = positionKey(x, y, z);
    if (this.containers.has(key)) return;
    const container = new Container('chest', CHEST_SLOTS, x, y, z);
    // Fica no save mesmo vazio: um baú saqueado que não é salvo volta cheio.
    container.persistent = true;
    rollChestLoot(this.world.seed, x, y, z, table, (name, count) => {
      const item = ITEM_BY_NAME.get(name);
      if (item !== undefined) container.give(item.id, count);
    });
    this.track(container);
  }

  /** Todos os contêineres com conteúdo, para o save. */
  get saved(): readonly Container[] {
    const out: Container[] = [];
    for (const container of this.containers.values()) {
      if (!container.isEmpty || container.persistent || container instanceof Furnace) {
        out.push(container);
      }
    }
    return out;
  }

  /** Restaura contêineres vindos do save. */
  restore(container: Container): void {
    if (container.kind === 'hopper') container.persistent = true;
    this.track(container);
  }

  /** Esquece tudo (troca de dimensão). */
  clear(): void {
    this.containers.clear();
    this.hoppers.clear();
    this.openLids.length = 0;
  }
}

function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}
