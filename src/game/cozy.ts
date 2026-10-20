/**
 * O clique nos blocos de casa do M26: fogueira, caldeirão, vaso e moldura de
 * item. É a mesma metade do clique de `game/blockuse.ts` — o bloco mirado
 * responde, com o que estiver na mão —, num módulo à parte pelo tamanho.
 *
 * O que cada bloco aceita é dado (`data/cozy.ts`: as plantas do vaso, a
 * fogueira assa o que a fornalha assa); aqui fica a regra do gesto:
 *
 * - **fogueira acesa:** comida crua na mão vai para cima dela (uma por
 *   clique); balde de água ou pá apagam. **Apagada:** o isqueiro acende.
 * - **caldeirão:** balde de água enche; balde vazio esvazia o cheio; frasco
 *   tira um nível e vira frasco d'água; frasco d'água devolve um nível.
 *   **Desvio consciente:** quem entra pegando fogo apaga sem gastar água, e a
 *   chuva não enche o caldeirão — os dois pediriam o caldeirão no tick do
 *   mundo, e ele hoje só existe no clique.
 * - **vaso:** planta da tabela na mão entra; vaso com planta devolve a planta.
 * - **moldura:** vazia, recebe um do item da mão; com item, o item sai.
 *   **Desvio consciente:** no gênero, o item sai com um soco e o clique gira
 *   o item. Aqui o soco quebra a moldura (dureza 0, solta os dois) e o clique
 *   devolve o item — no toque, os dois gestos de dedo já existem, e girar um
 *   item que é desenhado de frente não mudaria nada na tela.
 *
 * E o machado descasca o tronco (`stripLog`), um uso de **item** que mora aqui
 * por ser do mesmo marco; o registro dele é `ITEM_USES`, como todos.
 */

import { BLOCK_BY_NAME, blockIdOf, defOf, makeState, stateBitsOf } from '../data/blocks';
import { CAULDRON_LEVELS, POTTABLE, STRIPPED } from '../data/cozy';
import { ITEM_BY_NAME, itemDef, type ItemStack } from '../data/items';
import { cauldronLevel } from '../world/mesh/cozyshape';
import { CAMPFIRE, CAMPFIRE_OFF, ITEM_FRAME, type Tiles } from './tiles';
import { Campfire, campfireResult } from './campfire';
import { swapHeld, type HandContext } from './itemhelpers';
import type { ItemUseHandler } from './itemuse';
import type { Inventory } from './inventory';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

const CAULDRON = BLOCK_BY_NAME.get('cauldron')?.id ?? -1;
const FLOWER_POT = BLOCK_BY_NAME.get('flower_pot')?.id ?? -1;

const itemOf = (name: string): number => ITEM_BY_NAME.get(name)?.id ?? -1;
const BUCKET = itemOf('bucket');
const WATER_BUCKET = itemOf('water_bucket');
const GLASS_BOTTLE = itemOf('glass_bottle');
const WATER_BOTTLE = itemOf('water_bottle');

/** Planta da mão → estado do vaso (posição em `POTTABLE` + 1). */
const POT_STATE = new Map<number, number>(
  POTTABLE.map((name, i) => [itemOf(name), i + 1]),
);

export interface CozyHost extends HandContext {
  readonly world: World;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly tiles: Tiles;
  /** Um bloco mudou pelo clique: luz e vizinhos precisam saber. */
  changed(x: number, y: number, z: number, previous: number, state: number): void;
  sound(name: string, x: number, y: number, z: number): void;
  /** Gasta durabilidade do item na mão. */
  wearHeld(): void;
}

export class CozyBlocks {
  private readonly host: CozyHost;
  /**
   * true no convidado de uma sala (M20): a comida da fogueira e o item da
   * moldura moram em tile entity, e tile entity desses dois não viaja pela
   * rede. O clique é engolido sem efeito — melhor que o item sumir da mão do
   * convidado e nunca chegar ao anfitrião. Ver doc 15 §5 (M30).
   */
  remoteTiles = false;

  constructor(host: CozyHost) {
    this.host = host;
  }

  /** O bloco mirado é de casa e respondeu ao clique. */
  use(x: number, y: number, z: number): boolean {
    const state = this.host.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    const held = this.host.inventory.held;
    if (id === CAMPFIRE || id === CAMPFIRE_OFF) return this.campfire(x, y, z, state, held);
    if (id === CAULDRON) return this.cauldron(x, y, z, state, held);
    if (id === FLOWER_POT) return this.pot(x, y, z, state, held);
    if (id === ITEM_FRAME) return this.frame(x, y, z, held);
    return false;
  }

  private campfire(x: number, y: number, z: number, state: number, held: ItemStack | null): boolean {
    const host = this.host;
    if (held === null) return false;
    const lit = blockIdOf(state) === CAMPFIRE;
    const def = itemDef(held.item);
    if (!lit) {
      if (def?.lights !== true) return false;
      this.setBlock(x, y, z, state, makeState(CAMPFIRE));
      host.sound('block/fire', x + 0.5, y + 0.5, z + 0.5);
      host.wearHeld();
      return true;
    }
    if (held.item === WATER_BUCKET || def?.tool?.kind === 'shovel') {
      this.setBlock(x, y, z, state, makeState(CAMPFIRE_OFF));
      host.sound('block/evaporate', x + 0.5, y + 0.5, z + 0.5);
      if (held.item === WATER_BUCKET) swapHeld(host, held, 'bucket');
      else host.wearHeld();
      return true;
    }
    if (campfireResult(held.item) < 0) return false;
    if (this.remoteTiles) return true;
    const tile = host.tiles.atOrCreate(x, y, z, CAMPFIRE);
    if (!(tile instanceof Campfire) || !tile.place(held.item)) return false;
    if (host.player.mode === 'survival') host.inventory.consumeHeld();
    host.sound('place/generic', x + 0.5, y + 0.5, z + 0.5);
    return true;
  }

