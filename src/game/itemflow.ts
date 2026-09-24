/**
 * O circuito mexendo em item (M15): funil, dispensador, liberador e o sinal
 * que o comparador lê de um contêiner.
 *
 * **Funil.** A cada `HOPPER_COOLDOWN` ticks, destravado, ele empurra um item
 * para o contêiner do bico e puxa um do contêiner de cima — ou do item caído
 * em cima dele. Na fornalha a regra é a do gênero: entrando por cima vai para
 * a entrada, pelo lado vai para o combustível, e puxando de baixo sai só a
 * saída. É o que faz a fornalha alimentada sozinha do critério do doc 14.
 *
 * **Dispensador e liberador.** Disparam na subida de energia (quem avisa é o
 * `Redstone`). O liberador solta o item — ou o empurra para o contêiner da
 * frente, como um funil de lado. O dispensador **usa** o que sabe usar
 * (flecha, ovo, bola de neve, balde, isqueiro) e solta o resto.
 *
 * O funil só visita os funis (`Tiles.hoppers`), e nada aqui aloca por tick: o
 * item que anda é copiado para um `ItemStack` de rascunho.
 */

import { AIR, BLOCK_BY_NAME, LAVA, WATER, blockIdOf, defOf, makeState, stateBitsOf } from '../data/blocks';
import { ITEM_BY_NAME, itemDef, maxStackOf, type ItemStack } from '../data/items';
import { PISTON_STEP } from '../world/mesh/shapes';
import { isSource, makeFluid } from '../world/fluids';
import { signalOfFullness } from '../world/redstoneparts';
import { FLAG_EGG } from '../entity/projectile';
import {
  FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace, fuelTicks, smeltingOutput,
  type Container,
} from './container';
import { HOPPER, isContainerBlock, type Tiles } from './tiles';
import type { ItemEntities } from '../entity/itementity';
import type { Projectiles } from '../entity/projectile';
import type { Fire } from '../world/fire';
import type { World } from '../world/world';

/** Ticks entre dois itens do funil: 2,5 itens por segundo, como no gênero. */
export const HOPPER_COOLDOWN = 8;
/** Bit de "travado" do funil e de "já disparou" do dispensador. */
const ACTIVE_BIT = 8;
/** Velocidade da flecha e do arremesso do dispensador, em blocos por tick. */
const DISPENSE_SPEED = 1.1;
/** Dano da flecha do dispensador (a do esqueleto no Normal). */
const DISPENSE_ARROW_DAMAGE = 3;

const DISPENSER = BLOCK_BY_NAME.get('dispenser')?.id ?? -1;
const id = (name: string): number => ITEM_BY_NAME.get(name)?.id ?? -1;
const ARROW = id('arrow');
const EGG = id('egg');
const SNOWBALL = id('snowball');
const BUCKET = id('bucket');
const WATER_BUCKET = id('water_bucket');
const LAVA_BUCKET = id('lava_bucket');
const FLINT_AND_STEEL = id('flint_and_steel');

/** Direção de quem **entra** num contêiner: de cima, de baixo ou de lado. */
type Entry = 'above' | 'below' | 'side';

/** Entrada de quem está no passo `dir` (`PISTON_STEP`) apontando para o contêiner. */
function entryOf(dir: number): Entry {
  if (dir === 5) return 'above'; // bico para baixo: entra por cima
  if (dir === 4) return 'below';
  return 'side';
}

export interface ItemFlowHost {
  readonly world: World;
  readonly tiles: Tiles;
  readonly items: ItemEntities;
  readonly projectiles: Projectiles;
  readonly fire: Fire;
  /** Um bloco mudou pelo dispensador (fluido, fogo): luz e fluidos precisam saber. */
  blockChanged(x: number, y: number, z: number, previous: number, state: number): void;
  sound(name: string, x: number, y: number, z: number): void;
  random(): number;
}

export class ItemFlow {
  private readonly host: ItemFlowHost;
  /** O item em trânsito, reusado — o tick não aloca pilha. */
  private readonly moving: ItemStack = { item: 0, count: 1, damage: 0, ench: 0 };
  /** Itens movidos no último tick (debug e teste de orçamento). */
  moved = 0;

