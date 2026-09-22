/**
 * Forma das árvores, separada de **onde** elas são escritas.
 *
 * Até 2026-09-22 isto vivia dentro de `gen/decorate.ts`, escrevendo direto na
 * `ChunkColumn`, e por isso a muda nunca crescia: a única receita de árvore do
 * jogo só sabia escrever durante a geração. Agora a receita recebe um
 * `TreeWriter` — a geração passa um que escreve no chunk com recorte, e o
 * crescimento da muda (`world/growth.ts`) passa um que escreve pelo
 * `world.setBlock`. A mesma árvore sai dos dois caminhos.
 *
 * **A ordem dos sorteios é contrato.** A geração de terreno é função da seed,
 * e mudar a ordem ou a quantidade de chamadas ao `rng` aqui mudaria todo mundo
 * ainda não gerado — com costura contra o que já foi salvo. O código das três
 * formas foi movido sem alterar nenhum sorteio.
 */

import { BLOCK_BY_NAME, makeState } from '../data/blocks';
import type { TreeKind } from '../data/plants';

export type { TreeKind } from '../data/plants';

/** O pedaço do `Rng` que a forma usa — a muda passa um sobre `Math.random`. */
export interface TreeRng {
  nextInt(n: number): number;
  nextFloat(): number;
}

/**
 * Onde a árvore é escrita. `trunk` sobrescreve (é o tronco atravessando a
 * própria muda ou a grama); `leaf` só entra em célula vazia.
 */
export interface TreeWriter {
  trunk(x: number, y: number, z: number, state: number): void;
  leaf(x: number, y: number, z: number, state: number): void;
}

function stateOf(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco de árvore desconhecido: ${name}`);
  return makeState(def.id);
}

/** Tronco e folha de cada espécie, resolvidos pela tabela e não por número. */
export const TREE_BLOCKS: Record<TreeKind, { log: number; leaves: number }> = {
  oak: { log: stateOf('oak_log'), leaves: stateOf('oak_leaves') },
  birch: { log: stateOf('birch_log'), leaves: stateOf('birch_leaves') },
  spruce: { log: stateOf('spruce_log'), leaves: stateOf('spruce_leaves') },
  acacia: { log: stateOf('acacia_log'), leaves: stateOf('acacia_leaves') },
};

/**
 * Altura máxima que cada forma ocupa acima da base, contando a copa. É o que
 * a muda confere antes de crescer: árvore que não cabe não cresce.
 */
export const TREE_MAX_HEIGHT: Record<TreeKind, number> = {
  oak: 8, birch: 9, spruce: 11, acacia: 7,
};

/** Escreve a árvore com a base do tronco em `(x, base, z)`. */
export function growTree(
  writer: TreeWriter, rng: TreeRng, kind: TreeKind, x: number, base: number, z: number,
): void {
  if (kind === 'spruce') growSpruce(writer, rng, x, base, z);
  else if (kind === 'acacia') growAcacia(writer, rng, x, base, z);
  else growRound(writer, rng, x, base, z, kind);
}

/** Carvalho e bétula: tronco reto com uma copa arredondada. */
function growRound(
  w: TreeWriter, rng: TreeRng, wx: number, base: number, wz: number, kind: TreeKind,
): void {
  const { log, leaves } = TREE_BLOCKS[kind];
  const height = (kind === 'birch' ? 5 : 4) + rng.nextInt(3);

  for (let y = 0; y < height; y++) w.trunk(wx, base + y, wz, log);

  const top = base + height;
  for (let dy = -2; dy <= 1; dy++) {
    const radius = dy >= 1 ? 1 : 2;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        // Corta os cantos do anel largo, senão a copa fica um cubo.
        if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if (rng.nextFloat() < 0.75) continue;
        }
        if (dx === 0 && dz === 0 && dy < 1) continue;
        w.leaf(wx + dx, top + dy, wz + dz, leaves);
      }
    }
  }
}

/** Pinheiro: cônico, mais alto e mais estreito no topo. */
function growSpruce(w: TreeWriter, rng: TreeRng, wx: number, base: number, wz: number): void {
  const { log, leaves } = TREE_BLOCKS.spruce;
  const height = 7 + rng.nextInt(4);
  for (let y = 0; y < height; y++) w.trunk(wx, base + y, wz, log);

  let radius = 0;
  for (let y = height; y >= 2; y--) {
    // O raio cresce descendo e reinicia a cada dois níveis: é o que dá o
    // recorte de galhos em degraus do pinheiro.
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue;
        if (dx === 0 && dz === 0 && y < height) continue;
        w.leaf(wx + dx, base + y, wz + dz, leaves);
      }
    }
    radius = radius >= 2 ? 0 : radius + 1;
  }
}

/** Acácia: tronco curto e uma copa chata e larga. */
function growAcacia(w: TreeWriter, rng: TreeRng, wx: number, base: number, wz: number): void {
  const { log, leaves } = TREE_BLOCKS.acacia;
  const height = 4 + rng.nextInt(2);
  for (let y = 0; y < height; y++) w.trunk(wx, base + y, wz, log);

  const top = base + height;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dz * dz > 9) continue;
      w.leaf(wx + dx, top, wz + dz, leaves);
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) w.leaf(wx + dx, top + 1, wz + dz, leaves);
    }
  }
}
