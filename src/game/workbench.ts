/**
 * A tela que o jogador tem aberta e o que acontece nela: grade de criação 2×2
 * e 3×3, livro de receitas, fornalha, baú e mesa de encantamento (doc 05 §6,
 * doc 08 §3.5–§3.10).
 *
 * Saiu da `Session` em 2026-09-22 (M13). Os contêineres com posição no mundo
 * estão em `game/tiles.ts`; aqui fica o que só existe enquanto a tela está
 * aberta — e o dever de devolver ao inventário o que ficou na grade.
 */

import type { Stats } from './stats';
import { BLOCK_BY_NAME, blockIdOf, defOf } from '../data/blocks';
import { ITEM_BY_NAME, type ItemStack } from '../data/items';
import {
  ANVIL_LEFT, ANVIL_OUTPUT, ANVIL_RIGHT, Container, EnchantTable, Furnace, ENCHANT_ITEM,
  ENCHANT_LAPIS, type ContainerView,
} from './container';
import { anvilResult, type AnvilOutcome } from './anvil';
import { TOO_EXPENSIVE } from '../data/anvil';
import { consumeGrid, type CraftGrid, type RecipeBook, type RecipeEntry } from './crafting';
import { MAX_BOOKSHELVES, type EnchantOffer } from './enchanting';
import { CRAFT_END, CRAFT_RESULT, CRAFT_START, type Inventory } from './inventory';
import {
  BREWING_STAND, isContainerBlock, isFurnaceBlock, isGridContainer, type Tiles,
} from './tiles';
import type { Achievements } from './achievements';
import type { Experience } from './xp';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

const CRAFTING_TABLE = BLOCK_BY_NAME.get('crafting_table')?.id ?? -1;
const ENCHANTING_TABLE = BLOCK_BY_NAME.get('enchanting_table')?.id ?? -1;
const BOOKSHELF = BLOCK_BY_NAME.get('bookshelf')?.id ?? -1;
const ANVIL = BLOCK_BY_NAME.get('anvil')?.id ?? -1;
const LAPIS = ITEM_BY_NAME.get('lapis_lazuli')?.id ?? -1;
const BOOK = ITEM_BY_NAME.get('book')?.id ?? -1;

/** O que o jogador tem aberto no momento. */
export type OpenScreen =
  | 'none' | 'inventory' | 'crafting' | 'furnace' | 'chest' | 'enchanting' | 'trading'
  | 'anvil' | 'brewing';

/** O que a bancada precisa da sessão. */
export interface WorkbenchHost {
  readonly world: World;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly recipes: RecipeBook;
  readonly tiles: Tiles;
  readonly xp: Experience;
  readonly achievements: Achievements;
  /** Contadores do jogador (M10). */
  readonly stats?: Stats;
  onOpenScreen(screen: OpenScreen, container: ContainerView | null): void;
  sound(name: string, x: number, y: number, z: number): void;
  /** Solta um item que não coube, na frente do jogador. */
  dropItem(stack: ItemStack): void;
  /** Conta um item obtido (conquistas). */
  noteObtained(item: number): void;
  spawnOrb(x: number, y: number, z: number, amount: number): void;
}

export class Workbench {
  openScreen: OpenScreen = 'none';
  openContainer: ContainerView | null = null;
  /** Grade 3×3 da bancada aberta (a 2×2 vive no inventário). */
  readonly bench = new Container('chest', 9, 0, 0, 0);
  /** Mesa de encantamento, uma só e reusada — ver `EnchantTable`. */
  readonly enchantTable = new EnchantTable();
  /**
   * Bigorna (M15): uma só e reusada, como a mesa — não guarda nada entre
   * aberturas. O slot 2 é o resultado, recalculado por `refreshAnvil`.
   */
  readonly anvil = new Container('anvil', 3, 0, 0, 0);
  /** Nome digitado na bigorna; `null` = o campo não foi mexido. */
  anvilName: string | null = null;
  /** O que a bigorna faria agora (resultado, custo, material gasto). */
  readonly anvilOutcome: AnvilOutcome = { result: null, cost: 0, rightUsed: 0 };
  private readonly host: WorkbenchHost;

  constructor(host: WorkbenchHost) {
    this.host = host;
  }

  setScreen(screen: OpenScreen, container: ContainerView | null): void {
    this.openScreen = screen;
    this.openContainer = container;
    this.host.onOpenScreen(screen, container);
  }

