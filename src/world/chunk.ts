/**
 * Armazenamento de voxels com paleta (doc 01 §3.2).
 *
 * A maioria das sections tem menos de 16 blocos distintos, então guardar
 * `uint16` por voxel desperdiça ~75% da memória. Aqui cada section guarda uma
 * paleta local e empacota os índices em 1, 2, 4, 8 ou 16 bits, crescendo só
 * quando a paleta estoura.
 *
 * Section 100% ar → `data = null`. Economiza ~70% da memória do mundo e permite
 * pular meshing e render de graça.
 */

import { AIR } from '../data/blocks';

export const SECTION_SIZE = 16;
export const SECTION_VOLUME = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE; // 4096
export const WORLD_HEIGHT = 128;
export const SECTIONS_PER_COLUMN = WORLD_HEIGHT / SECTION_SIZE; // 8
export const SEA_LEVEL = 63;

export type BitsPerBlock = 1 | 2 | 4 | 8 | 16;

/** Índice linear dentro da section. Ordem Y-Z-X (varredura por camadas). */
export function sectionIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

export class ChunkSection {
  /** índice local → blockState global. */
  palette: Uint16Array;
  paletteLen: number;
  bits: BitsPerBlock;
  /** 4096 voxels empacotados; `null` = section 100% ar. */
  data: Uint8Array | Uint16Array | null;
  /** 0 → section vazia: pula meshing e render. */
  nonAirCount = 0;
  /** Luz de bloco e do céu, um nibble por voxel (2048 bytes cada). */
  blockLight: Uint8Array | null = null;
  skyLight: Uint8Array | null = null;

  constructor() {
    this.palette = new Uint16Array(4);
    this.palette[0] = AIR;
    this.paletteLen = 1;
    this.bits = 1;
    this.data = null;
  }

  get isEmpty(): boolean {
    return this.nonAirCount === 0;
  }

  get(x: number, y: number, z: number): number {
    const data = this.data;
    if (data === null) return AIR;
    return this.palette[readPacked(data, this.bits, sectionIndex(x, y, z))];
  }

  getByIndex(index: number): number {
    const data = this.data;
    if (data === null) return AIR;
    return this.palette[readPacked(data, this.bits, index)];
  }

  set(x: number, y: number, z: number, state: number): void {
    this.setByIndex(sectionIndex(x, y, z), state);
  }

  setByIndex(index: number, state: number): void {
    if (this.data === null) {
      if (state === AIR) return; // continua sendo a section vazia
      this.allocate();
    }

    const previous = this.palette[
      readPacked(this.data as Uint8Array | Uint16Array, this.bits, index)
    ];
    if (previous === state) return;

    // `indexOfState` pode chamar `growBits`, que **troca** `this.data` e
    // `this.bits`. Reler os dois depois não é preciosismo: guardar o array
    // antes fazia a escrita cair no buffer descartado, e o bloco simplesmente
    // não aparecia — silenciosamente, e só no voxel que estourava a paleta.
    const paletteIndex = this.indexOfState(state);
    writePacked(this.data as Uint8Array | Uint16Array, this.bits, index, paletteIndex);

    if (previous === AIR && state !== AIR) this.nonAirCount++;
    else if (previous !== AIR && state === AIR) this.nonAirCount--;
  }

  /** Acha o estado na paleta, acrescentando (e crescendo os bits) se preciso. */
  private indexOfState(state: number): number {
    const palette = this.palette;
    for (let i = 0; i < this.paletteLen; i++) {
      if (palette[i] === state) return i;
    }
    if (this.paletteLen === this.palette.length) {
      const next = new Uint16Array(Math.min(65536, this.palette.length * 2));
      next.set(this.palette);
      this.palette = next;
    }
    const index = this.paletteLen++;
    this.palette[index] = state;
    if (index >= (1 << this.bits)) this.growBits();
    return index;
  }

  /** Sobe para o próximo tamanho de palavra, reescrevendo os 4096 voxels. */
  private growBits(): void {
    const oldBits = this.bits;
    const oldData = this.data as Uint8Array | Uint16Array;
    const newBits: BitsPerBlock =
      oldBits === 1 ? 2 : oldBits === 2 ? 4 : oldBits === 4 ? 8 : 16;
    const newData = newBits === 16 ? new Uint16Array(SECTION_VOLUME) : new Uint8Array(packedLength(newBits));

    for (let i = 0; i < SECTION_VOLUME; i++) {
      writePacked(newData, newBits, i, readPacked(oldData, oldBits, i));
    }
    this.bits = newBits;
    this.data = newData;
  }

  private allocate(): void {
    this.bits = 1;
    this.data = new Uint8Array(packedLength(1));
  }

  /** Descarta o armazenamento se a section voltou a ser 100% ar. */
  compact(): void {
    if (this.nonAirCount === 0 && this.data !== null) {
      this.data = null;
      this.palette = new Uint16Array(4);
      this.palette[0] = AIR;
      this.paletteLen = 1;
      this.bits = 1;
    }
  }

