/**
 * Pathfinding A* com **orçamento duro** (doc 07 §3).
 *
 * O limite não é detalhe de implementação, é o requisito: 200 nós expandidos
 * por requisição e no máximo 2 requisições por tick no mundo inteiro, em fila
 * round-robin. Quando estoura, quem resolve é o steering do `MobStore` — e,
 * como diz o doc, ele já dá conta de ~80% dos casos praticamente de graça.
 *
 * Nada aqui aloca durante a busca: nós, heap e tabela de hash são
 * pré-alocados, e a tabela é invalidada por "geração" em vez de ser limpa.
 */

import { defOf } from '../../data/blocks';
import { WORLD_HEIGHT } from '../../world/chunk';
import type { World } from '../../world/world';

/** Nós expandidos por requisição (doc 07 §3). */
export const NODE_BUDGET = 200;
/** Requisições atendidas por tick, no mundo todo. */
export const REQUESTS_PER_TICK = 2;
/** Raio máximo de busca, em blocos. Fora disso é trabalho jogado fora. */
const MAX_RADIUS = 32;

const MAX_NODES = 512;
const HASH_SIZE = 2048;
const HASH_MASK = HASH_SIZE - 1;

/** Vizinhança: 8 horizontais (4 retas + 4 diagonais), com subida/descida. */
const NEIGHBORS: readonly number[] = [
  1, 0, -1, 0, 0, 1, 0, -1,
  1, 1, 1, -1, -1, 1, -1, -1,
];

export class Pathfinder {
  private readonly nodeX = new Int32Array(MAX_NODES);
  private readonly nodeY = new Int32Array(MAX_NODES);
  private readonly nodeZ = new Int32Array(MAX_NODES);
  private readonly gScore = new Float32Array(MAX_NODES);
  private readonly fScore = new Float32Array(MAX_NODES);
  private readonly parent = new Int32Array(MAX_NODES);
  private readonly closed = new Uint8Array(MAX_NODES);

  private readonly heap = new Int32Array(MAX_NODES);
  private heapSize = 0;
  private nodeCount = 0;

  /** Tabela chave→nó, invalidada por geração (limpar 2048 slots por busca é caro). */
  private readonly hashKey = new Int32Array(HASH_SIZE);
  private readonly hashNode = new Int32Array(HASH_SIZE);
  private readonly hashGen = new Int32Array(HASH_SIZE);
  private generation = 0;

  /** Saída da última busca: posições do caminho, do início ao fim. */
  readonly outX = new Int16Array(64);
  readonly outY = new Int16Array(64);
  readonly outZ = new Int16Array(64);
  outLength = 0;

  /** Nós expandidos na última busca — o debug mostra isso. */
  expanded = 0;

