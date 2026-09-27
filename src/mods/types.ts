/**
 * O que um mod é (M21, doc 14).
 *
 * Um mod é uma pasta `src/mods/<id>/` com um `mod.ts` cujo `export default` é
 * um `ModDef`: **linhas das mesmas tabelas de `src/data/`** e, quando o dado não
 * basta, um sistema de tick. Acrescentar uma arma é uma linha em `items`, não um
 * `case` novo — a regra do projeto vale para mod também.
 *
 * **Regra de isolamento, cobrada por `tests/modsisolation.test.ts`:** o código
 * de um mod só importa **tipos** de fora de `src/mods/`. Um `import` de valor
 * (uma função de `render/texgen`, uma constante de `data/blocks`) faria o
 * Rollup tirar esse módulo do pedaço principal para um pedaço compartilhado —
 * e o jogo **sem mod nenhum** passaria a baixar um arquivo a mais. O que o mod
 * precisa em tempo de execução chega por parâmetro: os operadores de textura em
 * `textures(g)`, o mundo e o jogador em `tick(ctx)`.
 */

import type { BlockDef } from '../data/blocks';
import type { ItemDef, ItemStack } from '../data/items';
import type { ItemArt } from '../data/itemart';
import type { Recipe } from '../data/recipes';
import type { SmeltingRecipe } from '../data/smelting';
import type * as TexGen from '../render/texgen';
import type { TexRecipe } from '../render/texgen';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

/**
 * Faixas de id reservadas a mods. O id vai para o save, então é **fixo por
 * construção**: `base + posição na lista` — e não alocado no boot, que mudaria
 * com a ordem em que os mods são ligados. O jogo base fica abaixo das duas
 * faixas (há teste).
 */
export const MOD_BLOCK_FIRST = 768;
/** O id de bloco tem 10 bits (`data/blocks.ts:makeState`). */
export const MOD_BLOCK_LAST = 1023;
export const MOD_ITEM_FIRST = 4096;
export const MOD_ITEM_LAST = 8191;

/** Um bloco de mod: as colunas de `BlockDef`, com os padrões da tabela. */
export type ModBlock = Partial<Omit<BlockDef, 'id' | 'name' | 'display'>>
  & Pick<BlockDef, 'name' | 'display'>;

/** Um item de mod (não bloco). `tex` padrão: `item/<nome>`. */
export type ModItem = Partial<Omit<ItemDef, 'id' | 'name' | 'display' | 'uses'>>
  & Pick<ItemDef, 'name' | 'display'>;

/**
 * O que um sistema de mod enxerga a cada tick. É a própria `Session` vista por
 * uma interface estreita: `world` é sempre o da dimensão em que o jogador está.
 */
export interface ModContext {
  readonly world: World;
  readonly player: Player;
  readonly survival: { readonly health: number; heal(amount: number): void };
  /** Devolve o que não coube (`Inventory.giveStack`). */
  readonly inventory: { giveStack(stack: ItemStack): number };
}

/** Os operadores de textura que um mod recebe (`data/textures.ts` os entrega). */
export type TexOps = Pick<typeof TexGen,
  'alphaMask' | 'blobs' | 'border' | 'bricks' | 'cropRows' | 'dither' | 'emboss' | 'flow'
  | 'furrows' | 'oreBlobs' | 'outline' | 'pattern' | 'plankLines' | 'rect' | 'rings' | 'speckle'
  | 'stripes' | 'tintBy'>;

export interface ModDef {
  /** `[a-z0-9_]+`. Todo nome de conteúdo do mod começa com `<id>:`. */
  id: string;
  /** Sobe quando o mod muda de um jeito que o save precisa saber. */
  version: number;
  /** Primeiro id de bloco do mod, dentro de `MOD_BLOCK_FIRST..MOD_BLOCK_LAST`. */
  blockBase?: number;
  /** Primeiro id de item do mod, dentro de `MOD_ITEM_FIRST..MOD_ITEM_LAST`. */
  itemBase?: number;
  /**
   * Blocos, **só acrescentados no fim**: o id é `blockBase + posição`, e ele
   * está no save de quem jogou com o mod. Tirar ou reordenar uma linha troca o
   * bloco de mundo salvo.
   */
  blocks?: readonly ModBlock[];
  /** Itens, com a mesma regra de só acrescentar no fim (`itemBase + posição`). */
  items?: readonly ModItem[];
  /** Receitas de textura, com os operadores de `render/texgen` por parâmetro. */
  textures?: (g: TexOps) => Record<string, TexRecipe>;
  /** Silhuetas de sprite de item (16 linhas de 16 papéis, `data/itemart.ts`). */
  itemShapes?: Record<string, readonly string[]>;
  /** Arte de cada item do mod, pelo nome do item. */
  itemArt?: Record<string, ItemArt>;
  recipes?: readonly Recipe[];
  smelting?: readonly SmeltingRecipe[];
  /** O nome em inglês de cada bloco e item do mod (M17: o teste cobra). */
  en: Readonly<Record<string, string>>;
  /** Sistema de tick, a 20 Hz, depois do tick do jogo. Precisa ser barato. */
  tick?: (ctx: ModContext) => void;
}
