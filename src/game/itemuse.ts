/**
 * Uso de item como dado (doc 14 — M13, primeiro item; 2026-09-22).
 *
 * `Session.useHeld` era uma cadeia de onze `try*` em código, e cada item novo
 * que "faz alguma coisa" seria mais um. Aqui o item declara **qual** ação tem
 * (`use` em `data/items.ts`) e a ação mora num registro, como os goals dos
 * mobs: acrescentar o balde, a tesoura e o ovo não tocou na cadeia.
 *
 * Um uso tem até duas metades: `use`, o clique no mundo, e `onMob`, o clique
 * num bicho. As duas devolvem true quando gastaram o clique.
 *
 * Desde o M13 os usos antigos também moram aqui — comer, arco e escudo,
 * barco, carrinho, isqueiro, enxada e semente —, e a `Session` só percorre a
 * lista de usos do item (`ItemDef.uses`) na ordem da tabela. O que ficou na
 * cadeia dela é o que **não é do item**: montar, cama, circuito, porta,
 * contêiner e bolo são do bloco ou do veículo mirado.
 *
 * Dois tipos de uso:
 * - **clique**: `use` devolve true e a `Session` segura o próximo por
 *   `USE_COOLDOWN` ticks;
 * - **segurar** (`hold`): `use` é chamado a cada tick com o botão apertado, com
 *   `ctx.holdTicks` contando, e `release` recebe a carga ao soltar — comer, o
 *   arco e o escudo.
 */

import {
  AIR, LAVA, WATER, blockIdOf, defOf, makeState,
} from '../data/blocks';
import { DYES } from '../data/dyes';
import { ITEM_BY_NAME, itemDef, type ItemStack, type ItemUse } from '../data/items';
import { mobDef } from '../data/mobs';
import type { Vec3 } from '../core/math';
import { raycast, type RayHit } from '../world/raycast';
import { isSource, makeFluid } from '../world/fluids';
import { FLAG_EGG } from '../entity/projectile';
import { dye, shear, woolColorOf, woolItemOf } from '../entity/husbandry';
import { isRail } from '../world/rails';
import { ignitePortal } from './portal';
import { plantSeed, tillSoil } from './farming';
import { applyFoodEffects } from './food';
import type { Fire } from '../world/fire';
import type { Vehicles } from './vehicles';
import type { Inventory } from './inventory';
import type { Survival } from './survival';
import type { Player } from '../entity/player';
import type { Projectiles } from '../entity/projectile';
import type { MobStore } from '../entity/mobstore';
import type { World } from '../world/world';

/** O que uma ação de item pode tocar. A `Session` monta um; os testes, outro. */
export interface ItemUseContext {
  readonly world: World;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly survival: Survival;
  readonly projectiles: Projectiles;
  readonly mobs: MobStore;
  random(): number;
  /** Um bloco mudou pelo item: luz e fluidos precisam saber. */
  blockChanged(x: number, y: number, z: number, previous: number, state: number): void;
  sound(name: string, x: number, y: number, z: number): void;
  /** Solta itens no mundo, na posição dada. */
  drop(stack: ItemStack, x: number, y: number, z: number): void;
  /** Gasta durabilidade do item na mão. */
  wearHeld(): void;
  readonly vehicles: Vehicles;
  readonly fire: Fire;
  achievement(name: string): void;
  /**
   * O bloco mirado pela interação (o olhar, ou o dedo no Modo A), com planta
   * e fogo mas sem fluido. `null` se nada ao alcance.
   */
  target(): RayHit | null;
  /** Direção da mira, normalizada — para o raio que enxerga fluido e o arremesso. */
  readonly aim: Vec3;
  /** Ticks seguidos com o botão apertado neste item (usos de segurar). */
  holdTicks(): number;
  /** Zera a contagem: terminou de comer, recomeça a próxima mordida. */
  resetHold(): void;
}

/** O contexto sem a parte de segurar, que é do `ItemUser`. */
export type ItemUseBase = Omit<ItemUseContext, 'holdTicks' | 'resetHold'>;

export interface ItemUseHandler {
  /** true = uso de segurar: sem espera entre ticks, com `release` ao soltar. */
  hold?: boolean;
  use?(ctx: ItemUseContext, held: ItemStack): boolean;
  /** Soltou o botão depois de `ticks` segurando. */
  release?(ctx: ItemUseContext, held: ItemStack, ticks: number): void;
  onMob?(ctx: ItemUseContext, held: ItemStack, mob: number): boolean;
}

