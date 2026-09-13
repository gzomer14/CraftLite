/**
 * O mundo: mapa de chunks carregados e o **único** caminho de mutação de voxel.
 *
 * Regra de código nº 3 do projeto: toda mudança passa por `setBlock(...,source)`.
 * Nada escreve direto no array de voxels a partir da UI ou da física — é isso
 * que permite plugar rede depois (doc 12 §1) sem reescrever o jogo.
 */

import { AIR } from '../data/blocks';
import { DIM_OVERWORLD, dimensionOf, type DimensionDef } from '../data/dimensions';
import {
  ChunkColumn, SECTION_SIZE, SECTIONS_PER_COLUMN, WORLD_HEIGHT, chunkKey,
} from './chunk';

/** Quem originou a mudança — a rede vai precisar distinguir isso. */
export type BlockSource = 'gen' | 'player' | 'physics' | 'network';

export interface BlockChange {
  x: number; y: number; z: number;
  previous: number;
  state: number;
  source: BlockSource;
}

export class World {
  readonly seed: number;
  /**
   * Dimensão carregada agora (`DIM_*` de `data/dimensions.ts`).
   *
   * **Só existe uma por vez**, e trocar não é um detalhe de renderização:
   * atravessar o portal grava o que está sujo, descarrega tudo e recarrega do
   * outro lado (ver `game/travel.ts`). Num aparelho de 2 GB, manter as duas na
   * memória dobraria voxel, luz e malha sem nada na tela para mostrar.
   */
  dimension = DIM_OVERWORLD;
  private readonly chunks = new Map<number, ChunkColumn>();
  /** Sections marcadas para re-meshing, como chaves `key*8+sy`. */
  private readonly dirtySections = new Set<number>();
  private readonly listeners: ((change: BlockChange) => void)[] = [];
  /** Nível de reentrância do evento de mudança de bloco. */
  private depth = 0;

  constructor(seed: number) {
    this.seed = seed;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Definição da dimensão atual — quem pergunta "tem céu?" pergunta aqui. */
  get dimensionDef(): DimensionDef {
    return dimensionOf(this.dimension);
  }

  /**
   * Esvazia o mundo para receber outra dimensão.
   *
   * Devolve as colunas removidas para quem precisa descarregá-las em ordem
   * (gravar o que está sujo, soltar a malha da GPU). Não avisa os ouvintes de
   * mudança de bloco: não é o mundo mudando, é outro mundo entrando.
   */
  takeAllChunks(out: ChunkColumn[]): number {
    let n = 0;
    for (const chunk of this.chunks.values()) out[n++] = chunk;
    this.chunks.clear();
    this.dirtySections.clear();
    return n;
  }

  getChunk(cx: number, cz: number): ChunkColumn | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Cria a coluna se ainda não existir. */
  ensureChunk(cx: number, cz: number): ChunkColumn {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk === undefined) {
      chunk = new ChunkColumn(cx, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  addChunk(chunk: ChunkColumn): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  removeChunk(cx: number, cz: number): ChunkColumn | undefined {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (chunk !== undefined) this.chunks.delete(key);
    return chunk;
  }

  /** Itera as colunas carregadas sem alocar array intermediário. */
  forEachChunk(fn: (chunk: ChunkColumn) => void): void {
    for (const chunk of this.chunks.values()) fn(chunk);
  }

  /** Coordenadas globais. Fora do mundo carregado devolve ar. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (chunk === undefined) return AIR;
    return chunk.getBlock(x & 15, y, z & 15);
  }

  /** true se o chunk que contém `(x,z)` está carregado. */
  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(x >> 4, z >> 4));
  }

  /**
   * Único ponto de mutação. Marca as sections afetadas como sujas — inclusive
   * as vizinhas, quando o bloco fica na borda, porque a face delas muda.
   */
  setBlock(x: number, y: number, z: number, state: number, source: BlockSource): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk === undefined) return false;

    const lx = x & 15;
    const lz = z & 15;
    const previous = chunk.getBlock(lx, y, lz);
    if (previous === state) return false;

    chunk.setBlock(lx, y, lz, state);
    if (source !== 'gen') chunk.modified = true;

    this.markDirty(cx, cz, y >> 4);
    // Bordas: a face do vizinho pode ter aparecido ou sumido.
    if (lx === 0) this.markDirty(cx - 1, cz, y >> 4);
    if (lx === 15) this.markDirty(cx + 1, cz, y >> 4);
    if (lz === 0) this.markDirty(cx, cz - 1, y >> 4);
    if (lz === 15) this.markDirty(cx, cz + 1, y >> 4);
    if ((y & 15) === 0) this.markDirty(cx, cz, (y >> 4) - 1);
    if ((y & 15) === 15) this.markDirty(cx, cz, (y >> 4) + 1);

