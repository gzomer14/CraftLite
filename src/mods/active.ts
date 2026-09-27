/**
 * Os mods ligados nesta página (M21).
 *
 * Quem os carrega é `mods/boot.ts`, um ponto de entrada **separado** do jogo:
 * ele baixa os mods, deixa as definições em `globalThis.__CRAFTLITE_MODS__` e só
 * então importa o `main.ts`. Assim as tabelas de `src/data/`, que se montam na
 * avaliação do módulo, já nascem com as linhas dos mods — e nenhuma tabela
 * derivada (atlas, sprites, índices por nome, tabelas do mesher) precisa ser
 * refeita depois.
 *
 * Sem mod ligado, o `index.html` carrega o `main.ts` direto, o global não
 * existe, e esta lista é vazia: cada tabela percorre uma lista vazia **uma vez,
 * no boot**. Nenhum código de mod roda no tick, no render ou no mesher.
 *
 * O worker de chunks lê o mesmo global: com mods, quem o sobe é
 * `workers/chunk.modworker.ts`, que carrega os mesmos mods antes das tabelas.
 */

import type { ModDef } from './types';

export const ACTIVE_MODS: readonly ModDef[] =
  (globalThis as { __CRAFTLITE_MODS__?: readonly ModDef[] }).__CRAFTLITE_MODS__ ?? [];

/** As linhas de uma tabela, de todos os mods ligados, na ordem da lista. */
export function modRows<T>(pick: (mod: ModDef) => readonly T[] | undefined): T[] {
  const out: T[] = [];
  for (const mod of ACTIVE_MODS) {
    const rows = pick(mod);
    if (rows !== undefined) out.push(...rows);
  }
  return out;
}
