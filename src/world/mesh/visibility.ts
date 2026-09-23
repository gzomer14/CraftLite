/**
 * Conectividade entre as faces de uma section (M12, PROMPT.md §4.2).
 *
 * Para o culling por conectividade, o render precisa saber, de cada section,
 * **por quais pares de faces dá para enxergar através dela**: entrar pela face
 * de baixo e sair pela de cima só é possível se houver um caminho de voxels
 * não opacos ligando as duas. São 15 pares (6 faces, combinação 2 a 2), e a
 * resposta cabe em 15 bits.
 *
 * O cálculo é um flood fill do "ar" (tudo que não esconde a face do vizinho:
 * ar, água, vidro, folha, planta, laje) no interior 16³: cada região conexa
 * anota as faces da section que ela toca, e todas as faces tocadas pela mesma
 * região ficam ligadas duas a duas. Roda no worker, junto do meshing, em cima
 * da vizinhança que ele já montou — custa uma varredura de 4096 voxels.
 */

import { NB_PLANE, NB_SIDE } from '../neighborhood';

/** Todos os 15 pares ligados: section vazia, ou sem nada que tape a vista. */
export const VIS_ALL = 0x7fff;

/** Bit do par `(a, b)` de faces (índices `FACE_*` de `render/vertex.ts`). */
export const VIS_PAIR = new Uint8Array(36);
{
  let bit = 0;
  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      VIS_PAIR[a * 6 + b] = bit;
      VIS_PAIR[b * 6 + a] = bit;
      bit++;
    }
  }
}

/** true se dá para entrar pela face `a` e sair pela `b`. */
export function visConnects(vis: number, a: number, b: number): boolean {
  return a !== b && (vis & (1 << VIS_PAIR[a * 6 + b])) !== 0;
}

const S = 16;
const VOLUME = S * S * S;

/** Estado reusado: um por worker, como o mesher. */
export class VisibilityScanner {
  private readonly visited = new Uint8Array(VOLUME);
  private readonly queue = new Uint16Array(VOLUME);

  /**
   * `blocks` é a vizinhança 18³ do mesher; `occludes` é a tabela de "bloco
   * opaco que esconde o vizinho" (`BlockTables.occludes`).
   */
  scan(blocks: Uint16Array, occludes: Uint8Array): number {
    const visited = this.visited;
    let open = 0;
    for (let i = 0; i < VOLUME; i++) {
      const solid = occludes[blocks[nbOf(i)] & 0x3ff] === 1;
      visited[i] = solid ? 1 : 0;
      if (!solid) open++;
    }
    if (open === VOLUME) return VIS_ALL;
    if (open === 0) return 0;

    let vis = 0;
    const queue = this.queue;
    for (let start = 0; start < VOLUME; start++) {
      if (visited[start] !== 0) continue;
      visited[start] = 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      let faces = 0;

      while (head < tail) {
        const i = queue[head++];
        const x = i & 15;
        const z = (i >> 4) & 15;
        const y = i >> 8;
        // Face da section que esta célula encosta.
        if (x === 15) faces |= 1 << 0;
        else if (visited[i + 1] === 0) { visited[i + 1] = 1; queue[tail++] = i + 1; }
        if (x === 0) faces |= 1 << 1;
        else if (visited[i - 1] === 0) { visited[i - 1] = 1; queue[tail++] = i - 1; }
        if (y === 15) faces |= 1 << 2;
        else if (visited[i + 256] === 0) { visited[i + 256] = 1; queue[tail++] = i + 256; }
        if (y === 0) faces |= 1 << 3;
        else if (visited[i - 256] === 0) { visited[i - 256] = 1; queue[tail++] = i - 256; }
        if (z === 15) faces |= 1 << 4;
        else if (visited[i + 16] === 0) { visited[i + 16] = 1; queue[tail++] = i + 16; }
        if (z === 0) faces |= 1 << 5;
        else if (visited[i - 16] === 0) { visited[i - 16] = 1; queue[tail++] = i - 16; }
      }

      for (let a = 0; a < 6; a++) {
        if ((faces & (1 << a)) === 0) continue;
        for (let b = a + 1; b < 6; b++) {
          if ((faces & (1 << b)) !== 0) vis |= 1 << VIS_PAIR[a * 6 + b];
        }
      }
      if (vis === VIS_ALL) return vis;
    }
    return vis;
  }
}

/** Índice interior (ordem Y-Z-X, 0..4095) → índice na vizinhança 18³. */
function nbOf(i: number): number {
  return ((i >> 8) + 1) * NB_PLANE + (((i >> 4) & 15) + 1) * NB_SIDE + (i & 15) + 1;
}
