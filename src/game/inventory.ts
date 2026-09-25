/**
 * Inventário de 46 slots e **todas** as interações de slot do doc 08 §3.5.
 *
 * O doc é explícito: "isso é o que separa um inventário utilizável de um
 * frustrante". Por isso está tudo aqui, incluindo o arrastar-para-distribuir
 * com os dois botões e o duplo clique que junta stacks.
 *
 * Layout dos índices (fixo, vai para o save):
 *   0..8    hotbar
 *   9..35   principal (27)
 *   36..39  armadura (cabeça, peito, pernas, pés)
 *   40      offhand
 *   41..44  grade de craft 2×2
 *   45      resultado do craft
 */

import { itemDef, maxStackOf, type ItemStack } from '../data/items';

export const HOTBAR_START = 0;
export const HOTBAR_END = 9;
export const MAIN_START = 9;
export const MAIN_END = 36;
export const ARMOR_START = 36;
export const ARMOR_END = 40;
export const OFFHAND = 40;
export const CRAFT_START = 41;
export const CRAFT_END = 45;
export const CRAFT_RESULT = 45;
export const INVENTORY_SIZE = 46;

/** Botão usado na interação. */
export type ClickButton = 'left' | 'right' | 'middle';

export interface ClickOptions {
  shift?: boolean;
  /** Tecla 1–9 pressionada com o cursor sobre o slot. */
  hotbarKey?: number;
  /** Modo criativo: pegar do slot não esvazia a fonte. */
  creative?: boolean;
}

/** Uma coleção de slots com regras próprias de shift+clique. */
export interface SlotRange {
  start: number;
  end: number;
}

export class Inventory {
  readonly slots: (ItemStack | null)[];
  /** O que está "na mão do mouse". */
  cursor: ItemStack | null = null;

  /** Slot selecionado da hotbar. */
  selected = 0;

  /** Chamado quando algo muda — a UI escuta para redesenhar. */
  onChange: (() => void) | null = null;

  /** Chamado quando um item deve cair no chão. */
  onDrop: ((stack: ItemStack) => void) | null = null;

