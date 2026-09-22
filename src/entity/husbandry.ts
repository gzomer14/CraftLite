/**
 * O que os bichos dão e fazem com o mundo, fora de combate (doc 07 §1).
 *
 * Criado em 2026-09-22 para as quatro regras da tabela de mobs que não
 * existiam: a ovelha tinha sempre lã branca e só a dava morrendo, a galinha
 * não punha ovo, a vaca não dava leite e o enderman não mexia em bloco. Cada
 * uma é ligada por um traço em `data/mobs.ts` (`woolly`, `lays`, `milkable`,
 * `carriesBlocks`) — o módulo não sabe o nome de nenhum bicho.
 *
 * `mobs.ts` já passa do tamanho de um módulo, e isto não é IA nem física:
 * é o bicho como **fonte de recurso**.
 */

import { AIR, BLOCK_BY_NAME, GRASS_BLOCK, DIRT, blockIdOf, defOf, makeState } from '../data/blocks';
import { DYES } from '../data/dyes';
import { ITEM_BY_NAME } from '../data/items';
import type { MobDef } from '../data/mobs';
import type { MobStore } from './mobstore';
import type { World } from '../world/world';

/** Bit da variante que marca a ovelha tosquiada; os 4 de baixo são a cor. */
export const SHEARED = 0x80;
export const COLOR_MASK = 0x0f;
/** Chance por tick de a ovelha tosquiada pastar e recuperar a lã (~50 s). */
const REGROW_CHANCE = 1 / 1000;
/** Chance por tick de o enderman pegar e de pôr um bloco. */
const PICKUP_CHANCE = 1 / 400;
const PLACE_CHANCE = 1 / 1200;

/**
 * O que o enderman pega: terra, areia, planta e abóbora — nunca pedra, minério
 * ou o que o jogador construiu com trabalho. É a regra do gênero, e a que
 * impede o bicho de desmontar a casa.
 */
const CARRIABLE = new Set<number>(
  [
    'grass_block', 'dirt', 'sand', 'red_sand', 'gravel', 'clay', 'podzol', 'coarse_dirt',
    'dandelion', 'poppy', 'brown_mushroom', 'red_mushroom', 'pumpkin', 'melon', 'cactus', 'tnt',
  ].map((name) => BLOCK_BY_NAME.get(name)?.id ?? -1),
);

export interface HusbandryEvents {
  onDrop(item: number, count: number, x: number, y: number, z: number): void;
  onSound(name: string, x: number, y: number, z: number): void;
  /** Um bloco mudou pelo bicho — a luz precisa saber. */
  onBlockChanged?(x: number, y: number, z: number, previous: number, state: number): void;
}

export function woolColorOf(variant: number): number {
  return variant & COLOR_MASK;
}

export function isSheared(variant: number): boolean {
  return (variant & SHEARED) !== 0;
}

/**
 * Cor de uma ovelha nascendo (doc 07 §1: "15% de chance de cor rara"): 85%
 * branca, o resto dividido por igual entre as outras cores de `DYES`.
 */
export function rollSheepColor(random: number): number {
  if (random < 0.85 || DYES.length < 2) return 0;
  const rare = (random - 0.85) / 0.15;
  return 1 + Math.min(DYES.length - 2, Math.floor(rare * (DYES.length - 1)));
}

/** Item de lã de uma cor (índice em `DYES`). */
export function woolItemOf(color: number): number {
  const dye = DYES[color] ?? DYES[0];
  const name = dye.name === 'white' ? 'white_wool' : `${dye.name}_wool`;
  return ITEM_BY_NAME.get(name)?.id ?? -1;
}

/** Variante inicial de um bicho que nasce do mundo (não de reprodução). */
export function spawnVariant(def: MobDef, random: () => number): number {
  return def.traits.woolly === true ? rollSheepColor(random()) : 0;
}

/** O filhote herda a cor, não a tosquia. */
export function babyVariant(def: MobDef, parent: number): number {
  return def.traits.woolly === true ? parent & COLOR_MASK : parent;
}

/**
 * Tosquia: devolve quantas lãs caem (1–3), ou 0 se não é ovelha, se é filhote
 * ou se já está tosquiada.
 */
export function shear(store: MobStore, i: number, def: MobDef, random: () => number): number {
  if (def.traits.woolly !== true || store.isBaby(i) || isSheared(store.variant[i])) return 0;
  store.variant[i] |= SHEARED;
  return 1 + Math.floor(random() * 3);
}

/** Tinge a ovelha. Devolve false se já é daquela cor (o corante não se gasta). */
export function dye(store: MobStore, i: number, def: MobDef, color: number): boolean {
  if (def.traits.woolly !== true) return false;
  if (woolColorOf(store.variant[i]) === color) return false;
  store.variant[i] = (store.variant[i] & SHEARED) | (color & COLOR_MASK);
  return true;
}