  toggleInventory(): void {
    if (this.openScreen === 'none') this.setScreen('inventory', null);
    else this.closeScreen();
  }

  closeScreen(): void {
    if (this.openScreen === 'none') return;
    // Devolve o que estiver na grade de craft, senão os itens somem.
    this.returnCraftGrid();
    this.host.tiles.closeLids();
    this.setScreen('none', null);
  }

  /** Um contêiner saiu do mundo: se era o da tela aberta, a tela fecha. */
  onContainerRemoved(container: Container): void {
    if (this.openContainer?.contains(container) === true) this.closeScreen();
  }

  /** Abre a tela do bloco mirado, se ele tiver uma. Devolve true se abriu. */
  open(x: number, y: number, z: number): boolean {
    const id = blockIdOf(this.host.world.getBlock(x, y, z));
    if (id === CRAFTING_TABLE) {
      for (let i = 0; i < this.bench.size; i++) this.bench.set(i, null);
      this.setScreen('crafting', this.bench);
      return true;
    }
    if (id === ANVIL) {
      this.anvilName = null;
      this.refreshAnvil();
      this.setScreen('anvil', this.anvil);
      return true;
    }
    if (id === ENCHANTING_TABLE) {
      this.enchantTable.shelves = this.countBookshelves(x, y, z);
      this.enchantTable.refresh();
      this.setScreen('enchanting', this.enchantTable);
      return true;
    }
    if (!isContainerBlock(id)) return false;
    const tiles = this.host.tiles;
    const container = tiles.atOrCreate(x, y, z, id);
    if (isFurnaceBlock(id)) {
      this.setScreen('furnace', container);
      return true;
    }
    // Suporte de preparo (M16): a tela própria, com a barra de fervura.
    if (id === BREWING_STAND) {
      this.setScreen('brewing', container);
      return true;
    }
    // Funil, dispensador e liberador: a grade simples, sem tampa (M15).
    if (isGridContainer(id)) {
      this.setScreen('chest', container);
      return true;
    }
    // Baú colado em outro baú abre os dois de uma vez (doc 08 §3.9).
    const neighbor = tiles.findDoubleChest(x, y, z);
    this.setScreen('chest', neighbor === null ? container : neighbor);
    tiles.openLid(x, y, z);
    return true;
  }

  // --- grade de criação ------------------------------------------------------

  /** Grade ativa: 3×3 da bancada, ou 2×2 do inventário. */
  private currentGrid(): CraftGrid {
    if (this.openScreen === 'crafting') return { size: 3, slots: this.bench.slots };
    const inv = this.host.inventory;
    return {
      size: 2,
      slots: [
        inv.get(CRAFT_START), inv.get(CRAFT_START + 1),
        inv.get(CRAFT_START + 2), inv.get(CRAFT_START + 3),
      ],
    };
  }

  /** Recalcula o slot de resultado a partir da grade ativa. */
  refreshCraftResult(): void {
    this.host.inventory.slots[CRAFT_RESULT] = this.host.recipes.match(this.currentGrid());
  }

  /** Consome os ingredientes depois de retirar o resultado. */
  consumeCraft(): void {
    const inv = this.host.inventory;
    const crafted = inv.get(CRAFT_RESULT);
    if (crafted !== null) {
      this.host.noteObtained(crafted.item);
      this.host.stats?.add('items_crafted', crafted.count);
    }
    const grid = this.currentGrid();
    consumeGrid(grid);
    if (this.openScreen === 'crafting') {
      for (let i = 0; i < 9; i++) this.bench.set(i, grid.slots[i]);
    } else {
      for (let i = 0; i < 4; i++) inv.slots[CRAFT_START + i] = grid.slots[i];
    }
    this.refreshCraftResult();
  }