/** Ticks entre dois usos seguidos segurando o botão (o mesmo ritmo de colocar). */
export const USE_COOLDOWN = 4;
/** Velocidade do arremesso, em blocos por tick. */
const THROW_SPEED = 1.5;
/** Chance de o ovo chocar um pintinho (a do gênero). */
export const EGG_HATCH_CHANCE = 1 / 8;
/** Velocidade e dano da flecha por carga do arco (doc 14 — M6). */
const BOW_MIN_SPEED = 0.6;
const BOW_MAX_SPEED = 2.4;
const BOW_MIN_DAMAGE = 2;
const BOW_MAX_DAMAGE = 9;
/** Abaixo desta fração da carga a flecha "escorrega" da corda e não sai. */
const BOW_MIN_POWER = 0.15;
const ARROW = ITEM_BY_NAME.get('arrow')?.id ?? -1;

function itemIdOf(name: string): number {
  return ITEM_BY_NAME.get(name)?.id ?? -1;
}

/**
 * Troca uma unidade do item na mão por outro item (balde vazio ↔ cheio).
 * No criativo a mão não muda — é a regra de "não gasta item" do doc 06 §9.
 */
function swapHeld(ctx: ItemUseContext, held: ItemStack, next: string): void {
  if (ctx.player.mode === 'creative') return;
  const id = itemIdOf(next);
  if (id < 0) return;
  if (held.count === 1) {
    ctx.inventory.set(ctx.inventory.selected, { item: id, count: 1, damage: 0 });
    return;
  }
  ctx.inventory.consumeHeld();
  const left = ctx.inventory.give(id, 1, 0, 0);
  if (left > 0) ctx.drop({ item: id, count: left, damage: 0 }, ctx.player.x, ctx.player.y + 1, ctx.player.z);
}

/** Raio da mira que **enxerga fluido** — o do balde vazio. */
function fluidRay(ctx: ItemUseContext): RayHit {
  const p = ctx.player;
  return raycast(
    ctx.world, p.x, p.y + p.eyeHeight, p.z, ctx.aim[0], ctx.aim[1], ctx.aim[2], p.reach,
    { fluids: true, replaceable: true },
  );
}

/** Balde vazio: pega a **fonte** de água ou lava mirada, ou o leite da vaca. */
const fillBucket: ItemUseHandler = {
  use(ctx, held) {
    const hit = fluidRay(ctx);
    if (!hit.hit) return false;
    const id = blockIdOf(hit.state);
    if ((id !== WATER && id !== LAVA) || !isSource(hit.state)) return false;
    const { x, y, z } = hit;
    const previous = hit.state;
    if (!ctx.world.setBlock(x, y, z, makeState(AIR), 'player')) return false;
    ctx.blockChanged(x, y, z, previous, makeState(AIR));
    ctx.sound('block/bucket_fill', x + 0.5, y + 0.5, z + 0.5);
    swapHeld(ctx, held, id === WATER ? 'water_bucket' : 'lava_bucket');
    return true;
  },
  onMob(ctx, held, mob) {
    const def = mobDef(ctx.mobs.type[mob]);
    if (def.traits.milkable !== true || ctx.mobs.isBaby(mob)) return false;
    ctx.sound('mob/cow_ambient', ctx.mobs.x[mob], ctx.mobs.y[mob] + 1, ctx.mobs.z[mob]);
    swapHeld(ctx, held, 'milk_bucket');
    return true;
  },
};

/** Balde cheio: despeja uma fonte na célula mirada (ou na da frente dela). */
function pour(fluid: number): ItemUseHandler {
  return {
    use(ctx, held) {
      const hit = ctx.target();
      if (hit === null) return false;
      let { x, y, z } = hit;
      const here = defOf(hit.state);
      // Mirando grama alta ou fogo, o fluido toma o lugar dela; mirando um
      // bloco sólido, vai para a face em que o raio bateu.
      if (!here.replaceable) {
        x += hit.nx; y += hit.ny; z += hit.nz;
      }
      const previous = ctx.world.getBlock(x, y, z);
      const target = defOf(previous);
      if (blockIdOf(previous) !== AIR && !target.replaceable) return false;
      const state = makeFluid(fluid, 0);
      if (!ctx.world.setBlock(x, y, z, state, 'player')) return false;
      ctx.blockChanged(x, y, z, previous, state);
      ctx.sound('block/bucket_empty', x + 0.5, y + 0.5, z + 0.5);
      swapHeld(ctx, held, 'bucket');
      return true;
    },
  };
}

/**
 * Leite: tira todos os efeitos (doc 05 §4 — a cura da Fome da carne podre).
 * **Desvio consciente:** bebe no clique, sem os 1,6 s de beber do gênero — o
 * leite não mata fome, e segurar o botão para nada seria só espera.
 */