  constructor(host: ItemFlowHost) {
    this.host = host;
  }

  // --- funil -----------------------------------------------------------------

  tick(): void {
    this.moved = 0;
    for (const hopper of this.host.tiles.hoppers) {
      if (hopper.cooldown > 0) { hopper.cooldown--; continue; }
      const { x, y, z } = hopper;
      const state = this.host.world.getBlock(x, y, z);
      // Coluna descarregada responde ar; bloco trocado por outro também para.
      if (blockIdOf(state) !== HOPPER) continue;
      const bits = stateBitsOf(state);
      if ((bits & ACTIVE_BIT) !== 0) continue; // travado pelo circuito
      let moved = this.push(hopper, bits & 7);
      if (this.pull(hopper)) moved = true;
      if (moved) {
        hopper.cooldown = HOPPER_COOLDOWN;
        this.moved++;
      }
    }
  }

  /** Um item do funil para o contêiner do bico. */
  private push(hopper: Container, dir: number): boolean {
    const step = PISTON_STEP[dir];
    const target = this.containerAt(hopper.x + step[0], hopper.y + step[1], hopper.z + step[2]);
    if (target === null) return false;
    for (let i = 0; i < hopper.size; i++) {
      const stack = hopper.get(i);
      if (stack === null) continue;
      copyOne(stack, this.moving);
      if (!insertOne(target, this.moving, entryOf(dir))) continue;
      takeOne(hopper, i);
      return true;
    }
    return false;
  }

  /** Um item do contêiner de cima — ou do chão logo acima — para o funil. */
  private pull(hopper: Container): boolean {
    const { x, y, z } = hopper;
    const source = this.containerAt(x, y + 1, z);
    if (source !== null) {
      const slot = extractSlot(source, hopper);
      if (slot < 0) return false;
      copyOne(source.get(slot) as ItemStack, this.moving);
      if (!insertOne(hopper, this.moving, 'above')) return false;
      takeOne(source, slot);
      return true;
    }
    if (defOf(this.host.world.getBlock(x, y + 1, z)).solid) return false;
    const items = this.host.items;
    if (!items.takeOneIn(x, y + 0.9, z, x + 1, y + 2, z + 1, this.moving)) return false;
    if (insertOne(hopper, this.moving, 'above')) return true;
    items.putBack(this.moving, x + 0.5, y + 1.2, z + 0.5);
    return false;
  }

  // --- comparador ------------------------------------------------------------

  /**
   * Sinal do contêiner em `(x, y, z)`: 0..15 pela ocupação, ou −1 se ali não
   * há contêiner. Contêiner que nunca foi aberto (sem tile ainda) é vazio.
   */
  signal(x: number, y: number, z: number): number {
    const blockId = blockIdOf(this.host.world.getBlock(x, y, z));
    if (!isContainerBlock(blockId)) return -1;
    const container = this.host.tiles.at(x, y, z);
    if (container === undefined) return 0;
    let fullness = 0;
    let any = false;
    for (let i = 0; i < container.size; i++) {
      const stack = container.get(i);
      if (stack === null) continue;
      any = true;
      fullness += stack.count / maxStackOf(stack.item);
    }
    return signalOfFullness(fullness / container.size, any);
  }

  // --- dispensador e liberador ------------------------------------------------

  /** O circuito disparou o dispensador (ou liberador) em `(x, y, z)`. */
  dispense(x: number, y: number, z: number): void {
    const { world, tiles } = this.host;
    const state = world.getBlock(x, y, z);
    const blockId = blockIdOf(state);
    const container = tiles.atOrCreate(x, y, z, blockId);
    const slot = this.pickSlot(container);
    if (slot < 0) {
      this.host.sound('block/click', x + 0.5, y + 0.5, z + 0.5);
      return;
    }
    const dir = stateBitsOf(state) & 7;
    const step = PISTON_STEP[dir];
    const fx = x + step[0];
    const fy = y + step[1];
    const fz = z + step[2];
    const stack = container.get(slot) as ItemStack;

    const used = blockId === DISPENSER
      ? this.useItem(container, slot, stack, fx, fy, fz, dir)
      : this.feed(container, slot, stack, fx, fy, fz, dir);
    if (!used) this.drop(container, slot, stack, x, y, z, dir);
    this.host.sound('block/click', x + 0.5, y + 0.5, z + 0.5);
  }

