/**
 * Como baixar cada mod (M21). Cada `import()` vira um pedaço de bundle próprio.
 *
 * **Só `mods/boot.ts` e `workers/chunk.modworker.ts` importam este módulo** —
 * nunca o jogo. Se o pedaço principal o importasse, ele passaria a conhecer os
 * pedaços dos mods e a levar o ajudante de pré-carga do Vite, mesmo sem mod
 * ligado. `tests/modsisolation.test.ts` cobra.
 */

import type { ModDef } from './types';

export const MOD_LOADERS: Readonly<Record<string, () => Promise<{ default: ModDef }>>> = {
  exemplo: () => import('./exemplo/mod'),
};

/** Baixa os mods pedidos, em paralelo; o que falhar (sem rede) fica de fora. */
export async function loadMods(ids: readonly string[]): Promise<ModDef[]> {
  const loaded = await Promise.all(ids.map(async (id) => {
    const loader = MOD_LOADERS[id];
    if (loader === undefined) return null;
    try {
      return (await loader()).default;
    } catch (error) {
      console.warn(`mod ${id} não carregou`, error);
      return null;
    }
  }));
  return loaded.filter((mod): mod is ModDef => mod !== null);
}