const drinkMilk: ItemUseHandler = {
  use(ctx, held) {
    ctx.survival.effects.clear(ctx.survival);
    ctx.sound('player/eat', ctx.player.x, ctx.player.y + 1.5, ctx.player.z);
    swapHeld(ctx, held, 'bucket');
    return true;
  },
};

/** Tesoura na ovelha: 1–3 lãs da cor dela, e a lã volta quando ela pastar. */
const shears: ItemUseHandler = {
  onMob(ctx, _held, mob) {
    const def = mobDef(ctx.mobs.type[mob]);
    const count = shear(ctx.mobs, mob, def, () => ctx.random());
    if (count === 0) return false;
    const wool = woolItemOf(woolColorOf(ctx.mobs.variant[mob]));
    if (wool >= 0) {
      ctx.drop({ item: wool, count, damage: 0 }, ctx.mobs.x[mob], ctx.mobs.y[mob] + 1, ctx.mobs.z[mob]);
    }
    ctx.sound('mob/sheep_hurt', ctx.mobs.x[mob], ctx.mobs.y[mob] + 1, ctx.mobs.z[mob]);
    ctx.wearHeld();
    return true;
  },
};

/** Arremesso: o item sai da mão e vira projétil com o próprio sprite. */
function thrower(flags: number): ItemUseHandler {
  return {
    use(ctx, held) {
      const p = ctx.player;
      const aim = ctx.aim;
      const launched = ctx.projectiles.spawn(
        p.x, p.y + p.eyeHeight - 0.1, p.z, aim[0], aim[1], aim[2], 0, true, THROW_SPEED,
        flags, held.item,
      );
      if (!launched) return false;
      ctx.sound('player/throw', p.x, p.y + p.eyeHeight, p.z);
      if (p.mode === 'survival') ctx.inventory.consumeHeld();
      return true;
    },
  };
}

/** Corante na ovelha: pinta a lã (doc 07 §1, "1 lã (cor)"). */
const dyeSheep: ItemUseHandler = {
  onMob(ctx, held, mob) {
    const name = itemDef(held.item)?.name ?? '';
    const color = DYES.findIndex((d) => `${d.name}_dye` === name);
    if (color < 0) return false;
    if (!dye(ctx.mobs, mob, mobDef(ctx.mobs.type[mob]), color)) return false;
    if (ctx.player.mode === 'survival') ctx.inventory.consumeHeld();
    return true;
  },
};

/**
 * Gasta um do item na mão e devolve o resto (tigela, balde) no lugar, como o
 * gênero faz: o ensopado vira tigela na mesma casinha.
 */
export function consumeWithRemainder(ctx: ItemUseContext, held: ItemStack): void {
  if (ctx.player.mode === 'creative') return;
  const restName = itemDef(held.item)?.remainder;
  const rest = restName === undefined ? -1 : itemIdOf(restName);
  if (rest >= 0 && held.count === 1) {
    ctx.inventory.set(ctx.inventory.selected, { item: rest, count: 1, damage: 0 });
    return;
  }
  ctx.inventory.consumeHeld();
  if (rest >= 0) {
    const left = ctx.inventory.give(rest, 1, 0, 0);
    if (left > 0) ctx.drop({ item: rest, count: left, damage: 0 }, ctx.player.x, ctx.player.y + 1, ctx.player.z);
  }
}

/** Comer: segurar até `eatTicks`, e só com fome — exceto o que é remédio. */
const eat: ItemUseHandler = {
  hold: true,
  use(ctx, held) {
    const food = itemDef(held.item)?.food;
    if (food === undefined) return false;
    if (!ctx.survival.canEat && food.alwaysEdible !== true) return false;
    if (ctx.holdTicks() < food.eatTicks) return true;
    ctx.resetHold();
    ctx.survival.eat(food.hunger, food.saturation);
    applyFoodEffects(ctx.survival, food.effects, () => ctx.random());
    consumeWithRemainder(ctx, held);
    return true;
  },
};

/**
 * Arco e escudo (doc 14 — M6). O arco carrega enquanto o botão está apertado e
 * dispara ao soltar, com a força da carga; o escudo só fica levantado. Arco sem
 * flecha não carrega (no criativo, carrega sempre).
 */