/** O que cai além da tabela de drops ao morrer: a lã e o bloco carregado. */
export function deathDrops(
  store: MobStore, i: number, def: MobDef, events: HusbandryEvents,
  x: number, y: number, z: number,
): void {
  if (def.traits.woolly === true && !isSheared(store.variant[i]) && !store.isBaby(i)) {
    const wool = woolItemOf(woolColorOf(store.variant[i]));
    if (wool >= 0) events.onDrop(wool, 1, x, y, z);
  }
  const carried = store.carried[i];
  if (carried !== 0) {
    const item = ITEM_BY_NAME.get(defOf(carried).name);
    if (item !== undefined) events.onDrop(item.id, 1, x, y, z);
    store.carried[i] = 0;
  }
}

/** Um tick de produção de um bicho. */
export function tickHusbandry(
  store: MobStore, i: number, def: MobDef, world: World,
  random: () => number, events: HusbandryEvents,
): void {
  const traits = def.traits;
  if (traits.lays !== undefined && !store.isBaby(i)) tickLaying(store, i, traits.lays, random, events);
  if (traits.woolly === true && isSheared(store.variant[i])) tickRegrow(store, i, world, random, events);
  if (traits.carriesBlocks === true) tickCarry(store, i, world, random, events);
}

function tickLaying(
  store: MobStore, i: number, lays: NonNullable<MobDef['traits']['lays']>,
  random: () => number, events: HusbandryEvents,
): void {
  const interval = (): number =>
    lays.minTicks + Math.floor(random() * (lays.maxTicks - lays.minTicks + 1));
  if (store.product[i] <= 0) {
    store.product[i] = interval();
    return;
  }
  store.product[i]--;
  if (store.product[i] > 0) return;
  const item = ITEM_BY_NAME.get(lays.item);
  if (item !== undefined) events.onDrop(item.id, 1, store.x[i], store.y[i] + 0.3, store.z[i]);
  events.onSound('mob/chicken_ambient', store.x[i], store.y[i], store.z[i]);
  store.product[i] = interval();
}

/** A tosquiada pasta: a grama do pé vira terra e a lã volta. */
function tickRegrow(
  store: MobStore, i: number, world: World, random: () => number, events: HusbandryEvents,
): void {
  if (store.onGround[i] === 0 || random() >= REGROW_CHANCE) return;
  const x = Math.floor(store.x[i]);
  const y = Math.floor(store.y[i] - 0.01);
  const z = Math.floor(store.z[i]);
  const below = world.getBlock(x, y, z);
  if (blockIdOf(below) !== GRASS_BLOCK) return;
  const dirt = makeState(DIRT);
  if (!world.setBlock(x, y, z, dirt, 'physics')) return;
  events.onBlockChanged?.(x, y, z, below, dirt);
  store.variant[i] &= ~SHEARED;
  events.onSound('mob/sheep_ambient', store.x[i], store.y[i], store.z[i]);
}

/**
 * Enderman: de mão vazia, pega um bloco do chão em volta; de mão cheia, põe
 * onde houver ar sobre chão firme. O bloco passa pelo `world.setBlock` como
 * qualquer outro, então o save e a luz o veem.
 */
function tickCarry(
  store: MobStore, i: number, world: World, random: () => number, events: HusbandryEvents,
): void {
  // A chance vem primeiro: quase todo tick não faz nada, e não deve custar nada.
  const carrying = store.carried[i] !== 0;
  if (random() >= (carrying ? PLACE_CHANCE : PICKUP_CHANCE)) return;
  const bx = Math.floor(store.x[i]);
  const by = Math.floor(store.y[i]);
  const bz = Math.floor(store.z[i]);
  const dx = Math.floor(random() * 5) - 2;
  const dz = Math.floor(random() * 5) - 2;
  const dy = Math.floor(random() * 3) - 1;
  const x = bx + dx;
  const y = by + dy;
  const z = bz + dz;

  if (!carrying) {
    const state = world.getBlock(x, y, z);
    if (!CARRIABLE.has(blockIdOf(state))) return;
    if (!world.setBlock(x, y, z, makeState(AIR), 'physics')) return;
    store.carried[i] = state;
    events.onBlockChanged?.(x, y, z, state, makeState(AIR));
    return;
  }
  if (world.getBlock(x, y, z) !== makeState(AIR)) return;
  const floor = defOf(world.getBlock(x, y - 1, z));
  if (!floor.opaque || !floor.solid) return;
  const carried = store.carried[i];
  if (!world.setBlock(x, y, z, carried, 'physics')) return;
  store.carried[i] = 0;
  events.onBlockChanged?.(x, y, z, makeState(AIR), carried);
}
