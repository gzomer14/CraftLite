/**
 * Contêineres com slots: baú, baú duplo, fornalha e mesa de encantamento
 * (doc 08 §3.8–§3.9, doc 14 — M6).
 *
 * A fornalha **continua queimando com a tela fechada** — ela vive no tick do
 * mundo, não na UI. Fechar a interface no meio de uma fundição e voltar depois
 * tem que encontrar o item pronto.
 */

import { ITEM_BY_NAME, itemDef, maxStackOf, type ItemStack } from '../data/items';
import { SMELTING, SMELT_TICKS } from '../data/smelting';
import { TAGS } from '../data/recipes';
import { applyEnchant, createOffers, rollOffers, type EnchantOffer } from './enchanting';

export const CHEST_SLOTS = 27;
export const DOUBLE_CHEST_SLOTS = 54;

/** Slots da fornalha: 0 entrada, 1 combustível, 2 saída. */
export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;

/** Slots da mesa de encantamento: 0 item, 1 lápis-lazúli. */
export const ENCHANT_ITEM = 0;
export const ENCHANT_LAPIS = 1;

export type ContainerKind = 'chest' | 'double_chest' | 'furnace' | 'enchanting';

/**
 * O que a interface precisa enxergar de um contêiner.
 *
 * Existe para o baú duplo: o armazenamento continua sendo **um `Container` por
 * bloco** (é o que mantém o save simples — cada baú guarda o próprio conteúdo
 * na própria posição), e a tela de 54 slots é uma *visão* que encaminha os
 * índices para os dois baús. Sem essa separação, juntar e separar baús viraria
 * cópia de itens de um lado para o outro, com todas as chances de perder coisa
 * no meio.
 */
export interface ContainerView {
  readonly kind: ContainerKind;
  readonly size: number;
  get(index: number): ItemStack | null;
  set(index: number, stack: ItemStack | null): void;
  /** true se `container` é um dos baús por trás desta visão. */
  contains(container: Container): boolean;
}

/** Base de um contêiner com slots. */
export class Container {
  readonly kind: ContainerKind;
  readonly slots: (ItemStack | null)[];
  /** Posição no mundo, para persistir e para fechar ao sair de perto. */
  readonly x: number;
  readonly y: number;
  readonly z: number;

  onChange: (() => void) | null = null;

  /**
   * true = vai para o save **mesmo vazio** (M6).
   *
   * Existe por causa do baú de estrutura: ele nasce cheio a partir da seed, e
   * um baú saqueado até o último item que não fosse salvo voltaria cheio na
   * próxima vez que o chunk entrasse.
   */
  persistent = false;

  constructor(kind: ContainerKind, size: number, x: number, y: number, z: number) {
    this.kind = kind;
    this.slots = new Array<ItemStack | null>(size).fill(null);
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get size(): number {
    return this.slots.length;
  }

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = stack;
    this.onChange?.();
  }

  /** Guarda itens; devolve quanto não coube. `ench` viaja junto (ver `Inventory.give`). */
  give(item: number, count: number, damage = 0, ench = 0): number {
    let remaining = count;
    const max = maxStackOf(item);
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot === null || slot.item !== item || slot.damage !== damage) continue;
      if ((slot.ench ?? 0) !== ench) continue;
      const room = max - slot.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      if (this.slots[i] !== null) continue;
      const moved = Math.min(max, remaining);
      this.slots[i] = { item, count: moved, damage, ench };
      remaining -= moved;
    }
    if (remaining !== count) this.onChange?.();
    return remaining;
  }

  get isEmpty(): boolean {
    return this.slots.every((s) => s === null);
  }

  contains(container: Container): boolean {
    return container === this;
  }
}

/**
 * Baú duplo: 54 slots que na verdade são dois baús de 27.
 *
 * Os índices 0..26 vão para o baú da esquerda e 27..53 para o da direita, que é
 * a mesma convenção do gênero — quebrar um dos dois derruba só a metade dele.
 */
export class DoubleChestView implements ContainerView {
  readonly kind: ContainerKind = 'double_chest';
  readonly first: Container;
  readonly second: Container;

