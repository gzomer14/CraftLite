/**
 * Bigorna (M15): com que material cada ferramenta e armadura se conserta, e
 * quanto cada operação custa.
 *
 * Dado, não código: o material sai do **prefixo do nome** (`iron_pickaxe` →
 * `iron`), que é como `data/items.ts` monta ferramenta e armadura. Material
 * novo é uma linha aqui.
 */
import { t } from '../core/i18n';

/** Prefixo de material → item que o conserta (`#tag` vale para a madeira). */
export const REPAIR_MATERIAL: Readonly<Record<string, string>> = {
  wooden: '#planks',
  stone: 'cobblestone',
  iron: 'iron_ingot',
  golden: 'gold_ingot',
  diamond: 'diamond',
  leather: 'leather',
};

/** Como a tela chama o material que é uma tag (a madeira conserta com qualquer tábua). */
export const REPAIR_TAG_DISPLAY: Readonly<Record<string, string>> = {
  planks: t('anvil.planks'),
};

/** Cada unidade de material devolve um quarto da durabilidade (o do gênero). */
export const REPAIR_PER_UNIT = 0.25;
/** Juntar duas peças soma as durabilidades e ganha mais 12% do máximo. */
export const COMBINE_BONUS = 0.12;
/** Custo fixo de juntar duas peças, além do que os encantamentos cobram. */
export const COMBINE_COST = 2;
/** Custo por nível de encantamento vindo de peça; de livro, a metade. */
export const ENCHANT_COST_ITEM = 2;
export const ENCHANT_COST_BOOK = 1;
/** Renomear custa um nível. */
export const RENAME_COST = 1;
/**
 * A partir daqui a bigorna recusa ("Caro demais"), como no gênero. No
 * Criativo não há teto.
 */
export const TOO_EXPENSIVE = 40;
/** Nome mais longo que a bigorna aceita. */
export const MAX_NAME_LENGTH = 30;