const charge: ItemUseHandler = {
  hold: true,
  use(ctx, held) {
    const def = itemDef(held.item);
    if (def?.charge === 'bow' && ctx.player.mode === 'survival' && ctx.inventory.countOf(ARROW) <= 0) {
      return false;
    }
    return def?.charge !== undefined;
  },
  release(ctx, held, ticks) {
    const def = itemDef(held.item);
    if (def?.charge !== 'bow') return;
    const power = Math.min(1, ticks / (def.chargeTicks ?? 20));
    if (power < BOW_MIN_POWER) return;
    const p = ctx.player;
    if (p.mode === 'survival' && !ctx.inventory.take(ARROW, 1)) return;
    const aim = ctx.aim;
    const speed = BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * power;
    const damage = BOW_MIN_DAMAGE + (BOW_MAX_DAMAGE - BOW_MIN_DAMAGE) * power;
    ctx.projectiles.spawn(
      p.x, p.y + p.eyeHeight, p.z, aim[0] * speed, aim[1] * speed, aim[2] * speed, damage, true,
    );
    ctx.sound('player/arrow', p.x, p.y, p.z);
    ctx.wearHeld();
  },
};

/** Barco na água (ou no chão) mirado. */
const placeBoat: ItemUseHandler = {
  use(ctx) {
    const hit = ctx.target();
    if (hit === null) return false;
    const x = hit.x + hit.nx + 0.5;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz + 0.5;
    if (ctx.vehicles.boats.spawn(x, y, z, ctx.player.yaw) < 0) return false;
    if (ctx.player.mode === 'survival') ctx.inventory.consumeHeld();
    ctx.sound('block/chest', x, y, z);
    return true;
  },
};

/**
 * Carrinho no trilho mirado. Só em trilho: um carrinho no chão não anda e não
 * tem como ser recolhido de volta sem uma regra a mais.
 */
const placeMinecart: ItemUseHandler = {
  use(ctx) {
    const hit = ctx.target();
    if (hit === null || !isRail(hit.state)) return false;
    const x = hit.x + 0.5;
    const z = hit.z + 0.5;
    if (ctx.vehicles.carts.spawn(x, hit.y, z) < 0) return false;
    if (ctx.player.mode === 'survival') ctx.inventory.consumeHeld();
    ctx.sound('block/click', x, hit.y, z);
    return true;
  },
};

/**
 * Isqueiro (M7): na moldura de obsidiana acende o portal; em qualquer outro
 * lugar, fogo. O bloco aceso é o **ar da face clicada**. Falhar não gasta.
 */
const ignite: ItemUseHandler = {
  use(ctx) {
    const hit = ctx.target();
    if (hit === null) return false;
    const x = hit.x + hit.nx;
    const y = hit.y + hit.ny;
    const z = hit.z + hit.nz;
    if (ignitePortal(ctx.world, x, y, z) !== null) {
      ctx.blockChanged(x, y, z, makeState(AIR), ctx.world.getBlock(x, y, z));
      ctx.sound('block/portal', x, y, z);
      ctx.wearHeld();
      ctx.achievement('light_portal');
      return true;
    }
    if (!ctx.fire.ignite(x, y, z)) return false;
    ctx.sound('block/fire', x, y, z);
    ctx.wearHeld();
    return true;
  },
};

/** Enxada: terra e grama viram terra arada. */
const till: ItemUseHandler = {
  use(ctx, held) {
    const hit = ctx.target();
    if (hit === null || !tillSoil(ctx.world, hit.x, hit.y, hit.z, held)) return false;
    ctx.sound('block/dig_gravel', hit.x, hit.y, hit.z);
    ctx.wearHeld();
    return true;
  },
};

/** Semente na terra arada. A cenoura e a batata tentam isto antes de comer. */
const plant: ItemUseHandler = {
  use(ctx, held) {
    const hit = ctx.target();
    if (hit === null || !plantSeed(ctx.world, hit.x, hit.y, hit.z, held)) return false;
    ctx.sound('block/dig_grass', hit.x, hit.y + 1, hit.z);
    if (ctx.player.mode === 'survival') ctx.inventory.consumeHeld();
    return true;
  },
};

export const ITEM_USES: Record<ItemUse, ItemUseHandler> = {
  eat,
  charge,
  place_boat: placeBoat,
  place_minecart: placeMinecart,
  ignite,
  till,
  plant,
  fill_bucket: fillBucket,
  pour_water: pour(WATER),
  pour_lava: pour(LAVA),
  drink_milk: drinkMilk,
  shears,
  throw_egg: thrower(FLAG_EGG),
  throw_snowball: thrower(0),
  dye_sheep: dyeSheep,
};

/** Os usos do item na mão, em ordem de tentativa (vazio se nenhum). */
export function usesOf(held: ItemStack | null): readonly ItemUse[] {
  if (held === null) return NO_USES;
  return itemDef(held.item)?.uses ?? NO_USES;
}

const NO_USES: readonly ItemUse[] = [];