  /**
   * Procura um caminho de `(sx,sy,sz)` até `(gx,gy,gz)` para uma entidade de
   * `height` blocos. Devolve true se chegou (ou chegou perto o bastante).
   */
  find(
    world: World,
    sx: number, sy: number, sz: number,
    gx: number, gy: number, gz: number,
    height: number,
    maxNodes = NODE_BUDGET,
  ): boolean {
    this.outLength = 0;
    this.expanded = 0;
    this.heapSize = 0;
    this.nodeCount = 0;
    this.generation++;

    const tall = Math.max(1, Math.ceil(height));
    if (!inRange(sx, sz, gx, gz)) return false;

    const start = this.addNode(sx, sy, sz, 0, heuristic(sx, sy, sz, gx, gy, gz), -1);
    if (start < 0) return false;
    this.push(start);

    let best = start;
    let bestH = this.fScore[start];

    while (this.heapSize > 0 && this.expanded < maxNodes) {
      const current = this.pop();
      if (this.closed[current] === 1) continue;
      this.closed[current] = 1;
      this.expanded++;

      const cx = this.nodeX[current];
      const cy = this.nodeY[current];
      const cz = this.nodeZ[current];

      if (cx === gx && cz === gz && Math.abs(cy - gy) <= 1) {
        this.buildPath(current);
        return true;
      }

      const h = heuristic(cx, cy, cz, gx, gy, gz);
      if (h < bestH) { bestH = h; best = current; }

      for (let n = 0; n < NEIGHBORS.length; n += 2) {
        const dx = NEIGHBORS[n];
        const dz = NEIGHBORS[n + 1];
        const nx = cx + dx;
        const nz = cz + dz;
        if (!inRange(sx, sz, nx, nz)) continue;

        // Diagonal só passa se os dois lados retos também passam — senão o mob
        // "corta" quinas e fica preso na parede.
        if (dx !== 0 && dz !== 0) {
          if (standHeight(world, cx + dx, cy, cz, tall) < 0) continue;
          if (standHeight(world, cx, cy, cz + dz, tall) < 0) continue;
        }

        const ny = standHeight(world, nx, cy, nz, tall);
        if (ny < 0) continue;

        const step = dx !== 0 && dz !== 0 ? 1.41 : 1;
        const climb = ny > cy ? 0.5 : 0;
        const penalty = hazardPenalty(world, nx, ny, nz);
        if (penalty < 0) continue;
        const g = this.gScore[current] + step + climb + penalty;

        const existing = this.lookup(sx, sz, nx, ny, nz);
        if (existing >= 0) {
          if (g >= this.gScore[existing]) continue;
          this.gScore[existing] = g;
          this.fScore[existing] = g + heuristic(nx, ny, nz, gx, gy, gz);
          this.parent[existing] = current;
          this.closed[existing] = 0;
          this.push(existing);
          continue;
        }

        const node = this.addNode(nx, ny, nz, g, g + heuristic(nx, ny, nz, gx, gy, gz), current);
        if (node < 0) break; // pool cheio: o que já houver vira o melhor esforço
        this.store(sx, sz, nx, ny, nz, node);
        this.push(node);
      }
    }

    // Estourou o orçamento: entrega o caminho parcial até o nó mais próximo.
    // É melhor que nada — o mob anda na direção certa e pede outro caminho.
    if (best !== start) {
      this.buildPath(best);
      return this.outLength > 1;
    }
    return false;
  }

  private addNode(
    x: number, y: number, z: number, g: number, f: number, parent: number,
  ): number {
    if (this.nodeCount >= MAX_NODES) return -1;
    const i = this.nodeCount++;
    this.nodeX[i] = x; this.nodeY[i] = y; this.nodeZ[i] = z;
    this.gScore[i] = g;
    this.fScore[i] = f;
    this.parent[i] = parent;
    this.closed[i] = 0;
    return i;
  }

  private buildPath(node: number): void {
    // Conta primeiro, depois escreve de trás para a frente: sem array temporário.
    let length = 0;
    for (let n = node; n >= 0; n = this.parent[n]) length++;
    const max = this.outX.length;
    if (length > max) {
      // Caminho longo demais: guarda só o começo, que é o que vai ser andado
      // antes do próximo recálculo.
      let skip = length - max;
      for (let n = node; n >= 0 && skip > 0; n = this.parent[n]) { node = n; skip--; }
      length = max;
    }
    this.outLength = length;
    let i = length - 1;
    for (let n = node; n >= 0 && i >= 0; n = this.parent[n], i--) {
      this.outX[i] = this.nodeX[n];
      this.outY[i] = this.nodeY[n];
      this.outZ[i] = this.nodeZ[n];
    }
  }

  // --- heap binário ---------------------------------------------------------

