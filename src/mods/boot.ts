/**
 * Ponto de entrada **com mods** (M21).
 *
 * O `index.html` só chega aqui quando o jogador ligou algum mod; sem mod, ele
 * carrega o `main.ts` direto, e este arquivo nem é baixado. Aqui: baixar os
 * mods, conferir, deixar em `globalThis.__CRAFTLITE_MODS__` e só então importar
 * o jogo — as tabelas de `src/data/` leem o global ao se montar
 * (`mods/active.ts`).
 *
 * Não importa nada do jogo (nem o catálogo): um módulo em comum entre este
 * ponto de entrada e o `main.ts` iria para um pedaço compartilhado, que o jogo
 * sem mod teria de baixar.
 */

import { loadMods } from './loaders';
import { acceptMods } from './validate';

/** A mesma de `MODS_STORAGE_KEY` (`mods/catalog.ts`); há teste. */
const STORAGE_KEY = 'craftlite.mods';

function storedIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function boot(): Promise<void> {
  const { accepted, problems } = acceptMods(await loadMods(storedIds()));
  if (problems.length > 0) console.warn('mods recusados:', problems);
  (globalThis as { __CRAFTLITE_MODS__?: unknown }).__CRAFTLITE_MODS__ = accepted;
  await import('../main');
}

void boot();