  /**
   * Preenche a grade aberta com uma receita do livro (doc 05 §6.4).
   *
   * Devolve o que já estava na grade antes, tira **uma** unidade de cada
   * ingrediente do inventário e põe na célula certa. Se faltar ingrediente,
   * desfaz tudo: meia receita na grade é pior que receita nenhuma.
   */
  autoFillRecipe(entry: RecipeEntry): boolean {
    const grid = this.currentGrid();
    const size = grid.size;
    if (entry.width > size || entry.height > size) return false;

    // O que o jogador segura no cursor conta como dele: as tábuas recém-tiradas
    // do resultado precisam estar na mochila para a bancada achá-las.
    this.host.inventory.stowCursor();
    this.returnCraftGrid();
    const taken: number[] = [];
    for (let row = 0; row < entry.height; row++) {
      for (let column = 0; column < entry.width; column++) {
        const candidates = entry.cells[row * entry.width + column];
        if (candidates === null || candidates === undefined) continue;
        const item = this.takeOneOf(candidates);
        if (item < 0) {
          for (const back of taken) this.host.inventory.give(back, 1);
          this.returnCraftGrid();
          return false;
        }
        taken.push(item);
        this.setGridSlot(grid, row * size + column, { item, count: 1, damage: 0 });
      }
    }
    this.refreshCraftResult();
    return true;
  }

  /** Tira uma unidade do primeiro candidato que existir no inventário. */
  private takeOneOf(candidates: readonly number[]): number {
    const inv = this.host.inventory;
    for (const item of candidates) {
      for (let i = 0; i < CRAFT_START; i++) {
        const stack = inv.get(i);
        if (stack === null || stack.item !== item || stack.damage !== 0) continue;
        stack.count--;
        if (stack.count <= 0) inv.set(i, null);
        return item;
      }
    }
    return -1;
  }

  /** Escreve numa célula da grade ativa (bancada ou inventário). */
  private setGridSlot(grid: CraftGrid, index: number, stack: ItemStack): void {
    if (this.openScreen === 'crafting') this.bench.set(index, stack);
    else this.host.inventory.slots[CRAFT_START + index] = stack;
    grid.slots[index] = stack;
  }

  /** Devolve os ingredientes da grade ao inventário ao fechar. */
  private returnCraftGrid(): void {
    const inv = this.host.inventory;
    for (let i = CRAFT_START; i < CRAFT_END; i++) {
      const stack = inv.get(i);
      if (stack === null) continue;
      const leftover = inv.giveStack(stack);
      inv.set(i, null);
      if (leftover > 0) this.host.dropItem({ ...stack, count: leftover });
    }
    this.returnGrid(this.bench);
    this.returnGrid(this.enchantTable);
    // O resultado da bigorna não é item de ninguém: some antes de devolver.
    this.anvil.slots[ANVIL_OUTPUT] = null;
    this.returnGrid(this.anvil);
    inv.set(CRAFT_RESULT, null);
  }

  /** Esvazia um contêiner temporário de volta para o inventário, ou no chão. */
  private returnGrid(container: Container): void {
    const inv = this.host.inventory;
    for (let i = 0; i < container.size; i++) {
      const stack = container.get(i);
      if (stack === null) continue;
      const leftover = inv.giveStack(stack);
      container.set(i, null);
      if (leftover > 0) this.host.dropItem({ ...stack, count: leftover });
    }
  }

  // --- encantamento (doc 14 — M6) --------------------------------------------