  private push(node: number): void {
    if (this.heapSize >= MAX_NODES) return;
    let i = this.heapSize++;
    this.heap[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.fScore[this.heap[parent]] <= this.fScore[this.heap[i]]) break;
      const tmp = this.heap[parent];
      this.heap[parent] = this.heap[i];
      this.heap[i] = tmp;
      i = parent;
    }
  }

  private pop(): number {
    const top = this.heap[0];
    const last = --this.heapSize;
    this.heap[0] = this.heap[last];
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let best = i;
      if (left < last && this.fScore[this.heap[left]] < this.fScore[this.heap[best]]) best = left;
      if (right < last && this.fScore[this.heap[right]] < this.fScore[this.heap[best]]) best = right;
      if (best === i) break;
      const tmp = this.heap[best];
      this.heap[best] = this.heap[i];
      this.heap[i] = tmp;
      i = best;
    }
    return top;
  }

  // --- tabela de hash aberta ------------------------------------------------

  private lookup(sx: number, sz: number, x: number, y: number, z: number): number {
    const key = packKey(sx, sz, x, y, z);
    let slot = hashOf(key);
    for (let probe = 0; probe < 32; probe++) {
      if (this.hashGen[slot] !== this.generation) return -1;
      if (this.hashKey[slot] === key) return this.hashNode[slot];
      slot = (slot + 1) & HASH_MASK;
    }
    return -1;
  }

  private store(sx: number, sz: number, x: number, y: number, z: number, node: number): void {
    const key = packKey(sx, sz, x, y, z);
    let slot = hashOf(key);
    for (let probe = 0; probe < 32; probe++) {
      if (this.hashGen[slot] !== this.generation || this.hashKey[slot] === key) {
        this.hashGen[slot] = this.generation;
        this.hashKey[slot] = key;
        this.hashNode[slot] = node;
        return;
      }
      slot = (slot + 1) & HASH_MASK;
    }
  }
}

function inRange(sx: number, sz: number, x: number, z: number): boolean {
  return Math.abs(x - sx) <= MAX_RADIUS && Math.abs(z - sz) <= MAX_RADIUS;
}

function heuristic(x: number, y: number, z: number, gx: number, gy: number, gz: number): number {
  const dx = x - gx;
  const dy = y - gy;
  const dz = z - gz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function packKey(sx: number, sz: number, x: number, y: number, z: number): number {
  const dx = x - sx + 64;
  const dz = z - sz + 64;
  return ((dx & 0xff) << 15) | ((dz & 0xff) << 7) | (y & 0x7f);
}

function hashOf(key: number): number {
  let h = Math.imul(key, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  return h & HASH_MASK;
}

/**
 * Altura em que uma entidade de `tall` blocos consegue ficar em pé na coluna
 * `(x,·,z)`, partindo de `fromY`. Devolve −1 se não dá.
 *
 * Aceita subir 1 bloco (degrau) ou cair até 3 (queda sem dano). Porta é
 * passagem, aberta ou fechada.
 */
export function standHeight(
  world: World, x: number, fromY: number, z: number, tall: number,
): number {
  for (let y = fromY + 1; y >= fromY - 3; y--) {
    if (y < 1 || y + tall >= WORLD_HEIGHT) continue;
    if (!defOf(world.getBlock(x, y - 1, z)).solid) continue;
    let free = true;
    for (let h = 0; h < tall; h++) {
      const def = defOf(world.getBlock(x, y + h, z));
      // Porta conta como passagem (M9): o aldeão abre a de casa, e o zumbi
      // para diante dela — que é onde ele deveria parar, arrombando no Difícil.
      if (def.solid && def.shape !== 'door') { free = false; break; }
    }
    if (free) return y;
  }
  return -1;
}

/**
 * Custo extra de pisar num bloco perigoso; −1 = intransitável.
 * Água custa caro mas passa; lava e cacto não.
 *
 * Olha também o **chão**, e não só o bloco dos pés: o cacto é sólido, então
 * `standHeight` o aceitava como degrau, e o caminho subia em cima dele — o
 * aldeão "trancava" no cacto tentando escalá-lo (campo, 2026-09-23). Cerca e
 * portão têm 1,5 de altura: o pulo não alcança o topo, e o degrau é mentira.
 */
function hazardPenalty(world: World, x: number, y: number, z: number): number {
  const def = defOf(world.getBlock(x, y, z));
  if (def.name === 'lava' || def.name === 'cactus') return -1;
  const ground = defOf(world.getBlock(x, y - 1, z));
  if (ground.name === 'cactus' || ground.name === 'lava' || ground.name === 'magma_block') return -1;
  if (ground.shape === 'fence' || ground.shape === 'fence_gate') return -1;
  if (def.name === 'water') return 4;
  return 0;
}
