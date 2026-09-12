/**
 * Encantamento (M6): empacotamento na pilha, sorteio da mesa e os oito efeitos.
 *
 * Tudo aqui é fórmula pura — nada de mundo, GL ou DOM. O único ponto com
 * aleatório real (`Math.random`) é injetado como parâmetro, então nenhum teste
 * depende de sorte.
 */
import { describe, expect, it } from 'vitest';
import {
  applyEnchant, canApply, createOffers, describeEnchants, efficiencyBonus, enchantCount,
  featherFallingOf, fortuneMultiplier, levelIn, levelOf, lootingBonus, MAX_BOOKSHELVES,
  offerCost, protectionOf, reduceByProtection, reduceFallDamage, rollOffers, sharpnessBonus,
  skipDurability, withEnchant,
} from '../src/game/enchanting';
import {
  EFFICIENCY, ENCHANTS, FEATHER_FALLING, FORTUNE, PROTECTION, SHARPNESS, SILK_TOUCH,
  UNBREAKING, enchantDef, fitsItem, isEnchantable,
} from '../src/data/enchants';
import { attackDamageOf } from '../src/game/combat';
import { breakTimeSeconds } from '../src/game/interaction';
import { rollDrops, rollXp } from '../src/game/drops';
import { BLOCK_BY_NAME, defOf, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, itemDef, makeStack, type ItemStack } from '../src/data/items';

const PICKAXE = ITEM_BY_NAME.get('diamond_pickaxe')!.id;
const SWORD = ITEM_BY_NAME.get('diamond_sword')!.id;
const BOOTS = ITEM_BY_NAME.get('iron_boots')!.id;
const HELMET = ITEM_BY_NAME.get('iron_helmet')!.id;
const APPLE = ITEM_BY_NAME.get('apple')!.id;
const COAL_ORE = makeState(BLOCK_BY_NAME.get('coal_ore')!.id);
const DIAMOND_ORE = makeState(BLOCK_BY_NAME.get('diamond_ore')!.id);
const COAL = ITEM_BY_NAME.get('coal')!.id;
const DIAMOND = ITEM_BY_NAME.get('diamond')!.id;
const DIAMOND_ORE_ITEM = ITEM_BY_NAME.get('diamond_ore')!.id;

const pickTool = itemDef(PICKAXE)!.tool;

describe('tabela de encantamentos', () => {
  it('tem os oito do checklist, com ids estáveis e nível dentro dos 3 bits', () => {
    expect(ENCHANTS).toHaveLength(8);
    for (let i = 0; i < ENCHANTS.length; i++) {
      expect(ENCHANTS[i].id).toBe(i);
      expect(ENCHANTS[i].maxLevel).toBeLessThanOrEqual(7);
    }
  });

  it('sabe em que item cada um cabe', () => {
    expect(fitsItem(EFFICIENCY, PICKAXE)).toBe(true);
    expect(fitsItem(EFFICIENCY, SWORD)).toBe(false);
    expect(fitsItem(SHARPNESS, SWORD)).toBe(true);
    expect(fitsItem(PROTECTION, HELMET)).toBe(true);
    // Queda Suave é só de bota, não de qualquer peça.
    expect(fitsItem(FEATHER_FALLING, BOOTS)).toBe(true);
    expect(fitsItem(FEATHER_FALLING, HELMET)).toBe(false);
    expect(isEnchantable(APPLE)).toBe(false);
  });
});

describe('empacotamento na pilha', () => {
  it('grava e lê níveis independentes na mesma máscara', () => {
    let ench = withEnchant(0, EFFICIENCY, 4);
    ench = withEnchant(ench, UNBREAKING, 3);
    expect(levelIn(ench, EFFICIENCY)).toBe(4);
    expect(levelIn(ench, UNBREAKING)).toBe(3);
    expect(levelIn(ench, FORTUNE)).toBe(0);
    expect(enchantCount(ench)).toBe(2);
  });

  it('regravar substitui em vez de somar', () => {
    let ench = withEnchant(0, SHARPNESS, 5);
    ench = withEnchant(ench, SHARPNESS, 2);
    expect(levelIn(ench, SHARPNESS)).toBe(2);
  });

  it('cabe nos oito encantamentos sem transbordar', () => {
    let ench = 0;
    for (const def of ENCHANTS) ench = withEnchant(ench, def.id, def.maxLevel);
    for (const def of ENCHANTS) expect(levelIn(ench, def.id)).toBe(def.maxLevel);
    expect(ench).toBeGreaterThan(0);
  });

  it('canApply respeita alvo, teto e conflito', () => {
    const pick: ItemStack = makeStack(PICKAXE);
    expect(canApply(pick, EFFICIENCY)).toBe(true);
    expect(canApply(pick, SHARPNESS)).toBe(false);

    applyEnchant(pick, FORTUNE, 3);
    // No teto, não aceita mais; e Toque Suave conflita com Fortuna.
    expect(canApply(pick, FORTUNE)).toBe(false);
    expect(canApply(pick, SILK_TOUCH)).toBe(false);
  });

  it('applyEnchant nunca passa do máximo da tabela', () => {
    const pick = makeStack(PICKAXE);
    applyEnchant(pick, EFFICIENCY, 99);
    expect(levelOf(pick, EFFICIENCY)).toBe(enchantDef(EFFICIENCY)!.maxLevel);
  });

  it('descreve os encantamentos em português com algarismo romano', () => {
    let ench = withEnchant(0, EFFICIENCY, 3);
    ench = withEnchant(ench, SILK_TOUCH, 1);
    const text = describeEnchants(ench);
    expect(text).toContain('Eficiência III');
    // Nível único não mostra numeral.
    expect(text).toContain('Toque Suave');
    expect(text).not.toContain('Toque Suave I');
  });
});