  /** Slot sorteado entre os que têm item, como no gênero; −1 se vazio. */
  private pickSlot(container: Container): number {
    let filled = 0;
    for (let i = 0; i < container.size; i++) if (container.get(i) !== null) filled++;
    if (filled === 0) return -1;
    let pick = Math.floor(this.host.random() * filled);
    for (let i = 0; i < container.size; i++) {
      if (container.get(i) === null) continue;
      if (pick-- === 0) return i;
    }
    return -1;
  }

  /** Liberador com contêiner na frente: empurra um item, como o funil. */
  private feed(
    container: Container, slot: number, stack: ItemStack,
    fx: number, fy: number, fz: number, dir: number,
  ): boolean {
    const target = this.containerAt(fx, fy, fz);
    if (target === null) return false;
    copyOne(stack, this.moving);
    if (insertOne(target, this.moving, entryOf(dir))) takeOne(container, slot);
    // Com contêiner na frente, o liberador nunca cospe no chão.
    return true;
  }

  /** O que o dispensador sabe usar. Devolve false para "solte no chão". */
  private useItem(
    container: Container, slot: number, stack: ItemStack,
    fx: number, fy: number, fz: number, dir: number,
  ): boolean {
    const { world, projectiles } = this.host;
    const step = PISTON_STEP[dir];
    const cx = fx + 0.5 - step[0] * 0.3;
    const cy = fy + 0.5 - step[1] * 0.3;
    const cz = fz + 0.5 - step[2] * 0.3;

    if (stack.item === ARROW) {
      if (!projectiles.spawn(cx, cy, cz, step[0], step[1] + 0.1, step[2],
        DISPENSE_ARROW_DAMAGE, false, DISPENSE_SPEED)) return true;
      takeOne(container, slot);
      return true;
    }
    if (stack.item === EGG || stack.item === SNOWBALL) {
      if (!projectiles.spawn(cx, cy, cz, step[0], step[1] + 0.1, step[2], 0, false,
        DISPENSE_SPEED, stack.item === EGG ? FLAG_EGG : 0, stack.item)) return true;
      takeOne(container, slot);
      return true;
    }
    if (stack.item === WATER_BUCKET || stack.item === LAVA_BUCKET) {
      const previous = world.getBlock(fx, fy, fz);
      if (blockIdOf(previous) !== AIR && !defOf(previous).replaceable) return true;
      const fluid = makeFluid(stack.item === WATER_BUCKET ? WATER : LAVA, 0);
      if (!world.setBlock(fx, fy, fz, fluid, 'physics')) return true;
      this.host.blockChanged(fx, fy, fz, previous, fluid);
      container.set(slot, { item: BUCKET, count: 1, damage: 0 });
      return true;
    }
    if (stack.item === BUCKET) {
      const previous = world.getBlock(fx, fy, fz);
      const fluidId = blockIdOf(previous);
      if ((fluidId !== WATER && fluidId !== LAVA) || !isSource(previous)) return false;
      if (!world.setBlock(fx, fy, fz, makeState(AIR), 'physics')) return true;
      this.host.blockChanged(fx, fy, fz, previous, makeState(AIR));
      const full = fluidId === WATER ? WATER_BUCKET : LAVA_BUCKET;
      takeOne(container, slot);
      if (container.give(full, 1) > 0) {
        this.host.items.spawn(fx + 0.5, fy + 0.5, fz + 0.5, { item: full, count: 1, damage: 0 });
      }
      return true;
    }
    if (stack.item === FLINT_AND_STEEL) {
      if (this.host.fire.ignite(fx, fy, fz)) {
        const max = itemDef(stack.item)?.durability ?? 0;
        const worn = { ...stack, damage: stack.damage + 1 };
        container.set(slot, max > 0 && worn.damage >= max ? null : worn);
      }
      return true;
    }
    return false;
  }

