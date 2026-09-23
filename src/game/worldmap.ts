/**
 * Mapa explorado (M10): o que o jogador já viu da superfície, visto de cima.
 *
 * **Um mapa por mundo, e não por item.** No original cada folha de mapa é um
 * recorte fixo; aqui o mundo guarda o que foi explorado, e o item `map` é a
 * forma de olhar para isso (`ui/screens/mapscreen.ts`). É o que o critério do
 * doc 14 pede — sair 500 blocos e voltar pelo mapa — sem o jogador precisar
 * montar um mosaico de folhas.
 *
 * **Como enche.** A cada dois ticks (`game/journal.ts`), um chunk do quadrado
 * de `EXPLORE_RADIUS` em volta do jogador é lido, na ordem do mais perto para o
 * mais longe; o anel inteiro (81 chunks) se renova a cada ~8 s, e o que o
 * jogador construir aparece na volta seguinte. Só na dimensão com céu: o
 * Nether, visto de cima, é o teto de rocha-mãe.
 *
 * **O pixel.** Um por coluna de bloco, 16 bits: bit 15 = explorado; bits 10–11
 * = sombra (0 escuro, 1 normal, 2 claro); bits 0–9 = id do bloco do topo. A cor
 * sai do bloco na hora de desenhar (`render/mapcolors.ts`), então o mapa segue
 * o pacote de texturas. A sombra é a do original: mais alto que o vizinho do
 * norte, claro; mais baixo, escuro; na água, a profundidade.
 *
 * **Quanto pesa.** Regiões de 128×128 colunas, 32 KB cada, no máximo
 * `MAP_MAX_REGIONS` (64: um quadrado de 1024 blocos de lado, 2 MB) — passou
 * disso, a região mais longe do jogador é esquecida. No save cada região vai
 * comprimida por carreira (`encodeRegion`), e só a que mudou é regravada.
 */

import { WATER, blockIdOf, defOf } from '../data/blocks';
import { SECTION_SIZE, type ChunkColumn } from '../world/chunk';
import type { World } from '../world/world';

/** Lado da região, em blocos. */
export const MAP_REGION = 128;
const REGION_SHIFT = 7;
const REGION_MASK = MAP_REGION - 1;
const REGION_AREA = MAP_REGION * MAP_REGION;
/** Teto de regiões guardadas: o save do mapa não cresce sem limite (doc 14, M10). */
export const MAP_MAX_REGIONS = 64;
/** Raio, em chunks, do que o jogador enxerga para o mapa. */
export const EXPLORE_RADIUS = 4;

export const PIXEL_KNOWN = 0x8000;
const SHADE_SHIFT = 10;
const ID_MASK = 0x3ff;
/** Degraus de planta, flor e tocha até achar o chão de verdade. */
const MAX_SKIP = 4;
/** Profundidade máxima de água que ainda muda a sombra. */
const MAX_DEPTH = 8;

/** Chave numérica de região: cabe ±32768 regiões por eixo (±4 milhões de blocos). */
export function regionKey(rx: number, rz: number): number {
  return (rx + 32768) * 65536 + (rz + 32768);
}

export function regionOfKey(key: number): [number, number] {
  return [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];
}

export function shadeOf(pixel: number): number {
  return (pixel >> SHADE_SHIFT) & 3;
}

export function blockOfPixel(pixel: number): number {
  return pixel & ID_MASK;
}

/** Deslocamentos de chunk do anel, do centro para fora. */
const OFFSETS: readonly (readonly [number, number])[] = buildOffsets();

function buildOffsets(): [number, number][] {
  const out: [number, number][] = [];
  for (let dz = -EXPLORE_RADIUS; dz <= EXPLORE_RADIUS; dz++) {
    for (let dx = -EXPLORE_RADIUS; dx <= EXPLORE_RADIUS; dx++) out.push([dx, dz]);
  }
  out.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));
  return out;
}

export class WorldMap {
  /** Regiões por `regionKey`. */
  readonly regions = new Map<number, Uint16Array>();
  /** Regiões que mudaram desde o último save. */
  readonly dirty = new Set<number>();
  /** Regiões esquecidas pelo teto, para o save apagá-las. */
  readonly forgotten = new Set<number>();
  private cursor = 0;
  /** Altura do topo na linha anterior do chunk (a sombra compara com o norte). */
  private readonly northY = new Int16Array(SECTION_SIZE);

  /** Pixel explorado em `(x, z)`, ou 0 se ninguém passou por lá. */
  pixel(x: number, z: number): number {
    const region = this.regions.get(regionKey(x >> REGION_SHIFT, z >> REGION_SHIFT));
    if (region === undefined) return 0;
    return region[((z & REGION_MASK) << REGION_SHIFT) | (x & REGION_MASK)];
  }

  /**
   * Um passo de exploração: lê um chunk do anel em volta de `(px, pz)`.
   * Devolve true se leu um chunk (false se o da vez não está carregado).
   */
  explore(world: World, px: number, pz: number): boolean {
    const offset = OFFSETS[this.cursor];
    this.cursor = (this.cursor + 1) % OFFSETS.length;
    const chunk = world.getChunk((Math.floor(px) >> 4) + offset[0], (Math.floor(pz) >> 4) + offset[1]);
    if (chunk === undefined) return false;
    this.sampleChunk(world, chunk, px, pz);
    return true;
  }

