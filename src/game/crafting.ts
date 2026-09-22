/**
 * Matcher de receitas (doc 05 §6.2).
 *
 * O doc marca este algoritmo como "obrigatório acertar". Os três pontos que
 * costumam sair errados:
 *
 * 1. **Bounding box mínimo** — a receita pode estar em qualquer canto da grade.
 * 2. **Espelhamento horizontal** — receitas valem espelhadas na horizontal,
 *    mas **não** na vertical (senão a picareta viraria uma coisa de cabeça
 *    para baixo).
 * 3. **Shapeless é multiset**, não lista: a ordem não importa, mas a contagem
 *    de cada item sim.
 *
 * As receitas são compiladas uma vez no boot para ids concretos; o matcher só
 * trabalha com números.
 */

import { RECIPES, resolveIngredient, type Recipe } from '../data/recipes';
import { ITEM_BY_NAME, itemDef, type ItemStack } from '../data/items';

/** Receita já resolvida para ids. */
interface CompiledShaped {
  type: 'shaped';
  width: number;
  height: number;
  /** `width × height` conjuntos de ids aceitos; `null` = célula vazia. */
  cells: (number[] | null)[];
  resultItem: number;
  resultCount: number;
  source: Recipe;
}

interface CompiledShapeless {
  type: 'shapeless';
  ingredients: number[][];
  resultItem: number;
  resultCount: number;
  source: Recipe;
}

type Compiled = CompiledShaped | CompiledShapeless;

/** Uma grade de crafting: 2×2 ou 3×3, em ordem linha-a-linha. */
export interface CraftGrid {
  size: 2 | 3;
  slots: (ItemStack | null)[];
}

/** Uma receita no formato da interface. */
export interface RecipeEntry {
  resultItem: number;
  resultCount: number;
  /** Tamanho da grade mínima que a receita ocupa. */
  width: number;
  height: number;
  /** `width × height` células; cada uma lista os ids aceitos, ou `null`. */
  cells: readonly (readonly number[] | null)[];
  shapeless: boolean;
}

export class RecipeBook {
  private readonly compiled: Compiled[] = [];
  /** Índice por item resultante, para o livro de receitas da UI. */
  private readonly byResult = new Map<number, Compiled[]>();
  /** `entries()` é chamado pela UI a cada abertura; compilar uma vez basta. */
  private entryCache: RecipeEntry[] | null = null;

  constructor(recipes: readonly Recipe[] = RECIPES) {
    for (const recipe of recipes) {
      const entry = compile(recipe);
      if (entry === null) continue; // ingrediente inexistente: ignora em vez de quebrar o boot
      this.compiled.push(entry);
      const list = this.byResult.get(entry.resultItem) ?? [];
      list.push(entry);
      this.byResult.set(entry.resultItem, list);
    }
  }

  get size(): number {
    return this.compiled.length;
  }

  /** Resultado do que está na grade, ou `null`. Não consome nada. */
  match(grid: CraftGrid): ItemStack | null {
    for (let i = 0; i < this.compiled.length; i++) {
      const recipe = this.compiled[i];
      const ok = recipe.type === 'shaped'
        ? matchShaped(recipe, grid)
        : matchShapeless(recipe, grid);
      if (ok) return { item: recipe.resultItem, count: recipe.resultCount, damage: 0 };
    }
    return null;
  }

  /** Receitas que produzem um item — usado pelo livro de receitas. */
  forResult(item: number): readonly Recipe[] {
    return (this.byResult.get(item) ?? []).map((c) => c.source);
  }

  /**
   * Todas as receitas no formato que a interface precisa: resultado, tamanho e
   * quais ids cabem em cada célula.
   *
   * O livro de receitas do doc 05 §6.4 precisa disso para desenhar a receita e
   * para preencher a grade sozinho — sem essa lista, o jogador tem que saber a
   * receita de cor, que é exatamente o que o livro existe para evitar.
   */
  entries(): readonly RecipeEntry[] {
    if (this.entryCache !== null) return this.entryCache;
    const out: RecipeEntry[] = [];
    for (const recipe of this.compiled) {
      if (recipe.type === 'shaped') {
        out.push({
          resultItem: recipe.resultItem,
          resultCount: recipe.resultCount,
          width: recipe.width,
          height: recipe.height,
          cells: recipe.cells,
          shapeless: false,
        });
        continue;
      }
      // Sem forma: distribui os ingredientes em linha, só para desenhar.
      const width = Math.min(3, Math.max(1, recipe.ingredients.length));
      const height = Math.ceil(recipe.ingredients.length / width);
      const cells: (number[] | null)[] = [];
      for (let i = 0; i < width * height; i++) {
        cells.push(recipe.ingredients[i] ?? null);
      }
      out.push({
        resultItem: recipe.resultItem,
        resultCount: recipe.resultCount,
        width,
        height,
        cells,
        shapeless: true,
      });
    }
    this.entryCache = out;
    return out;
  }
}

/** Consome uma unidade de cada ingrediente usado. */
export function consumeGrid(grid: CraftGrid): void {
  for (let i = 0; i < grid.slots.length; i++) {
    const stack = grid.slots[i];
    if (stack === null) continue;
    stack.count--;
    if (stack.count > 0) continue;
    /*
     * O que sobra fica na célula (2026-09-22): o balde do balde de leite volta
     * vazio para a grade, como no gênero. Todo item com resto empilha em 1, então
     * a célula está sempre livre quando o resto chega.
     */
    const remainder = remainderOf(stack.item);
    grid.slots[i] = remainder < 0 ? null : { item: remainder, count: 1, damage: 0 };
  }
}