    if (this.listeners.length > 0) this.notify(x, y, z, previous, state, source);
    return true;
  }

  /**
   * Avisa os ouvintes reusando um objeto por **nível de reentrância**.
   *
   * Um ouvinte pode chamar `setBlock` de dentro do próprio evento — o
   * crescimento faz isso para arrancar a plantação que ficou sem chão. Com um
   * único objeto compartilhado, a chamada de dentro sobrescreveria os campos e
   * os ouvintes seguintes do evento de fora receberiam a mudança errada.
   */
  private notify(
    x: number, y: number, z: number,
    previous: number, state: number, source: BlockSource,
  ): void {
    const change = CHANGES[Math.min(this.depth, CHANGES.length - 1)];
    this.depth++;
    change.x = x; change.y = y; change.z = z;
    change.previous = previous; change.state = state; change.source = source;
    // A lista pode crescer durante o laço; `length` é lido a cada volta.
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](change);
    this.depth--;
  }

  onBlockChange(fn: (change: BlockChange) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  markDirty(cx: number, cz: number, sy: number): void {
    if (sy < 0 || sy >= SECTIONS_PER_COLUMN) return;
    if (!this.chunks.has(chunkKey(cx, cz))) return;
    this.dirtySections.add(chunkKey(cx, cz) * SECTIONS_PER_COLUMN + sy);
  }

  /** Consome a lista de sections sujas; o chamador re-mesha. */
  takeDirtySections(out: number[]): number {
    let n = 0;
    for (const key of this.dirtySections) out[n++] = key;
    this.dirtySections.clear();
    return n;
  }

  get dirtyCount(): number {
    return this.dirtySections.size;
  }

  // --- luz -----------------------------------------------------------------

  /** Luz de bloco (0..15) em coordenadas globais. Fora do mundo carregado = 0. */
  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (chunk === undefined) return 0;
    const section = chunk.sections[y >> 4];
    if (section.blockLight === null) return 0;
    return readNibble(section.blockLight, lightIndex(x & 15, y & 15, z & 15));
  }

  /**
   * Luz do céu (0..15). Acima do topo do mundo é sempre 15, e chunk não
   * carregado responde 15 também: escurecer a borda do mundo carregado criaria
   * uma parede preta visível ao voar.
   */
  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (chunk === undefined) return 15;
    const section = chunk.sections[y >> 4];
    if (section.skyLight === null) return 15;
    return readNibble(section.skyLight, lightIndex(x & 15, y & 15, z & 15));
  }

  setBlockLight(x: number, y: number, z: number, value: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (chunk === undefined) return;
    const section = chunk.sections[y >> 4];
    if (section.blockLight === null) section.blockLight = new Uint8Array(2048);
    writeNibble(section.blockLight, lightIndex(x & 15, y & 15, z & 15), value);
  }

  setSkyLight(x: number, y: number, z: number, value: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (chunk === undefined) return;
    const section = chunk.sections[y >> 4];
    if (section.skyLight === null) section.skyLight = new Uint8Array(2048);
    writeNibble(section.skyLight, lightIndex(x & 15, y & 15, z & 15), value);
  }

  /**
   * Copia a vizinhança 18×18×18 de uma section (ela + 1 camada de cada lado)
   * para o buffer do worker de meshing (doc 01 §4).
   *
   * Escreve em um buffer pré-alocado: esta função roda a cada re-mesh e não
   * pode alocar.
   */
  copyNeighborhood(cx: number, cz: number, sy: number, out: Uint16Array): void {
    const baseX = cx * SECTION_SIZE - 1;
    const baseY = sy * SECTION_SIZE - 1;
    const baseZ = cz * SECTION_SIZE - 1;

    for (let y = 0; y < 18; y++) {
      const wy = baseY + y;
      if (wy < 0 || wy >= WORLD_HEIGHT) {
        out.fill(AIR, y * 324, (y + 1) * 324);
        continue;
      }
      for (let z = 0; z < 18; z++) {
        const wz = baseZ + z;
        const rowOffset = y * 324 + z * 18;
        for (let x = 0; x < 18; x++) {
          out[rowOffset + x] = this.getBlock(baseX + x, wy, wz);
        }
      }
    }
  }
}

/**
 * Objetos de mudança reusados — emitir um evento não deve alocar. Um por nível
 * de reentrância; quatro níveis são muito mais do que qualquer cadeia real.
 */
const CHANGES: readonly BlockChange[] = [0, 1, 2, 3].map(() => (
  { x: 0, y: 0, z: 0, previous: 0, state: 0, source: 'gen' as BlockSource }
));

/** Índice do voxel dentro da section, na ordem Y-Z-X das arrays de luz. */
function lightIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

export function readNibble(data: Uint8Array, index: number): number {
  const byte = data[index >> 1];
  return (index & 1) === 0 ? byte & 0xf : (byte >> 4) & 0xf;
}

export function writeNibble(data: Uint8Array, index: number, value: number): void {
  const byte = index >> 1;
  if ((index & 1) === 0) data[byte] = (data[byte] & 0xf0) | (value & 0xf);
  else data[byte] = (data[byte] & 0x0f) | ((value & 0xf) << 4);
}