  /** Passa o chunk inteiro para o mapa. */
  sampleChunk(world: World, chunk: ChunkColumn, px = 0, pz = 0): void {
    const baseX = chunk.cx * SECTION_SIZE;
    const baseZ = chunk.cz * SECTION_SIZE;
    const region = this.region(baseX >> REGION_SHIFT, baseZ >> REGION_SHIFT, px, pz);
    const north = world.getChunk(chunk.cx, chunk.cz - 1);
    let changed = false;

    for (let lz = 0; lz < SECTION_SIZE; lz++) {
      for (let lx = 0; lx < SECTION_SIZE; lx++) {
        let y = chunk.heightMap[(lz << 4) | lx];
        let state = chunk.getBlock(lx, y, lz);
        // Flor, capim, tocha e trilho não são o chão.
        for (let skip = 0; skip < MAX_SKIP && y > 0; skip++) {
          const def = defOf(state);
          if (def.solid || def.shape === 'liquid') break;
          y--;
          state = chunk.getBlock(lx, y, lz);
        }

        let shade: number;
        const id = blockIdOf(state);
        if (id === WATER) {
          let depth = 0;
          while (depth < MAX_DEPTH && y - depth > 0
            && blockIdOf(chunk.getBlock(lx, y - depth - 1, lz)) === WATER) depth++;
          shade = depth <= 1 ? 2 : depth <= 4 ? 1 : 0;
        } else {
          const northY = lz > 0 ? this.northY[lx]
            : north !== undefined ? north.heightMap[(15 << 4) | lx] : y;
          shade = y > northY ? 2 : y < northY ? 0 : 1;
        }
        this.northY[lx] = y;

        const pixel = PIXEL_KNOWN | (shade << SHADE_SHIFT) | (id & ID_MASK);
        const at = (((baseZ + lz) & REGION_MASK) << REGION_SHIFT) | ((baseX + lx) & REGION_MASK);
        if (region[at] !== pixel) {
          region[at] = pixel;
          changed = true;
        }
      }
    }
    if (changed) this.dirty.add(regionKey(baseX >> REGION_SHIFT, baseZ >> REGION_SHIFT));
  }

  /** Região `(rx, rz)`, criada na hora; o teto esquece a mais longe de `(px, pz)`. */
  private region(rx: number, rz: number, px: number, pz: number): Uint16Array {
    const key = regionKey(rx, rz);
    let region = this.regions.get(key);
    if (region !== undefined) return region;
    if (this.regions.size >= MAP_MAX_REGIONS) this.forgetFarthest(px, pz);
    region = new Uint16Array(REGION_AREA);
    this.regions.set(key, region);
    this.forgotten.delete(key);
    return region;
  }

  private forgetFarthest(px: number, pz: number): void {
    let far = -1;
    let farDistance = -1;
    for (const key of this.regions.keys()) {
      const [rx, rz] = regionOfKey(key);
      const cx = rx * MAP_REGION + MAP_REGION / 2;
      const cz = rz * MAP_REGION + MAP_REGION / 2;
      const distance = (cx - px) ** 2 + (cz - pz) ** 2;
      if (distance > farDistance) { farDistance = distance; far = key; }
    }
    if (far < 0) return;
    this.regions.delete(far);
    this.dirty.delete(far);
    this.forgotten.add(far);
  }

  /** Troca tudo pelo que veio do save. */
  load(entries: Iterable<readonly [number, Uint8Array]>): void {
    this.regions.clear();
    this.dirty.clear();
    this.forgotten.clear();
    for (const [key, bytes] of entries) {
      const region = decodeRegion(bytes);
      if (region !== null && this.regions.size < MAP_MAX_REGIONS) this.regions.set(key, region);
    }
  }
}

/**
 * Comprime uma região por carreira: pares `[repetições, pixel]` de 16 bits.
 * Campo, mar e o que não foi explorado são carreiras longas; 32 KB viram
 * poucos KB.
 */
export function encodeRegion(region: Uint16Array): Uint8Array {
  const out = new Uint16Array(region.length * 2);
  let n = 0;
  let i = 0;
  while (i < region.length) {
    const value = region[i];
    let run = 1;
    while (i + run < region.length && region[i + run] === value && run < 0xffff) run++;
    out[n++] = run;
    out[n++] = value;
    i += run;
  }
  return new Uint8Array(out.buffer.slice(0, n * 2));
}

/** O inverso de `encodeRegion`; `null` se os bytes não fecham uma região. */
export function decodeRegion(bytes: Uint8Array): Uint16Array | null {
  if (bytes.byteLength % 4 !== 0) return null;
  const pairs = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const region = new Uint16Array(REGION_AREA);
  let at = 0;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const run = pairs[i];
    if (at + run > REGION_AREA) return null;
    region.fill(pairs[i + 1], at, at + run);
    at += run;
  }
  return at === REGION_AREA ? region : null;
}
