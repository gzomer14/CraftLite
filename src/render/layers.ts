/**
 * Mapa nome de textura → camada do texture array.
 *
 * Vive fora do `Atlas` porque o **worker de meshing precisa dele e não tem
 * contexto GL**. Como os dois derivam da mesma tabela declarativa, a camada que
 * o worker grava no vértice é exatamente a que o atlas subiu para a GPU.
 */

import { TEXTURES } from '../data/textures';

export interface LayerInfo {
  layer: number;
  frames: number;
}

export interface LayerIndex {
  byName: Map<string, LayerInfo>;
  /** Total de camadas, contando os quadros das animadas. */
  count: number;
  /** Ordem de geração: nome de cada textura-base, para o atlas percorrer. */
  names: readonly string[];
}

/** Determinístico: só depende da ordem de `TEXTURES`. */
export function buildLayerIndex(): LayerIndex {
  const byName = new Map<string, LayerInfo>();
  const names = Object.keys(TEXTURES);
  let next = 0;
  for (const name of names) {
    const frames = TEXTURES[name].frames ?? 1;
    byName.set(name, { layer: next, frames });
    next += frames;
  }
  return { byName, count: next, names };
}

/** Camada de um nome, com fallback para `block/missing`. */
export function layerOf(index: LayerIndex, name: string): number {
  const info = index.byName.get(name);
  if (info !== undefined) return info.layer;
  return index.byName.get('block/missing')?.layer ?? 0;
}