  /** Recalcula o slot de resultado; injetado pelo dono (bancada/inventário). */
  refreshResult: (() => void) | null = null;
  /** Consome os ingredientes depois de retirar o resultado. */
  takeResult: (() => void) | null = null;

  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array<ItemStack | null>(size).fill(null);
  }

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  select(index: number): void {
    this.selected = ((index % 9) + 9) % 9;
    this.changed();
  }

  scroll(delta: number): void {
    this.select(this.selected + delta);
  }

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = stack;
    this.changed();
  }

  private changed(): void {
    this.refreshResult?.();
    this.onChange?.();
  }

  // --- interações de slot (doc 08 §3.5) ------------------------------------

  /**
   * Um clique em `index`. Devolve true se algo mudou.
   *
   * O slot de resultado do craft é especial: não se pode soltar nada nele, e
   * pegar de lá consome os ingredientes.
   */
  click(index: number, button: ClickButton, options: ClickOptions = {}): boolean {
    if (index < 0 || index >= this.slots.length) return false;
    // Slot de armadura só aceita a peça do lugar certo: sem isso dá para andar
    // com terra na cabeça e a barra de armadura mente sobre a proteção. Tirar
    // do slot continua valendo — `canPlaceIn` só barra o que está entrando.
    if (options.shift !== true && options.hotbarKey === undefined
      && !this.canPlaceIn(index, this.cursor)) {
      return false;
    }

    if (options.hotbarKey !== undefined) return this.swapWithHotbar(index, options.hotbarKey);
    if (index === CRAFT_RESULT) return this.clickResult(button, options);
    if (options.shift === true) return this.shiftMove(index);

    return button === 'right' ? this.rightClick(index) : this.leftClick(index);
  }

  /** Clique esquerdo: pega tudo, solta tudo, junta ou troca. */
  private leftClick(index: number): boolean {
    const slot = this.slots[index];
    const cursor = this.cursor;

    if (cursor === null) {
      if (slot === null) return false;
      this.cursor = slot;
      this.slots[index] = null;
      this.changed();
      return true;
    }

    if (slot === null) {
      this.slots[index] = cursor;
      this.cursor = null;
      this.changed();
      return true;
    }

    if (slot.item === cursor.item && slot.damage === cursor.damage) {
      const max = maxStackOf(slot.item);
      const room = max - slot.count;
      // Mesmo item e slot cheio: não troca nem move. Trocar aqui seria
      // surpreendente — o jogador clicou querendo juntar, não permutar.
      if (room <= 0) return false;
      const moved = Math.min(room, cursor.count);
      slot.count += moved;
      cursor.count -= moved;
      if (cursor.count <= 0) this.cursor = null;
      this.changed();
      return true;
    }

    return this.swapCursor(index);
  }

  /** Clique direito: pega metade (arredondando para cima) ou solta 1. */
  private rightClick(index: number): boolean {
    const slot = this.slots[index];
    const cursor = this.cursor;

    if (cursor === null) {
      if (slot === null) return false;
      const take = Math.ceil(slot.count / 2);
      // Cópia da pilha inteira (encantamento e nome junto), só com outra
      // quantidade. A cópia à mão perdia o `ench` da espada (corrigido no M15).
      this.cursor = { ...slot, count: take };
      slot.count -= take;
      if (slot.count <= 0) this.slots[index] = null;
      this.changed();
      return true;
    }

    if (slot === null) {
      this.slots[index] = { ...cursor, count: 1 };
      cursor.count--;
      if (cursor.count <= 0) this.cursor = null;
      this.changed();
      return true;
    }

    if (slot.item === cursor.item && slot.damage === cursor.damage) {
      if (slot.count >= maxStackOf(slot.item)) return false;
      slot.count++;
      cursor.count--;
      if (cursor.count <= 0) this.cursor = null;
      this.changed();
      return true;
    }

    return this.swapCursor(index);
  }

  private swapCursor(index: number): boolean {
    const slot = this.slots[index];
    this.slots[index] = this.cursor;
    this.cursor = slot;
    this.changed();
    return true;
  }

  /**
   * Clique no resultado do craft. Só sai item; shift+clique craft em lote,
   * repetindo enquanto a receita continuar válida e couber no inventário.
   */
  private clickResult(button: ClickButton, options: ClickOptions): boolean {
    void button;
    const result = this.slots[CRAFT_RESULT];
    if (result === null) return false;

    if (options.shift === true) {
      let crafted = 0;
      // Trava de segurança: uma receita mal formada não pode travar o frame.
      while (crafted < 1024) {
        const current = this.slots[CRAFT_RESULT];
        if (current === null) break;
        const leftover = this.give(current.item, current.count, current.damage);
        if (leftover > 0) {
          // Não coube: devolve o que sobrou e para.
          this.give(current.item, leftover, current.damage);
          break;
        }
        this.takeResult?.();
        crafted++;
      }
      this.changed();
      return crafted > 0;
    }

    if (this.cursor === null) {
      this.cursor = result;
      this.takeResult?.();
      this.changed();
      return true;
    }
    if (this.cursor.item === result.item && this.cursor.damage === result.damage
      && this.cursor.count + result.count <= maxStackOf(result.item)) {
      this.cursor.count += result.count;
      this.takeResult?.();
      this.changed();
      return true;
    }
    return false;
  }

  /**
   * true se `stack` pode entrar em `index`.
   *
   * A regra vale para os 4 slots de armadura: cada um aceita só a peça do
   * próprio lugar (doc 08 §3.5).
   */
  canPlaceIn(index: number, stack: ItemStack | null): boolean {
    if (stack === null) return true;
    if (index < ARMOR_START || index >= ARMOR_END) return true;
    const armor = itemDef(stack.item)?.armor;
    if (armor === undefined) return false;
    return armorSlotIndex(armor.slot) === index;
  }

  /**
   * Shift+clique: move para o "outro" contêiner.
   * Hotbar ↔ principal; craft e armadura vão para o inventário.
   */
  private shiftMove(index: number): boolean {
    const stack = this.slots[index];
    if (stack === null) return false;

    // Shift+clique numa peça de armadura equipa direto, que é o que o jogador
    // espera — mover para a mochila só se o slot estiver ocupado.
    const armor = itemDef(stack.item)?.armor;
    if (armor !== undefined && (index < ARMOR_START || index >= ARMOR_END)) {
      const slot = armorSlotIndex(armor.slot);
      if (this.slots[slot] === null) {
        this.slots[slot] = stack;
        this.slots[index] = null;
        this.changed();
        return true;
      }
    }

    let target: SlotRange;
    if (index >= HOTBAR_START && index < HOTBAR_END) target = { start: MAIN_START, end: MAIN_END };
    else if (index >= MAIN_START && index < MAIN_END) target = { start: HOTBAR_START, end: HOTBAR_END };
    else target = { start: HOTBAR_START, end: MAIN_END };

    const leftover = this.moveInto(stack, target, index);
    if (leftover === stack.count) return false;
    stack.count = leftover;
    if (stack.count <= 0) this.slots[index] = null;
    this.changed();
    return true;
  }

  /** Empilha em uma faixa; devolve quanto sobrou. */
  private moveInto(stack: ItemStack, range: SlotRange, exclude: number): number {
    let remaining = stack.count;
    const max = maxStackOf(stack.item);

    // Primeiro empilha no que já existe.
    for (let i = range.start; i < range.end && remaining > 0; i++) {
      if (i === exclude) continue;
      const slot = this.slots[i];
      if (slot === null || slot.item !== stack.item || slot.damage !== stack.damage) continue;
      if ((slot.ench ?? 0) !== (stack.ench ?? 0) || slot.name !== stack.name) continue;
      const room = max - slot.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }
    // Depois ocupa slots vazios.
    for (let i = range.start; i < range.end && remaining > 0; i++) {
      if (i === exclude || this.slots[i] !== null) continue;
      const moved = Math.min(max, remaining);
      this.slots[i] = { ...stack, count: moved, ench: stack.ench ?? 0 };
      remaining -= moved;
    }
    return remaining;
  }

  /** Tecla 1–9 com o cursor sobre um slot: troca com aquele slot da hotbar. */
  private swapWithHotbar(index: number, hotbarIndex: number): boolean {
    if (hotbarIndex < 0 || hotbarIndex >= 9) return false;
    if (index === hotbarIndex) return false;
    const a = this.slots[index];
    const b = this.slots[hotbarIndex];
    this.slots[index] = b;
    this.slots[hotbarIndex] = a;
    this.changed();
    return true;
  }

  /**
   * Duplo clique: junta no cursor todos os stacks iguais do inventário,
   * até o limite de empilhamento.
   */
  doubleClick(): boolean {
    const cursor = this.cursor;
    if (cursor === null) return false;
    const max = maxStackOf(cursor.item);
    if (cursor.count >= max) return false;

    // Stacks parciais primeiro: é o que o jogador espera consolidar.
    for (const onlyPartial of [true, false]) {
      for (let i = 0; i < this.slots.length && cursor.count < max; i++) {
        if (i === CRAFT_RESULT) continue;
        const slot = this.slots[i];
        if (slot === null || slot.item !== cursor.item || slot.damage !== cursor.damage) continue;
        if (onlyPartial && slot.count >= max) continue;
        const moved = Math.min(max - cursor.count, slot.count);
        cursor.count += moved;
        slot.count -= moved;
        if (slot.count <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  /**
   * Arrastar por vários slots distribuindo o cursor.
   * Botão esquerdo divide igualmente; direito solta 1 por slot.
   */
  distribute(indices: readonly number[], button: 'left' | 'right'): boolean {
    const cursor = this.cursor;
    if (cursor === null || indices.length === 0) return false;

    const valid: number[] = [];
    for (const index of indices) {
      if (index === CRAFT_RESULT) continue;
      const slot = this.slots[index];
      if (slot === null) { valid.push(index); continue; }
      if (slot.item === cursor.item && slot.damage === cursor.damage
        && slot.count < maxStackOf(cursor.item)) valid.push(index);
    }
    if (valid.length === 0) return false;

    const perSlot = button === 'left'
      ? Math.floor(cursor.count / valid.length)
      : 1;
    if (perSlot <= 0) return false;

    const max = maxStackOf(cursor.item);
    for (const index of valid) {
      if (cursor.count <= 0) break;
      const slot = this.slots[index];
      const room = slot === null ? max : max - slot.count;
      const moved = Math.min(perSlot, room, cursor.count);
      if (moved <= 0) continue;
      if (slot === null) {
        this.slots[index] = { ...cursor, count: moved };
      } else {
        slot.count += moved;
      }
      cursor.count -= moved;
    }
    if (cursor.count <= 0) this.cursor = null;
    this.changed();
    return true;
  }

  /** Q joga 1; Ctrl+Q joga o stack inteiro. */
  dropSelected(whole: boolean): boolean {
    return this.dropFrom(this.selected, whole);
  }

  dropFrom(index: number, whole: boolean): boolean {
    const slot = this.slots[index];
    if (slot === null) return false;
    const count = whole ? slot.count : 1;
    // Jogar fora com Q levava a espada sem o encantamento (corrigido no M15).
    this.onDrop?.({ ...slot, count });
    slot.count -= count;
    if (slot.count <= 0) this.slots[index] = null;
    this.changed();
    return true;
  }

  /** Clicar fora do painel com o cursor cheio joga tudo no chão. */
  dropCursor(): boolean {
    if (this.cursor === null) return false;
    this.onDrop?.(this.cursor);
    this.cursor = null;
    this.changed();
    return true;
  }

  /**
   * Fechar a tela com o cursor cheio **guarda** o que ele segura, e só joga no
   * chão o que não coube — como a grade de criação que volta ao fechar.
   *
   * **Corrige um defeito do M4:** o fechamento chamava `dropCursor`, e as
   * tábuas tiradas do resultado e ainda não postas num slot iam para o chão
   * na frente do jogador. No celular é o caminho natural (tocar no resultado,
   * fechar a mochila), e a dica da primeira hora parava nas tábuas (M17).
   */
  stowCursor(): void {
    const cursor = this.cursor;
    if (cursor === null) return;
    this.cursor = null;
    const leftover = this.giveStack(cursor);
    if (leftover > 0) this.onDrop?.({ ...cursor, count: leftover });
    this.changed();
  }

  // --- utilidades ----------------------------------------------------------

  /**
   * Guarda itens; devolve quanto não coube. Hotbar primeiro, como o original.
   *
   * `ench` viaja junto porque este é o caminho de quem **reconstrói** a pilha a
   * partir dos campos (coletar do chão, shift-clique vindo de um baú): sem ele,
   * guardar uma picareta encantada apagaria o encantamento em silêncio.
   */
  /**
   * Guarda uma pilha inteira — encantamento e nome junto (M15). É o caminho
   * de quem move uma pilha que já existe: recolher do chão, shift-clique, a
   * grade que volta ao fechar. Devolve quanto não coube; a pilha não muda.
   */
  giveStack(stack: ItemStack): number {
    const copy: ItemStack = { ...stack };
    let remaining = this.moveInto(copy, { start: HOTBAR_START, end: HOTBAR_END }, -1);
    if (remaining > 0) {
      copy.count = remaining;
      remaining = this.moveInto(copy, { start: MAIN_START, end: MAIN_END }, -1);
    }
    if (remaining !== stack.count) this.changed();
    return remaining;
  }

  give(item: number, count: number, damage = 0, ench = 0): number {
    const stack: ItemStack = { item, count, damage, ench };
    let remaining = this.moveInto(stack, { start: HOTBAR_START, end: HOTBAR_END }, -1);
    if (remaining > 0) {
      stack.count = remaining;
      remaining = this.moveInto(stack, { start: MAIN_START, end: MAIN_END }, -1);
    }
    if (remaining !== count) this.changed();
    return remaining;
  }

  /** Consome uma unidade do slot ativo. */
  consumeHeld(): void {
    const stack = this.held;
    if (stack === null) return;
    stack.count--;
    if (stack.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /**
   * Gasta durabilidade da ferramenta na mão. Quebra quando acaba.
   * Devolve true se a ferramenta quebrou.
   */
  damageHeld(amount: number, maxDurability: number): boolean {
    const stack = this.held;
    if (stack === null) return false;
    stack.damage += amount;
    if (stack.damage < maxDurability) {
      this.changed();
      return false;
    }
    this.slots[this.selected] = null;
    this.changed();
    return true;
  }

  /**
   * Consome `count` unidades de um item de qualquer slot. Devolve false — sem
   * consumir nada — se não houver o bastante.
   *
   * É o caminho da munição: o arco tira a flecha de onde ela estiver, não do
   * slot da mão.
   */
  take(item: number, count: number): boolean {
    if (this.countOf(item) < count) return false;
    let remaining = count;
    for (let i = HOTBAR_START; i < MAIN_END && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot === null || slot.item !== item) continue;
      const moved = Math.min(slot.count, remaining);
      slot.count -= moved;
      remaining -= moved;
      if (slot.count <= 0) this.slots[i] = null;
    }
    this.changed();
    return true;
  }

  /** Quantos itens deste tipo existem na hotbar + principal. */
  countOf(item: number): number {
    let total = 0;
    for (let i = HOTBAR_START; i < MAIN_END; i++) {
      const slot = this.slots[i];
      if (slot !== null && slot.item === item) total += slot.count;
    }
    return total;
  }

  /** Pick block: seleciona o slot que tem o item, ou põe no slot atual. */
  pickBlock(item: number, creative: boolean): void {
    for (let i = HOTBAR_START; i < HOTBAR_END; i++) {
      if (this.slots[i]?.item === item) { this.select(i); return; }
    }
    for (let i = MAIN_START; i < MAIN_END; i++) {
      if (this.slots[i]?.item === item) {
        const target = this.slots[this.selected];
        this.slots[this.selected] = this.slots[i];
        this.slots[i] = target;
        this.changed();
        return;
      }
    }
    if (creative) {
      this.slots[this.selected] = { item, count: 1, damage: 0 };
      this.changed();
    }
  }

  /** Esvazia tudo — usado na morte (doc 06 §6). */
  dropAll(): ItemStack[] {
    const dropped: ItemStack[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (i === CRAFT_RESULT) continue;
      const slot = this.slots[i];
      if (slot === null) continue;
      dropped.push(slot);
      this.slots[i] = null;
    }
    if (this.cursor !== null) {
      dropped.push(this.cursor);
      this.cursor = null;
    }
    this.changed();
    return dropped;
  }
}

/** Índice do slot de armadura de uma parte do corpo. */
export function armorSlotIndex(slot: 'head' | 'chest' | 'legs' | 'feet'): number {
  if (slot === 'head') return ARMOR_START;
  if (slot === 'chest') return ARMOR_START + 1;
  if (slot === 'legs') return ARMOR_START + 2;
  return ARMOR_START + 3;
}