  /** Preenche a section inteira com um estado — atalho do gerador. */
  fill(state: number): void {
    if (state === AIR) {
      this.nonAirCount = 0;
      this.compact();
      return;
    }
    this.allocate();
    this.palette = new Uint16Array(4);
    this.palette[0] = AIR;
    this.palette[1] = state;
    this.paletteLen = 2;
    (this.data as Uint8Array).fill(0xff);
    this.nonAirCount = SECTION_VOLUME;
  }
}

/** Quantos bytes o array empacotado precisa para um dado `bits`. */
export function packedLength(bits: BitsPerBlock): number {
  return bits === 16 ? SECTION_VOLUME : (SECTION_VOLUME * bits) / 8;
}

/** Lê o índice de paleta do voxel `i`. */
export function readPacked(data: Uint8Array | Uint16Array, bits: BitsPerBlock, i: number): number {
  switch (bits) {
    case 16:
      return data[i];
    case 8:
      return data[i];
    case 4:
      return (data[i >> 1] >> ((i & 1) << 2)) & 0xf;
    case 2:
      return (data[i >> 2] >> ((i & 3) << 1)) & 0x3;
    default:
      return (data[i >> 3] >> (i & 7)) & 0x1;
  }
}

/** Escreve o índice de paleta do voxel `i`. */
export function writePacked(
  data: Uint8Array | Uint16Array, bits: BitsPerBlock, i: number, value: number,
): void {
  switch (bits) {
    case 16:
    case 8:
      data[i] = value;
      break;
    case 4: {
      const shift = (i & 1) << 2;
      data[i >> 1] = (data[i >> 1] & ~(0xf << shift)) | ((value & 0xf) << shift);
      break;
    }
    case 2: {
      const shift = (i & 3) << 1;
      data[i >> 2] = (data[i >> 2] & ~(0x3 << shift)) | ((value & 0x3) << shift);
      break;
    }
    default: {
      const shift = i & 7;
      data[i >> 3] = (data[i >> 3] & ~(1 << shift)) | ((value & 1) << shift);
      break;
    }
  }
}

/** Estados possíveis de um chunk no pipeline (doc 02 §5.4). */
export const enum ChunkState {
  Empty = 0,
  Generating = 1,
  Generated = 2,
  Meshing = 3,
  Ready = 4,
}

/** Coluna de 16 × 128 × 16, dividida em 8 sections. */
/**
 * Um marco de estrutura dentro do chunk (doc 03 §7).
 * `data` é o nome da tabela de loot, ou o do mob, conforme o `kind`.
 */
export interface StructureMark {
  kind: 'chest' | 'spawner' | 'mob';
  x: number;
  y: number;
  z: number;
  data: string;
}

export class ChunkColumn {
  readonly cx: number;
  readonly cz: number;
  readonly sections: ChunkSection[] = [];
  /** Altura do bloco mais alto não-ar por coluna (16×16) — acelera skylight. */
  readonly heightMap = new Uint8Array(SECTION_SIZE * SECTION_SIZE);
  /** Bioma por coluna (16×16). */
  readonly biomeMap = new Uint8Array(SECTION_SIZE * SECTION_SIZE);

  state: ChunkState = ChunkState.Empty;
  /** Sections que precisam ser re-meshadas. */
  dirty = true;
  /** true = tem edição do jogador e precisa ir para o IndexedDB (M4). */
  modified = false;
  /**
   * Marcos deixados pelas estruturas: baú com loot, gerador de monstros,
   * aldeão a nascer (M6). Não vão para o save — quem consome é a `Session`,
   * uma vez, quando o chunk entra; o que sobrevive dali em diante é o tile
   * entity ou o mob de verdade.
   */
  structures: StructureMark[] = [];

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    for (let i = 0; i < SECTIONS_PER_COLUMN; i++) this.sections.push(new ChunkSection());
  }

  /** `y` global em 0..127. Fora disso devolve ar. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return AIR;
    return this.sections[y >> 4].get(x, y & 15, z);
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.sections[y >> 4].set(x, y & 15, z, state);
  }

  /** Recalcula o heightmap depois da geração. */
  recomputeHeightMap(): void {
    for (let z = 0; z < SECTION_SIZE; z++) {
      for (let x = 0; x < SECTION_SIZE; x++) {
        let h = 0;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          if (this.getBlock(x, y, z) !== AIR) { h = y; break; }
        }
        this.heightMap[(z << 4) | x] = h;
      }
    }
  }

  /** Soma de voxels não-ar, para o overlay de debug. */
  get nonAirCount(): number {
    let total = 0;
    for (let i = 0; i < this.sections.length; i++) total += this.sections[i].nonAirCount;
    return total;
  }
}

/**
 * Chave numérica de chunk. Usa 21 bits com sinal por eixo — cobre ±1.048.576
 * chunks, muito além do limite horizontal do mundo, e evita chave string
 * (alocar string por lookup no loop de render é proibido pelo doc 02 §5.5).
 */
export function chunkKey(cx: number, cz: number): number {
  return (cx & 0x3fffff) * 0x400000 + (cz & 0x3fffff);
}
