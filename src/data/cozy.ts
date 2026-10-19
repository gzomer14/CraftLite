/**
 * Aconchego (M26): as tabelas dos blocos de casa. Quem as executa mora em
 * `game/cozy.ts` (o clique) e `game/campfire.ts` (a fogueira que assa); aqui
 * fica só o que é conteúdo — planta nova no vaso ou madeira nova no machado é
 * uma linha nesta tabela.
 *
 * Não importa `data/blocks.ts`: a tabela de blocos lê `POTTABLE` para montar a
 * textura do vaso por estado, e o caminho de volta seria um ciclo.
 */

/**
 * Plantas que cabem no vaso. O estado do vaso é a posição aqui **+ 1** (0 é o
 * vaso vazio), e vai para o save: **só se acrescenta no fim**. Cabem 15 — os
 * 4 bits que a textura por estado indexa (`MAX_STAGES`), menos o vazio.
 */
export const POTTABLE: readonly string[] = [
  'dandelion', 'poppy', 'oak_sapling', 'birch_sapling', 'spruce_sapling', 'acacia_sapling',
  'jungle_sapling', 'fern', 'dead_bush', 'red_mushroom', 'brown_mushroom',
];

/** O que o machado faz de cada tronco (clique direito, doc 14 — M26). */
export const STRIPPED: Readonly<Record<string, string>> = {
  oak_log: 'stripped_oak_log',
  birch_log: 'stripped_birch_log',
  spruce_log: 'stripped_spruce_log',
  acacia_log: 'stripped_acacia_log',
  jungle_log: 'stripped_jungle_log',
};

/** Quantos itens a fogueira assa ao mesmo tempo. */
export const CAMPFIRE_SLOTS = 4;
/**
 * Ticks para assar na fogueira: 30 s, o triplo da fornalha (`SMELT_TICKS`). É
 * o preço de não gastar combustível — e o critério do doc 14 ("a fogueira
 * assa carne em ~30 s").
 */
export const CAMPFIRE_COOK_TICKS = 600;

/** Níveis de água do caldeirão: um balde enche, cada frasco tira um. */
export const CAULDRON_LEVELS = 3;