describe('ofertas da mesa', () => {
  it('o custo cresce com as estantes e chega a 30 no slot de baixo', () => {
    expect(offerCost(0, 0)).toBe(1);
    expect(offerCost(2, 0)).toBe(3);
    expect(offerCost(2, MAX_BOOKSHELVES)).toBe(30);
    expect(offerCost(0, MAX_BOOKSHELVES)).toBeLessThan(offerCost(2, MAX_BOOKSHELVES));
  });

  it('sorteia três ofertas aplicáveis a uma picareta', () => {
    const offers = createOffers();
    const valid = rollOffers(1234, MAX_BOOKSHELVES, makeStack(PICKAXE), offers);
    expect(valid).toBe(3);
    for (const offer of offers) {
      expect(offer.enchant).toBeGreaterThanOrEqual(0);
      expect(fitsItem(offer.enchant, PICKAXE)).toBe(true);
      expect(offer.level).toBeGreaterThanOrEqual(1);
      expect(offer.level).toBeLessThanOrEqual(enchantDef(offer.enchant)!.maxLevel);
    }
    // O lápis cobrado é o índice + 1, como na referência do gênero.
    expect(offers.map((o) => o.lapis)).toEqual([1, 2, 3]);
  });

  it('a mesma seed dá as mesmas ofertas', () => {
    const a = createOffers();
    const b = createOffers();
    rollOffers(777, 8, makeStack(SWORD), a);
    rollOffers(777, 8, makeStack(SWORD), b);
    expect(a).toEqual(b);
  });

  it('não oferece nada para o que não é encantável', () => {
    const offers = createOffers();
    expect(rollOffers(1, 15, makeStack(APPLE), offers)).toBe(0);
    expect(rollOffers(1, 15, null, offers)).toBe(0);
    expect(offers.every((o) => o.enchant < 0)).toBe(true);
  });

  it('nunca oferece o que já está no teto', () => {
    const pick = makeStack(PICKAXE);
    for (const def of ENCHANTS) {
      if (fitsItem(def.id, pick.item) && def.id !== EFFICIENCY) {
        applyEnchant(pick, def.id, def.maxLevel);
      }
    }
    const offers = createOffers();
    rollOffers(42, MAX_BOOKSHELVES, pick, offers);
    for (const offer of offers) {
      if (offer.enchant < 0) continue;
      expect(offer.enchant).toBe(EFFICIENCY);
    }
  });
});