/** Id do item que sobra ao gastar `item` (tigela, balde), ou −1. */
export function remainderOf(item: number): number {
  const name = itemDef(item)?.remainder;
  if (name === undefined) return -1;
  return ITEM_BY_NAME.get(name)?.id ?? -1;
}

/** Quantas vezes a receita atual pode ser feita com o que está na grade. */
export function craftableCount(grid: CraftGrid): number {
  let min = Infinity;
  for (const stack of grid.slots) {
    if (stack === null) continue;
    min = Math.min(min, stack.count);
  }
  return min === Infinity ? 0 : min;
}

// ---------------------------------------------------------------------------

function compile(recipe: Recipe): Compiled | null {
  const result = ITEM_BY_NAME.get(recipe.result.item);
  if (result === undefined) return null;

  try {
    if (recipe.type === 'shapeless') {
      return {
        type: 'shapeless',
        ingredients: recipe.ingredients.map(resolveIngredient),
        resultItem: result.id,
        resultCount: recipe.result.count,
        source: recipe,
      };
    }

    /*
     * O padrão precisa ser **recortado ao próprio bounding box** antes de
     * virar receita.
     *
     * A tabela (e o doc 05 §6.3) escreve os padrões preenchidos até 3 colunas
     * — `'.M.'` para a espada, por exemplo. Sem recortar, a largura declarada
     * seria 3 e nunca bateria com o bounding box de 1 coluna que o jogador
     * monta na grade.
     */
    const rawHeight = recipe.pattern.length;
    const rawWidth = Math.max(...recipe.pattern.map((row) => row.length));
    const filled = (x: number, y: number): boolean => {
      const symbol = recipe.pattern[y][x] ?? ' ';
      return symbol !== ' ' && symbol !== '.';
    };

    let minX = rawWidth, minY = rawHeight, maxX = -1, maxY = -1;
    for (let y = 0; y < rawHeight; y++) {
      for (let x = 0; x < rawWidth; x++) {
        if (!filled(x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) throw new Error('Receita com padrão vazio.');

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const cells: (number[] | null)[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const symbol = recipe.pattern[minY + y][minX + x] ?? ' ';
        if (symbol === ' ' || symbol === '.') {
          cells.push(null);
          continue;
        }
        const ingredient = recipe.key[symbol];
        if (ingredient === undefined) throw new Error(`Símbolo sem chave: ${symbol}`);
        cells.push(resolveIngredient(ingredient));
      }
    }
    return {
      type: 'shaped', width, height, cells,
      resultItem: result.id, resultCount: recipe.result.count, source: recipe,
    };
  } catch {
    // Receita citando item que ainda não existe: some da lista, não derruba o jogo.
    return null;
  }
}

/** Retângulo mínimo que contém os slots preenchidos. */
interface Bounds {
  minX: number; minY: number; width: number; height: number; count: number;
}

function boundsOf(grid: CraftGrid): Bounds {
  let minX: number = grid.size;
  let minY: number = grid.size;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (grid.slots[y * grid.size + x] === null) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return { minX: 0, minY: 0, width: 0, height: 0, count: 0 };
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1, count };
}

function matchShaped(recipe: CompiledShaped, grid: CraftGrid): boolean {
  const bounds = boundsOf(grid);
  if (bounds.count === 0) return false;
  // O bounding box precisa ter exatamente o tamanho da receita.
  if (bounds.width !== recipe.width || bounds.height !== recipe.height) return false;

  // Primeiro como está, depois espelhado na horizontal (doc 05 §6.2).
  return comparePattern(recipe, grid, bounds, false)
    || comparePattern(recipe, grid, bounds, true);
}

function comparePattern(
  recipe: CompiledShaped, grid: CraftGrid, bounds: Bounds, mirrored: boolean,
): boolean {
  for (let y = 0; y < recipe.height; y++) {
    for (let x = 0; x < recipe.width; x++) {
      const sourceX = mirrored ? recipe.width - 1 - x : x;
      const expected = recipe.cells[y * recipe.width + sourceX];
      const stack = grid.slots[(bounds.minY + y) * grid.size + (bounds.minX + x)];

      if (expected === null) {
        if (stack !== null) return false;
        continue;
      }
      if (stack === null) return false;
      if (!expected.includes(stack.item)) return false;
    }
  }
  return true;
}

function matchShapeless(recipe: CompiledShapeless, grid: CraftGrid): boolean {
  const present: number[] = [];
  for (const stack of grid.slots) {
    if (stack !== null) present.push(stack.item);
  }
  if (present.length !== recipe.ingredients.length) return false;

  // Casamento guloso sobre o multiset: cada ingrediente consome um item.
  const used = new Array<boolean>(present.length).fill(false);
  for (const accepted of recipe.ingredients) {
    let found = false;
    for (let i = 0; i < present.length; i++) {
      if (used[i] || !accepted.includes(present[i])) continue;
      used[i] = true;
      found = true;
      break;
    }
    if (!found) return false;
  }
  return true;
}
