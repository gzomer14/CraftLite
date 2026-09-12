/**
 * Converte um bloco quebrado em itens e em experiência (doc 04, doc 05 §7).
 *
 * A regra padrão é "dropa a si mesmo"; a tabela `BLOCK_LOOT` só declara as
 * exceções. Blocos com `requiresTool` não dropam nada sem a ferramenta certa —
 * é o que dá peso a conseguir a picareta certa.
 *
 * O sorteio usa o PRNG por posição, então quebrar o mesmo bloco na mesma seed
 * dá o mesmo resultado: nada de recarregar para tentar outro drop. Fortuna e
 * Toque Suave entram como **parâmetro** do sorteio, não como caso especial:
 * quem chama passa a máscara de encantamento da ferramenta e pronto.
 */

import { BLOCK_LOOT, type Drop } from '../data/loot';
import { cropOfState, isRipe } from '../data/crops';
import { defOf } from '../data/blocks';
import { FORTUNE, SILK_TOUCH } from '../data/enchants';
import { fortuneMultiplier, levelIn } from './enchanting';
import { ITEM_BY_NAME, maxStackOf, type ItemStack } from '../data/items';
import { canHarvest } from './interaction';
import { hash3 } from '../core/rng';
import type { ToolSpec } from '../data/items';

/** Uma saída do sorteio, reusada para não alocar por bloco quebrado. */
const OUT: ItemStack[] = [];

/**
 * Itens que o bloco solta. Devolve um array reusado — copie antes de chamar
 * de novo. `ench` é a máscara de encantamento da ferramenta em uso.
 */
export function rollDrops(
  state: number, tool: ToolSpec | undefined, seed: number, x: number, y: number, z: number,
  ench = 0,
): readonly ItemStack[] {
  OUT.length = 0;
  const def = defOf(state);
  if (!canHarvest(def, tool)) return OUT;

  const fortune = levelIn(ench, FORTUNE);

  // Plantação dropa conforme a idade: madura entrega a colheita, verde devolve
  // só a semente. É a tabela de `data/crops.ts` que decide, não um caso aqui.
  const crop = cropOfState(state);
  if (crop !== undefined) {
    const drops = isRipe(state) ? crop.ripe : crop.young;
    for (let i = 0; i < drops.length; i++) {
      const stack = rollOne(drops[i], seed, x, y, z, i, fortune);
      if (stack !== null) OUT.push(stack);
    }
    return OUT;
  }

  // Toque Suave devolve o próprio bloco, inclusive o que normalmente se
  // converte (pedra, minério, vidro). Vale antes da tabela: é justamente a
  // tabela que ele ignora.
  if (levelIn(ench, SILK_TOUCH) > 0) {
    const self = ITEM_BY_NAME.get(def.name);
    if (self !== undefined) {
      OUT.push({ item: self.id, count: 1, damage: 0 });
      return OUT;
    }
  }

  const entry = BLOCK_LOOT[def.name];
  if (entry === undefined) {
    // Regra padrão: o bloco vira o item de mesmo id.
    const item = ITEM_BY_NAME.get(def.name);
    if (item !== undefined) OUT.push({ item: item.id, count: 1, damage: 0 });
    return OUT;
  }

  for (let i = 0; i < entry.drops.length; i++) {
    const stack = rollOne(entry.drops[i], seed, x, y, z, i, fortune);
    if (stack !== null) OUT.push(stack);
  }
  return OUT;
}

/**
 * Experiência solta ao quebrar um bloco (doc 04 §2.2).
 *
 * Toque Suave zera: quem leva o minério inteiro não leva também o prêmio de
 * tê-lo quebrado. Sem ferramenta certa também não sai nada — sem drop, sem XP.
 */
export function rollXp(
  state: number, tool: ToolSpec | undefined, seed: number, x: number, y: number, z: number,
  ench = 0,
): number {
  const def = defOf(state);
  if (!canHarvest(def, tool)) return 0;
  if (levelIn(ench, SILK_TOUCH) > 0) return 0;

  const range = BLOCK_LOOT[def.name]?.xp;
  if (range === undefined) return 0;
  const [min, max] = range;
  const roll = hash3(seed, x, y, z, 0x30c0) / 4294967296;
  return min + Math.floor(roll * (max - min + 1));
}

function rollOne(
  drop: Drop, seed: number, x: number, y: number, z: number, index: number, fortune: number,
): ItemStack | null {
  const item = ITEM_BY_NAME.get(drop.item);
  if (item === undefined) return null;

  // Determinístico por posição: recarregar não muda o resultado.
  const roll = hash3(seed, x, y, z, 0x10c0 + index) / 4294967296;
  if (drop.chance !== undefined && roll >= drop.chance) return null;

  let count: number;
  if (typeof drop.count === 'number') {
    count = drop.count;
  } else {
    const [min, max] = drop.count;
    const spread = hash3(seed, x, y, z, 0x20c0 + index) / 4294967296;
    count = min + Math.floor(spread * (max - min + 1));
  }
  if (count <= 0) return null;

  if (fortune > 0 && drop.fortune === true) {
    const luck = hash3(seed, x, y, z, 0x40c0 + index) / 4294967296;
    // O teto da pilha existe porque Fortuna III num veio de lápis passaria de
    // 64 num drop só, e a entidade no chão não empilha acima do máximo.
    count = Math.min(maxStackOf(item.id), count * fortuneMultiplier(fortune, luck));
  }
  return { item: item.id, count, damage: 0 };
}