  private cauldron(x: number, y: number, z: number, state: number, held: ItemStack | null): boolean {
    const host = this.host;
    if (held === null) return false;
    const level = cauldronLevel(stateBitsOf(state));
    let next = -1;
    let swap = '';
    let sound = 'block/bucket_empty';
    if (held.item === WATER_BUCKET && level < CAULDRON_LEVELS) {
      next = CAULDRON_LEVELS; swap = 'bucket';
    } else if (held.item === BUCKET && level === CAULDRON_LEVELS) {
      next = 0; swap = 'water_bucket'; sound = 'block/bucket_fill';
    } else if (held.item === GLASS_BOTTLE && level > 0) {
      next = level - 1; swap = 'water_bottle'; sound = 'block/bucket_fill';
    } else if (held.item === WATER_BOTTLE && level < CAULDRON_LEVELS) {
      next = level + 1; swap = 'glass_bottle';
    }
    if (next < 0) return false;
    this.setBlock(x, y, z, state, makeState(CAULDRON, next));
    swapHeld(host, held, swap);
    host.sound(sound, x + 0.5, y + 0.5, z + 0.5);
    return true;
  }

  private pot(x: number, y: number, z: number, state: number, held: ItemStack | null): boolean {
    const host = this.host;
    const planted = stateBitsOf(state) & 15;
    if (planted > 0) {
      // Vaso com planta: a planta volta para a mão (ou para o chão, sem lugar).
      const item = itemOf(POTTABLE[planted - 1]);
      this.setBlock(x, y, z, state, makeState(FLOWER_POT));
      if (item >= 0 && host.player.mode === 'survival') this.give(item, x, y, z);
      host.sound('place/generic', x + 0.5, y + 0.5, z + 0.5);
      return true;
    }
    const plant = held === null ? undefined : POT_STATE.get(held.item);
    if (plant === undefined) return false;
    this.setBlock(x, y, z, state, makeState(FLOWER_POT, plant));
    if (host.player.mode === 'survival') host.inventory.consumeHeld();
    host.sound('place/generic', x + 0.5, y + 0.5, z + 0.5);
    return true;
  }

  private frame(x: number, y: number, z: number, held: ItemStack | null): boolean {
    const host = this.host;
    if (this.remoteTiles) return true;
    const tile = host.tiles.atOrCreate(x, y, z, ITEM_FRAME);
    const shown = tile.get(0);
    if (shown !== null) {
      tile.set(0, null);
      this.give(shown, x, y, z);
      host.sound('place/generic', x + 0.5, y + 0.5, z + 0.5);
      return true;
    }
    if (held === null) return false;
    tile.set(0, { ...held, count: 1 });
    if (host.player.mode === 'survival') host.inventory.consumeHeld();
    host.sound('place/generic', x + 0.5, y + 0.5, z + 0.5);
    return true;
  }

  private setBlock(x: number, y: number, z: number, previous: number, state: number): void {
    if (this.host.world.setBlock(x, y, z, state, 'player')) this.host.changed(x, y, z, previous, state);
  }

  /** Uma pilha (ou um item) para a mochila; o que não couber cai no chão. */
  private give(what: ItemStack | number, x: number, y: number, z: number): void {
    const stack = typeof what === 'number' ? { item: what, count: 1, damage: 0 } : what;
    const left = this.host.inventory.give(stack.item, stack.count, stack.damage, stack.ench ?? 0);
    if (left > 0) this.host.drop({ ...stack, count: left }, x + 0.5, y + 0.5, z + 0.5);
  }
}

/** Machado no tronco (M26): vira o tronco descascado, no mesmo eixo. */
export const stripLog: ItemUseHandler = {
  use(ctx) {
    const hit = ctx.target();
    if (hit === null) return false;
    const stripped = STRIPPED[defOf(hit.state).name];
    const next = stripped === undefined ? undefined : BLOCK_BY_NAME.get(stripped);
    if (next === undefined) return false;
    const state = makeState(next.id, stateBitsOf(hit.state));
    if (!ctx.world.setBlock(hit.x, hit.y, hit.z, state, 'player')) return false;
    ctx.blockChanged(hit.x, hit.y, hit.z, hit.state, state);
    ctx.sound('break/wood', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    ctx.wearHeld();
    return true;
  },
};

/**
 * true se a célula é um caldeirão com água (M26): apaga quem está pegando
 * fogo, como a água do rio. Quem chama é o tick de sobrevivência, com o bloco
 * dos pés.
 */
export function isWetCauldron(state: number): boolean {
  return blockIdOf(state) === CAULDRON && cauldronLevel(stateBitsOf(state)) > 0;
}

/** Item que a planta do vaso devolve ao quebrar (M26), ou `null` com o vaso vazio. */
export function potContentsOf(state: number): string | null {
  if (blockIdOf(state) !== FLOWER_POT) return null;
  const planted = stateBitsOf(state) & 15;
  return planted > 0 ? POTTABLE[planted - 1] ?? null : null;
}