  /** Solta um item na frente, com impulso na direção da boca. */
  private drop(
    container: Container, slot: number, stack: ItemStack,
    x: number, y: number, z: number, dir: number,
  ): void {
    const step = PISTON_STEP[dir];
    copyOne(stack, this.moving);
    const out: ItemStack = { ...this.moving };
    const sx = x + 0.5 + step[0] * 0.7;
    const sy = y + 0.5 + step[1] * 0.7 - (step[1] === 0 ? 0.15 : 0);
    const sz = z + 0.5 + step[2] * 0.7;
    if (!this.host.items.spawn(sx, sy, sz, out, step)) return;
    takeOne(container, slot);
  }

  /** O contêiner no bloco, criando o tile se ainda não existe; `null` se não é contêiner. */
  private containerAt(x: number, y: number, z: number): Container | null {
    const blockId = blockIdOf(this.host.world.getBlock(x, y, z));
    if (!isContainerBlock(blockId)) return null;
    return this.host.tiles.atOrCreate(x, y, z, blockId);
  }
}

// --- regras de slot ------------------------------------------------------------

/** Copia uma unidade de `stack` para `out`, com encantamento e nome. */
function copyOne(stack: ItemStack, out: ItemStack): void {
  out.item = stack.item;
  out.count = 1;
  out.damage = stack.damage;
  out.ench = stack.ench ?? 0;
  if (stack.name === undefined) delete out.name;
  else out.name = stack.name;
}

/** Tira uma unidade do slot, avisando o contêiner (o comparador relê). */
function takeOne(container: Container, slot: number): void {
  const stack = container.get(slot);
  if (stack === null) return;
  stack.count--;
  container.set(slot, stack.count > 0 ? stack : null);
}

/**
 * Põe uma unidade no contêiner, pela entrada `entry`. Na fornalha: por cima só
 * na entrada (e só o que funde), pelo lado só no combustível (e só o que
 * queima). No resto: primeiro empilha, depois ocupa um slot vazio.
 */
export function insertOne(container: Container, one: ItemStack, entry: Entry): boolean {
  if (container instanceof Furnace) {
    if (entry === 'above') {
      if (smeltingOutput(one.item) === null) return false;
      return insertAt(container, FURNACE_INPUT, one);
    }
    if (entry === 'side') {
      if (fuelTicks(one.item) <= 0) return false;
      return insertAt(container, FURNACE_FUEL, one);
    }
    return false;
  }
  for (let i = 0; i < container.size; i++) {
    const slot = container.get(i);
    if (slot === null || !sameKind(slot, one)) continue;
    if (slot.count >= maxStackOf(slot.item)) continue;
    slot.count++;
    container.set(i, slot);
    return true;
  }
  for (let i = 0; i < container.size; i++) {
    if (container.get(i) !== null) continue;
    container.set(i, { ...one, count: 1 });
    return true;
  }
  return false;
}

function insertAt(container: Container, index: number, one: ItemStack): boolean {
  const slot = container.get(index);
  if (slot === null) {
    container.set(index, { ...one, count: 1 });
    return true;
  }
  if (!sameKind(slot, one) || slot.count >= maxStackOf(slot.item)) return false;
  slot.count++;
  container.set(index, slot);
  return true;
}

/** Duas pilhas que se juntam: mesmo item, dano, encantamento e sem nome. */
function sameKind(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && a.damage === b.damage && (a.ench ?? 0) === (b.ench ?? 0)
    && a.name === undefined && b.name === undefined;
}

/**
 * Slot de onde o funil `into` puxa do contêiner `source`: da fornalha só a
 * saída; do resto, o primeiro com item que caiba no funil. −1 se nada.
 */
function extractSlot(source: Container, into: Container): number {
  if (source instanceof Furnace) {
    return source.get(FURNACE_OUTPUT) === null ? -1 : FURNACE_OUTPUT;
  }
  for (let i = 0; i < source.size; i++) {
    const stack = source.get(i);
    if (stack === null) continue;
    if (fits(into, stack)) return i;
  }
  return -1;
}

/** true se uma unidade de `stack` cabe em algum slot de `container`. */
function fits(container: Container, stack: ItemStack): boolean {
  for (let i = 0; i < container.size; i++) {
    const slot = container.get(i);
    if (slot === null) return true;
    if (sameKind(slot, stack) && slot.count < maxStackOf(slot.item)) return true;
  }
  return false;
}