  constructor(first: Container, second: Container) {
    this.first = first;
    this.second = second;
  }

  get size(): number {
    return this.first.size + this.second.size;
  }

  get(index: number): ItemStack | null {
    return index < this.first.size
      ? this.first.get(index)
      : this.second.get(index - this.first.size);
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < this.first.size) this.first.set(index, stack);
    else this.second.set(index - this.first.size, stack);
  }

  contains(container: Container): boolean {
    return container === this.first || container === this.second;
  }
}

/**
 * Fornalha. Três slots e dois contadores; tudo avança no tick do mundo.
 *
 * `burnTicks` é o que resta do combustível aceso, `burnTotal` o que ele valia
 * (é a razão entre os dois que desenha a altura da chama).
 */
export class Furnace extends Container {
  burnTicks = 0;
  burnTotal = 0;
  cookTicks = 0;
  /** XP acumulado, entregue ao retirar a saída (M6). */
  storedXp = 0;

  constructor(x: number, y: number, z: number) {
    super('furnace', 3, x, y, z);
  }

  get isLit(): boolean {
    return this.burnTicks > 0;
  }

  /** 0..1 do progresso da fundição atual. */
  get cookProgress(): number {
    return this.cookTicks / SMELT_TICKS;
  }

  /** 0..1 do combustível restante — altura da chama. */
  get fuelProgress(): number {
    return this.burnTotal === 0 ? 0 : this.burnTicks / this.burnTotal;
  }

  /**
   * Um tick de fornalha. Devolve true se algo mudou (para a UI redesenhar).
   *
   * A ordem importa: consome combustível, depois tenta acender, depois cozinha.
   * Assim um combustível que acabou no mesmo tick ainda conta para este tick.
   */
  tick(): boolean {
    const wasLit = this.isLit;
    const beforeCook = this.cookTicks;

    if (this.burnTicks > 0) this.burnTicks--;

    const output = this.smeltResult();
    const canSmelt = output !== null && this.outputHasRoom(output);

    // Acende se precisa cozinhar e há combustível.
    if (this.burnTicks === 0 && canSmelt) {
      const fuel = this.slots[FURNACE_FUEL];
      const burn = fuel === null ? 0 : (itemDef(fuel.item)?.fuel ?? 0);
      if (fuel !== null && burn > 0) {
        this.burnTicks = burn;
        this.burnTotal = burn;
        fuel.count--;
        if (fuel.count <= 0) {
          // Balde de lava queima e devolve o balde (doc 05 §5).
          const rest = itemDef(fuel.item)?.remainder;
          const restId = rest === undefined ? -1 : ITEM_BY_NAME.get(rest)?.id ?? -1;
          this.slots[FURNACE_FUEL] = restId < 0 ? null : { item: restId, count: 1, damage: 0 };
        }
      }
    }

    if (this.isLit && canSmelt) {
      this.cookTicks++;
      if (this.cookTicks >= SMELT_TICKS) {
        this.finishSmelt(output);
        this.cookTicks = 0;
      }
    } else if (this.cookTicks > 0) {
      // Perder o progresso devagar é menos punitivo que zerar de uma vez.
      this.cookTicks = Math.max(0, this.cookTicks - 2);
    }

    const changed = wasLit !== this.isLit || beforeCook !== this.cookTicks;
    if (changed) this.onChange?.();
    return changed;
  }

  /** O que a entrada atual produz, ou `null`. */
  private smeltResult(): number | null {
    const input = this.slots[FURNACE_INPUT];
    if (input === null) return null;
    return smeltingOutput(input.item);
  }

  private outputHasRoom(output: number): boolean {
    const slot = this.slots[FURNACE_OUTPUT];
    if (slot === null) return true;
    if (slot.item !== output) return false;
    return slot.count < maxStackOf(output);
  }