describe('efeitos', () => {
  it('Eficiência soma n² + 1 à velocidade e encurta a quebra', () => {
    expect(efficiencyBonus(0)).toBe(0);
    expect(efficiencyBonus(3)).toBe(10);

    const stone = defOf(makeState(BLOCK_BY_NAME.get('stone')!.id));
    const plain = breakTimeSeconds(stone, pickTool);
    const fast = breakTimeSeconds(stone, pickTool, true, false, 5);
    expect(fast).toBeLessThan(plain);
  });

  it('Eficiência não ajuda com a ferramenta errada', () => {
    const wool = defOf(makeState(BLOCK_BY_NAME.get('white_wool')!.id));
    expect(breakTimeSeconds(wool, pickTool, true, false, 5))
      .toBe(breakTimeSeconds(wool, pickTool));
  });

  it('Inquebrável poupa n/(n+1) dos usos', () => {
    const plain = makeStack(PICKAXE);
    expect(skipDurability(plain, 0)).toBe(false);

    const tough = makeStack(PICKAXE);
    applyEnchant(tough, UNBREAKING, 3);
    // 3/(3+1) = 0.75 do intervalo é poupado.
    expect(skipDurability(tough, 0.5)).toBe(true);
    expect(skipDurability(tough, 0.8)).toBe(false);
  });

  it('Fortuna multiplica de 1 a n+1, nunca menos que o normal', () => {
    expect(fortuneMultiplier(0, 0.99)).toBe(1);
    expect(fortuneMultiplier(3, 0)).toBe(1);
    expect(fortuneMultiplier(3, 0.99)).toBe(4);
  });

  it('Afiação soma 0,5·n + 0,5 ao dano da arma', () => {
    expect(sharpnessBonus(0)).toBe(0);
    expect(sharpnessBonus(5)).toBe(3);

    const plain = makeStack(SWORD);
    const sharp = makeStack(SWORD);
    applyEnchant(sharp, SHARPNESS, 5);
    expect(attackDamageOf(sharp)).toBeCloseTo(attackDamageOf(plain) + 3, 5);
  });

  it('Pilhagem acrescenta de 0 a n', () => {
    expect(lootingBonus(0, 0.99)).toBe(0);
    expect(lootingBonus(3, 0)).toBe(0);
    expect(lootingBonus(3, 0.99)).toBe(3);
  });

  it('Proteção reduz 4% por nível, com teto de 80%', () => {
    expect(reduceByProtection(10, 0)).toBe(10);
    expect(reduceByProtection(10, 4)).toBeCloseTo(8.4, 5);
    expect(reduceByProtection(10, 100)).toBeCloseTo(2, 5);
  });

  it('soma a Proteção das quatro peças', () => {
    const slots: (ItemStack | null)[] = [null, null, null, null];
    const helmet = makeStack(HELMET);
    applyEnchant(helmet, PROTECTION, 3);
    const boots = makeStack(BOOTS);
    applyEnchant(boots, PROTECTION, 2);
    slots[0] = helmet;
    slots[3] = boots;
    expect(protectionOf(slots, 0, 4)).toBe(5);
  });

  it('Queda Suave alivia 12% do dano de queda por nível', () => {
    const boots = makeStack(BOOTS);
    applyEnchant(boots, FEATHER_FALLING, 4);
    expect(featherFallingOf(boots)).toBe(4);
    expect(reduceFallDamage(10, 4)).toBeCloseTo(5.2, 5);
    expect(reduceFallDamage(10, 0)).toBe(10);
  });
});

describe('drops encantados', () => {
  it('Toque Suave devolve o próprio minério em vez do drop convertido', () => {
    const plain = rollDrops(DIAMOND_ORE, pickTool, 7, 1, 2, 3, 0);
    expect(plain[0].item).toBe(DIAMOND);

    const silk = withEnchant(0, SILK_TOUCH, 1);
    const silked = rollDrops(DIAMOND_ORE, pickTool, 7, 1, 2, 3, silk);
    expect(silked).toHaveLength(1);
    expect(silked[0].item).toBe(DIAMOND_ORE_ITEM);
  });

  it('Fortuna multiplica o minério, mantendo o item', () => {
    const plain = rollDrops(COAL_ORE, pickTool, 7, 5, 6, 7, 0)[0];
    const lucky = rollDrops(COAL_ORE, pickTool, 7, 5, 6, 7, withEnchant(0, FORTUNE, 3))[0];
    expect(lucky.item).toBe(COAL);
    expect(lucky.count).toBeGreaterThanOrEqual(plain.count);
    expect(lucky.count).toBeLessThanOrEqual(plain.count * 4);
  });

  it('minério dá experiência, e Toque Suave a cancela', () => {
    const xp = rollXp(DIAMOND_ORE, pickTool, 7, 1, 2, 3, 0);
    expect(xp).toBeGreaterThanOrEqual(3);
    expect(xp).toBeLessThanOrEqual(7);
    expect(rollXp(DIAMOND_ORE, pickTool, 7, 1, 2, 3, withEnchant(0, SILK_TOUCH, 1))).toBe(0);
  });

  it('sem a ferramenta certa não sai nem drop nem experiência', () => {
    expect(rollDrops(DIAMOND_ORE, undefined, 7, 1, 2, 3, 0)).toHaveLength(0);
    expect(rollXp(DIAMOND_ORE, undefined, 7, 1, 2, 3, 0)).toBe(0);
  });

  it('bloco sem coluna de XP não solta nada', () => {
    const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
    expect(rollXp(stone, pickTool, 7, 1, 2, 3, 0)).toBe(0);
  });
});
