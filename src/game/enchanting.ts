/**
 * Encantamento: como o encantamento vive na pilha, como a mesa sorteia as três
 * ofertas e o que cada efeito vale (doc 14 — M6).
 *
 * **Onde mora o encantamento.** Numa pilha ele é um único número inteiro, o
 * campo `ench`: 3 bits por encantamento, indexados pelo id da tabela
 * (`data/enchants.ts`). Oito encantamentos cabem em 24 bits, o save ganha um
 * inteiro por slot e comparar duas pilhas continua sendo comparar números —
 * nada de objeto por item, que é o que estouraria o orçamento de GC do M2.
 *
 * **Por que os efeitos ficam aqui e não em quem os aplica.** A regra é sempre
 * "número que entra, número que sai": `Interaction` pergunta a velocidade,
 * `Survival` pergunta o dano reduzido, `drops` pergunta a quantidade. Fórmula
 * separada de quem a usa é fórmula testável sem mundo, sem GL e sem DOM.
 */

import {
  CONFLICTS, ENCHANTS, enchantDef, fitsItem, isEnchantable, MAX_ENCHANT_LEVEL,
  FEATHER_FALLING, PROTECTION, UNBREAKING,
} from '../data/enchants';
import { hash3 } from '../core/rng';
import type { ItemStack } from '../data/items';

/** Bits por encantamento no campo `ench`. */
const BITS = 3;
const MASK = 7;

/** Nível de um encantamento numa máscara. 0 = não tem. */
export function levelIn(ench: number, enchant: number): number {
  return (ench >>> (enchant * BITS)) & MASK;
}

/** Nível de um encantamento numa pilha (aceita `null` para simplificar quem chama). */
export function levelOf(stack: ItemStack | null, enchant: number): number {
  if (stack === null || stack.ench === undefined) return 0;
  return levelIn(stack.ench, enchant);
}

/** Máscara com o encantamento gravado no nível dado. */
export function withEnchant(ench: number, enchant: number, level: number): number {
  const clamped = Math.max(0, Math.min(MAX_ENCHANT_LEVEL, Math.floor(level)));
  const shift = enchant * BITS;
  return (ench & ~(MASK << shift)) | (clamped << shift);
}

/** Quantos encantamentos distintos a máscara carrega. */
export function enchantCount(ench: number): number {
  let count = 0;
  for (let i = 0; i < ENCHANTS.length; i++) if (levelIn(ench, i) > 0) count++;
  return count;
}

/**
 * true se dá para gravar este encantamento nesta pilha: cabe no item, não
 * conflita com o que já está lá e ainda não está no teto.
 */
export function canApply(stack: ItemStack, enchant: number): boolean {
  const def = enchantDef(enchant);
  if (def === undefined) return false;
  if (!fitsItem(enchant, stack.item)) return false;
  const ench = stack.ench ?? 0;
  if (levelIn(ench, enchant) >= def.maxLevel) return false;
  for (const other of CONFLICTS[enchant]) {
    if (levelIn(ench, other) > 0) return false;
  }
  return true;
}

/** Grava o encantamento na pilha, respeitando o teto da tabela. */
export function applyEnchant(stack: ItemStack, enchant: number, level: number): void {
  const def = enchantDef(enchant);
  if (def === undefined) return;
  stack.ench = withEnchant(stack.ench ?? 0, enchant, Math.min(level, def.maxLevel));
}