  private finishSmelt(output: number): void {
    const input = this.slots[FURNACE_INPUT];
    if (input === null) return;
    input.count--;
    if (input.count <= 0) this.slots[FURNACE_INPUT] = null;

    const slot = this.slots[FURNACE_OUTPUT];
    if (slot === null) this.slots[FURNACE_OUTPUT] = { item: output, count: 1, damage: 0 };
    else slot.count++;

    this.storedXp += smeltingXp(input.item);
    this.onChange?.();
  }
}

/** Índice de fundição, resolvido uma vez: item de entrada → saída e XP. */
const smeltingIndex = new Map<number, { output: number; xp: number }>();

function buildSmeltingIndex(): void {
  if (smeltingIndex.size > 0) return;
  for (const recipe of SMELTING) {
    const output = ITEM_BY_NAME.get(recipe.output);
    if (output === undefined) continue;
    const inputs = recipe.input.startsWith('#')
      ? (TAGS[recipe.input.slice(1)] ?? [])
      : [recipe.input];
    for (const name of inputs) {
      const input = ITEM_BY_NAME.get(name);
      if (input !== undefined) smeltingIndex.set(input.id, { output: output.id, xp: recipe.xp });
    }
  }
}

/** Saída da fundição de um item, ou `null` se não funde. */
export function smeltingOutput(item: number): number | null {
  buildSmeltingIndex();
  return smeltingIndex.get(item)?.output ?? null;
}

/** XP que fundir este item rende ao coletar (doc 05 §7). */
export function smeltingXp(item: number): number {
  buildSmeltingIndex();
  return smeltingIndex.get(item)?.xp ?? 0;
}

/** Ticks de queima de um item; 0 se não é combustível. */
export function fuelTicks(item: number): number {
  return itemDef(item)?.fuel ?? 0;
}


/**
 * Mesa de encantamento (doc 14 — M6).
 *
 * **Não é tile entity.** O baú e a fornalha guardam conteúdo entre sessões; a
 * mesa não guarda nada — o item entra, é encantado e sai. Por isso existe uma
 * única instância reusada pela `Session`, posicionada em (0,0,0), em vez de
 * uma por bloco: nada dela vai para o save e não há como esquecer item dentro.
 *
 * `shelves` é preenchido por quem abre a tela, contando as estantes em volta
 * do bloco real; `seed` só muda quando uma oferta é usada, para que abrir e
 * fechar não vire uma máquina de reembaralhar.
 */
export class EnchantTable extends Container {
  shelves = 0;
  seed = 1;
  readonly offers: EnchantOffer[] = createOffers();

  constructor() {
    super('enchanting', 2, 0, 0, 0);
  }

  /** Recalcula as ofertas a partir do que está no slot do item. */
  refresh(): number {
    return rollOffers(this.seed, this.shelves, this.get(ENCHANT_ITEM), this.offers);
  }

  /** Quantos lápis-lazúli estão no slot de pagamento. */
  get lapis(): number {
    const slot = this.get(ENCHANT_LAPIS);
    return slot === null || slot.item !== LAPIS_ITEM ? 0 : slot.count;
  }

  /**
   * Aplica a oferta: grava o encantamento, consome o lápis e reembaralha.
   *
   * **Não cobra os níveis** — quem tem a experiência é a `Session`, e ela já
   * checou antes de chamar. Devolve false se a oferta não existe ou falta
   * lápis.
   */
  apply(slot: number): boolean {
    const offer = this.offers[slot];
    if (offer === undefined || offer.enchant < 0) return false;
    const stack = this.get(ENCHANT_ITEM);
    if (stack === null) return false;
    if (this.lapis < offer.lapis) return false;

    applyEnchant(stack, offer.enchant, offer.level);

    const payment = this.get(ENCHANT_LAPIS);
    if (payment !== null) {
      payment.count -= offer.lapis;
      this.slots[ENCHANT_LAPIS] = payment.count > 0 ? payment : null;
    }

    // Seed nova: as próximas ofertas são outras, como no gênero.
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    this.refresh();
    this.onChange?.();
    return true;
  }
}

const LAPIS_ITEM = ITEM_BY_NAME.get('lapis_lazuli')?.id ?? -1;