  /**
   * Estantes que contam para a mesa: as que estão a 2 blocos de distância, no
   * mesmo nível ou um acima, **com o caminho livre**.
   *
   * O bloco intermediário precisa ser transparente porque é isso que faz a
   * biblioteca ter formato: emparedar a mesa não vale como sala de estudo.
   */
  countBookshelves(x: number, y: number, z: number): number {
    const world = this.host.world;
    let count = 0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          // Só o anel externo: o que está colado na mesa não conta.
          if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
          if (blockIdOf(world.getBlock(x + dx, y + dy, z + dz)) !== BOOKSHELF) continue;
          // Caminho livre: o bloco no meio do caminho não pode ser sólido.
          const mx = x + (dx === 0 ? 0 : Math.sign(dx));
          const mz = z + (dz === 0 ? 0 : Math.sign(dz));
          if (defOf(world.getBlock(mx, y + dy, mz)).opaque) continue;
          count++;
          if (count >= MAX_BOOKSHELVES) return MAX_BOOKSHELVES;
        }
      }
    }
    return count;
  }

  /** As três ofertas da mesa aberta, para a UI desenhar. */
  get enchantOffers(): readonly EnchantOffer[] {
    return this.enchantTable.offers;
  }

  /** Estantes contadas na última abertura da mesa. */
  get enchantShelves(): number {
    return this.enchantTable.shelves;
  }

  /**
   * Compra a oferta `slot` da mesa aberta.
   *
   * Devolve o motivo de ter falhado, para a UI dizer o que faltou — silêncio
   * num botão que não funciona é o pior retorno possível.
   */
  buyEnchant(slot: number): 'ok' | 'no-offer' | 'no-level' | 'no-lapis' {
    if (this.openScreen !== 'enchanting') return 'no-offer';
    const table = this.enchantTable;
    const offer = table.offers[slot];
    if (offer === undefined || offer.enchant < 0) return 'no-offer';

    const { player, xp } = this.host;
    const creative = player.mode === 'creative';
    if (!creative && table.lapis < offer.lapis) return 'no-lapis';
    if (!creative && !xp.canAfford(offer.cost)) return 'no-level';

    // Pilha de livros: um só vira livro encantado, o resto volta (M15).
    const item = table.get(ENCHANT_ITEM);
    if (item !== null && item.item === BOOK && item.count > 1) {
      const rest = { ...item, count: item.count - 1 };
      item.count = 1;
      const left = this.host.inventory.giveStack(rest);
      if (left > 0) this.host.dropItem({ ...rest, count: left });
    }

    // No criativo a mesa também precisa do lápis? Não: criativo não paga nada,
    // mas a oferta ainda tem que existir e o item tem que estar lá.
    if (creative) {
      if (table.get(ENCHANT_ITEM) === null) return 'no-offer';
      table.slots[ENCHANT_LAPIS] = { item: LAPIS, count: offer.lapis, damage: 0 };
    }

    if (!table.apply(slot)) return 'no-offer';
    if (!creative) xp.spend(offer.cost);
    this.host.sound('ui/enchant', player.x, player.y, player.z);
    this.host.achievements.event('enchant');
    return 'ok';
  }

  /** Chamado pela UI ao mexer nos slots da mesa: as ofertas dependem do item. */
  refreshEnchantOffers(): void {
    this.enchantTable.refresh();
  }

  // --- bigorna (M15) ---------------------------------------------------------

  /** Recalcula o slot de resultado da bigorna a partir dos outros dois e do nome. */
  refreshAnvil(): void {
    const outcome = anvilResult(
      this.anvil.get(ANVIL_LEFT), this.anvil.get(ANVIL_RIGHT), this.anvilName, this.anvilOutcome,
    );
    this.anvil.slots[ANVIL_OUTPUT] = outcome.result;
  }

  /** Por que o resultado da bigorna não pode sair agora, ou `'ok'`. */
  anvilBlocker(): 'ok' | 'nothing' | 'expensive' | 'no-level' {
    const outcome = this.anvilOutcome;
    if (outcome.result === null) return 'nothing';
    if (this.host.player.mode === 'creative') return 'ok';
    if (outcome.cost >= TOO_EXPENSIVE) return 'expensive';
    if (!this.host.xp.canAfford(outcome.cost)) return 'no-level';
    return 'ok';
  }

  /**
   * O jogador tirou o resultado: cobra os níveis, gasta a peça e o material e
   * devolve a peça nova — quem chama a põe no cursor. `null` se não pode.
   */
  takeAnvilResult(): ItemStack | null {
    this.refreshAnvil();
    if (this.anvilBlocker() !== 'ok') return null;
    const outcome = this.anvilOutcome;
    const result = outcome.result;
    if (result === null) return null;

    const right = this.anvil.get(ANVIL_RIGHT);
    if (right !== null && outcome.rightUsed > 0) {
      right.count -= outcome.rightUsed;
      this.anvil.slots[ANVIL_RIGHT] = right.count > 0 ? right : null;
    }
    this.anvil.slots[ANVIL_LEFT] = null;
    const { player, xp } = this.host;
    if (player.mode !== 'creative') xp.spend(outcome.cost);
    this.host.sound('village/anvil', player.x, player.y, player.z);
    this.host.noteObtained(result.item);
    this.anvilName = null;
    this.refreshAnvil();
    return result;
  }

  /**
   * Entrega a experiência acumulada por uma fornalha (doc 05 §7).
   * Chamado pela UI quando o jogador tira o item do slot de saída.
   */
  collectFurnaceXp(furnace: Furnace, item = -1): void {
    if (item >= 0) this.host.noteObtained(item);
    const amount = Math.floor(furnace.storedXp);
    if (amount <= 0) return;
    furnace.storedXp -= amount;
    this.host.spawnOrb(furnace.x + 0.5, furnace.y + 1, furnace.z + 0.5, amount);
  }
}