/** Texto do tooltip: "Eficiência III", uma linha por encantamento. */
export function describeEnchants(ench: number): string {
  let out = '';
  for (let i = 0; i < ENCHANTS.length; i++) {
    const level = levelIn(ench, i);
    if (level === 0) continue;
    const def = enchantDef(i);
    if (def === undefined) continue;
    out += `${out === '' ? '' : '\n'}${def.display}${def.maxLevel > 1 ? ` ${roman(level)}` : ''}`;
  }
  return out;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function roman(level: number): string {
  return ROMAN[level] ?? String(level);
}

// --- a mesa ---------------------------------------------------------------

/** Máximo de estantes que contam em volta da mesa. */
export const MAX_BOOKSHELVES = 15;
/** Quantas ofertas a mesa mostra. */
export const OFFER_COUNT = 3;
/** Nível mais alto que a oferta de baixo pode pedir, com 15 estantes. */
export const MAX_OFFER_COST = 30;

export interface EnchantOffer {
  /** Id do encantamento, ou −1 se não há oferta neste slot. */
  enchant: number;
  level: number;
  /** Níveis de experiência que a oferta custa. */
  cost: number;
  /** Lápis-lazúli consumido (1, 2 ou 3, igual ao índice + 1). */
  lapis: number;
}

/** Ofertas reusadas — a mesa reescreve estes três objetos, nunca aloca. */
export function createOffers(): EnchantOffer[] {
  const out: EnchantOffer[] = [];
  for (let i = 0; i < OFFER_COUNT; i++) out.push({ enchant: -1, level: 0, cost: 0, lapis: i + 1 });
  return out;
}

/**
 * Custo em níveis de cada slot, em função das estantes em volta.
 *
 * Com 15 estantes o slot de baixo pede 30 níveis, que é o teto do gênero; sem
 * estante nenhuma a mesa ainda funciona, só que oferece pouco — é o que faz
 * valer a pena construir a biblioteca.
 */
export function offerCost(slot: number, shelves: number): number {
  const power = Math.max(0, Math.min(MAX_BOOKSHELVES, Math.floor(shelves)));
  if (slot === 0) return Math.max(1, Math.floor(power / 3) + 1);
  if (slot === 1) return Math.max(2, Math.floor((power * 2) / 3) + 2);
  return Math.max(3, power * 2);
}

/**
 * Sorteia as três ofertas para uma pilha.
 *
 * Determinístico a partir de `seed` (a mesa guarda o seu e só o troca quando
 * uma oferta é usada): abrir e fechar a tela não reembaralha nada, que é o que
 * evita o jogador ficar clicando até sair Fortuna III.
 *
 * O sorteio já respeita `canApply`, então uma picareta que **já tem** Fortuna
 * III nunca recebe uma oferta de Fortuna nem de Toque Suave — a oferta que
 * aparece é sempre uma oferta que funciona.
 *
 * Devolve quantas ofertas ficaram válidas — 0 quando o item não é encantável.
 */
export function rollOffers(
  seed: number, shelves: number, stack: ItemStack | null, out: EnchantOffer[],
): number {
  for (const offer of out) { offer.enchant = -1; offer.level = 0; offer.cost = 0; }
  if (stack === null || !isEnchantable(stack.item)) return 0;

  let valid = 0;
  for (let slot = 0; slot < out.length; slot++) {
    const cost = offerCost(slot, shelves);
    const enchant = pickEnchant(seed, slot, stack);
    if (enchant < 0) continue;
    const def = enchantDef(enchant);
    if (def === undefined) continue;

    // O nível cresce com o custo: a oferta barata quase sempre sai nível 1.
    const scaled = Math.round((cost / MAX_OFFER_COST) * def.maxLevel);
    out[slot].enchant = enchant;
    out[slot].level = Math.max(1, Math.min(def.maxLevel, scaled));
    out[slot].cost = cost;
    valid++;
  }
  return valid;
}

/** Sal do sorteio da mesa, para não colidir com o dos drops nem o do terreno. */
const ENCHANT_SALT = 0x3e14;

/** Sorteio por peso entre os encantamentos que ainda cabem na pilha. */
function pickEnchant(seed: number, slot: number, stack: ItemStack): number {
  let total = 0;
  for (const def of ENCHANTS) {
    if (canApply(stack, def.id)) total += def.weight;
  }
  if (total === 0) return -1;

  let roll = hash3(seed, slot, stack.item, stack.ench ?? 0, ENCHANT_SALT) % total;
  for (const def of ENCHANTS) {
    if (!canApply(stack, def.id)) continue;
    roll -= def.weight;
    if (roll < 0) return def.id;
  }
  return -1;
}

// --- efeitos --------------------------------------------------------------

/**
 * Bônus de velocidade de quebra (doc 06 §7: `speedMultiplier += n² + 1`).
 * Devolve 0 sem o encantamento, para o chamador somar sem ramificar.
 */
export function efficiencyBonus(level: number): number {
  return level <= 0 ? 0 : level * level + 1;
}

/**
 * true se este uso **não** deve gastar durabilidade.
 *
 * Inquebrável n poupa `n / (n + 1)` dos usos, que é o que faz o nível III
 * praticamente quadruplicar a vida da ferramenta sem nunca torná-la eterna.
 */
export function skipDurability(stack: ItemStack | null, roll: number): boolean {
  const level = levelOf(stack, UNBREAKING);
  if (level <= 0) return false;
  return roll < level / (level + 1);
}

/**
 * Multiplicador de drops com Fortuna. Bônus uniforme de 0 a `level`, então
 * Fortuna III dá em média o dobro — e nunca menos que o normal.
 */
export function fortuneMultiplier(level: number, roll: number): number {
  if (level <= 0) return 1;
  return 1 + Math.floor(roll * (level + 1));
}

/** Dano extra de Afiação (doc 05 §2 é a base; o encantamento soma por cima). */
export function sharpnessBonus(level: number): number {
  return level <= 0 ? 0 : 0.5 * level + 0.5;
}

/** Unidades extras que Pilhagem acrescenta a um drop de mob. */
export function lootingBonus(level: number, roll: number): number {
  if (level <= 0) return 0;
  return Math.floor(roll * (level + 1));
}

/**
 * Dano depois de Proteção: −4% por nível somado nas quatro peças, com teto de
 * 80%. O teto existe pelo mesmo motivo do piso da armadura em `combat.ts`: sem
 * ele, armadura encantada anularia o jogo.
 */
export function reduceByProtection(damage: number, protectionLevels: number): number {
  if (protectionLevels <= 0) return damage;
  return damage * (1 - Math.min(0.8, protectionLevels * 0.04));
}

/** Dano de queda depois de Queda Suave: −12% por nível. */
export function reduceFallDamage(damage: number, level: number): number {
  if (level <= 0) return damage;
  return damage * Math.max(0, 1 - level * 0.12);
}

/** Soma dos níveis de Proteção nas peças equipadas. */
export function protectionOf(slots: readonly (ItemStack | null)[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += levelOf(slots[i] ?? null, PROTECTION);
  return total;
}

/** Nível de Queda Suave da bota equipada. */
export function featherFallingOf(boots: ItemStack | null): number {
  return levelOf(boots, FEATHER_FALLING);
}
