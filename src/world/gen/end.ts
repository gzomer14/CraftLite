/**
 * Gerador do End (doc 14 — M16): a terceira dimensão.
 *
 * O doc 15 §5 registrou no M7 que o motor já era genérico — "uma terceira
 * dimensão é uma entrada na tabela e um gerador". Este é o gerador: mesmo
 * contrato de `terrain.ts` e `nether.ts` (puro, determinístico, sem `World`).
 *
 * O End é o vazio com **uma ilha**:
 *
 * - a ilha principal, de pedra do End, redonda com a borda recortada por
 *   ruído, abaulada em cima e afinando para baixo como uma pedra flutuante;
 * - **dez colunas de obsidiana** num anel em volta do centro, de alturas e
 *   larguras sorteadas, cada uma com um bloco de rocha-mãe no topo — onde
 *   pousa o cristal que cura o dragão (quem põe o cristal é
 *   `game/dragonfight.ts`, não o gerador: o cristal destruído não pode voltar
 *   quando o chunk é gerado de novo);
 * - o **portal de saída** no centro, apagado: a bacia de rocha-mãe com a
 *   coluna do meio. Ele acende quando o dragão cai.
 *
 * **Desvio consciente:** o gênero tem ilhas menores a mil blocos do centro,
 * com cidades; aqui só há a principal. Elas são exploração depois do fim, e o
 * doc 14 pede o fim.
 *
 * Sem luz do céu: a ambiente da dimensão (`data/dimensions.ts`) é o que
 * ilumina, como no Nether.
 */

import { AIR, BEDROCK, BLOCK_BY_NAME, makeState } from '../../data/blocks';
import { DIM_END, dimensionOf } from '../../data/dimensions';
import { Noise } from '../../core/noise';
import { hash2 } from '../../core/rng';
import { ChunkColumn, SECTION_SIZE } from '../chunk';
import { computeChunkLight } from './terrain';

/** Altura da superfície da ilha no centro, e do piso do portal de saída. */
export const END_ISLAND_Y = 56;
/** Raio médio da ilha; a borda varia `ISLAND_WOBBLE` para dentro e para fora. */
const ISLAND_RADIUS = 80;
const ISLAND_WOBBLE = 12;
/** Espessura da ilha no centro, para baixo da superfície. */
const ISLAND_DEPTH = 40;
/** Raio em volta do portal que fica plano, para o dragão pousar e o jogador lutar. */
const FLAT_RADIUS = 8;

/** Colunas de obsidiana (e cristais). */
export const PILLAR_COUNT = 10;
export const PILLAR_RING = 42;
/** Topo da coluna: de `PILLAR_TOP_MIN` a `+ PILLAR_TOP_SPREAD`. */
const PILLAR_TOP_MIN = END_ISLAND_Y + 20;
const PILLAR_TOP_SPREAD = 27;

/**
 * Chegada do jogador: a plataforma de obsidiana fica no eixo +X, com o centro
 * a `ARRIVAL_GAP` blocos da borda da ilha — um bloco de vazio entre as duas —
 * e o piso na altura do topo da borda (`endArrival`).
 *
 * **Desvio consciente:** o gênero põe a plataforma sempre em (100, 48, 0),
 * abaixo da borda e a uma distância que muda de mundo para mundo. Aqui a borda
 * varia ±12 blocos com a seed, e no celular uma ponte de 20 blocos sobre o
 * vazio é o primeiro passo de muitos até o dragão — e o mais fácil de errar.
 * Um bloco de vão, no mesmo nível: atravessa-se com um pulo.
 */
export const END_SPAWN_Z = 0;
const ARRIVAL_GAP = 4;
/** O limite da busca da borda — nenhuma ilha passa disto. */
const ARRIVAL_MAX_X = ISLAND_RADIUS + ISLAND_WOBBLE + 8;

/** Raio da bacia do portal de saída. */
export const EXIT_RADIUS = 3;

const SALT_EDGE = 31;
const SALT_TOP = 32;
const SALT_PILLAR = 33;

const END_STONE = blockOf('end_stone');
const OBSIDIAN = blockOf('obsidian');
const BEDROCK_STATE = makeState(BEDROCK);

function blockOf(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco do End ausente: ${name}`);
  return makeState(def.id);
}

/** A seed do End é a do mundo embaralhada pelo salt da dimensão. */
export function endSeed(seed: number): number {
  return (seed ^ dimensionOf(DIM_END).salt) >>> 0;
}

/** Ruído do End. Um por worker. */
export class EndNoise {
  readonly edge: Noise;
  readonly top: Noise;

  constructor(seed: number) {
    const salted = endSeed(seed);
    this.edge = new Noise(salted, SALT_EDGE);
    this.top = new Noise(salted, SALT_TOP);
  }
}

/** Uma coluna de obsidiana: centro, raio e topo. */
export interface Pillar {
  x: number;
  z: number;
  radius: number;
  top: number;
}

/**
 * As dez colunas da seed, sempre na mesma ordem (o índice é o do cristal no
 * save da luta). Sem alocação depois da primeira chamada da seed.
 */
export function endPillars(seed: number): readonly Pillar[] {
  if (cachedSeed === seed && cachedPillars !== null) return cachedPillars;
  const out: Pillar[] = [];
  const salted = endSeed(seed);
  for (let i = 0; i < PILLAR_COUNT; i++) {
    const angle = (i * Math.PI * 2) / PILLAR_COUNT;
    const roll = hash2(salted, i, 0, SALT_PILLAR);
    out.push({
      x: Math.round(Math.cos(angle) * PILLAR_RING),
      z: Math.round(Math.sin(angle) * PILLAR_RING),
      radius: 2 + (roll % 3),
      top: PILLAR_TOP_MIN + ((roll >>> 8) % PILLAR_TOP_SPREAD),
    });
  }
  cachedSeed = seed;
  cachedPillars = out;
  return out;
}
let cachedSeed = -1;
let cachedPillars: Pillar[] | null = null;

const BOTTOM = new Int32Array(1);

let arrivalSeed = -1;
let arrivalX = 0;
let arrivalY = 0;

/** Onde o jogador pisa ao chegar: `[x, y]` (z é `END_SPAWN_Z`), pela borda da ilha. */
function computeArrival(seed: number): void {
  if (arrivalSeed === seed) return;
  const noise = new EndNoise(seed);
  let x = ARRIVAL_MAX_X;
  let top = -1;
  while (x > 0 && (top = islandColumn(noise, x, END_SPAWN_Z, BOTTOM)) < 0) x--;
  arrivalSeed = seed;
  arrivalX = x + ARRIVAL_GAP;
  // Os pés sobre o piso da plataforma, que fica na altura do topo da borda.
  arrivalY = top + 1;
}

/** X do centro da plataforma de chegada, para a seed. */
export function endArrivalX(seed: number): number {
  computeArrival(seed);
  return arrivalX;
}

/** Y dos pés de quem chega (o piso da plataforma fica um abaixo). */
export function endArrivalY(seed: number): number {
  computeArrival(seed);
  return arrivalY;
}

/** Superfície da ilha na coluna, ou −1 se é vazio. `out[0]` recebe o fundo. */
function islandColumn(noise: EndNoise, x: number, z: number, out: Int32Array): number {
  const distance = Math.hypot(x, z);
  const edge = ISLAND_RADIUS + ISLAND_WOBBLE * noise.edge.noise2(x / 40, z / 40);
  if (distance >= edge) return -1;
  const t = 1 - distance / edge;
  const bump = noise.top.noise2(x / 24, z / 24);
  // No centro, plano: é onde o dragão pousa e o jogador luta.
  const top = distance < FLAT_RADIUS
    ? END_ISLAND_Y
    : END_ISLAND_Y + Math.round(3 * Math.min(1, t * 2) + 2 * bump);
  // Na borda a conta dá espessura zero (ou negativa): toda coluna da ilha
  // tem pelo menos dois blocos, senão a borda vira uma renda de buracos.
  out[0] = Math.min(top - 1,
    END_ISLAND_Y - Math.round(ISLAND_DEPTH * Math.sqrt(t) * (0.8 + 0.2 * bump)));
  return top;
}

/** Gera uma coluna do End. */
export function generateEndChunk(seed: number, noise: EndNoise, cx: number, cz: number): ChunkColumn {
  const chunk = new ChunkColumn(cx, cz);
  const air = makeState(AIR);
  const pillars = endPillars(seed);
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      chunk.biomeMap[(lz << 4) | lx] = 0;
      const x = cx * SECTION_SIZE + lx;
      const z = cz * SECTION_SIZE + lz;
      const top = islandColumn(noise, x, z, BOTTOM);
      if (top >= 0) {
        for (let y = Math.max(1, BOTTOM[0]); y <= top; y++) chunk.setBlock(lx, y, lz, END_STONE);
      }
      for (const pillar of pillars) {
        const dx = x - pillar.x;
        const dz = z - pillar.z;
        if (dx * dx + dz * dz > pillar.radius * pillar.radius) continue;
        const base = Math.max(1, top >= 0 ? BOTTOM[0] : END_ISLAND_Y - 10);
        for (let y = base; y <= pillar.top; y++) chunk.setBlock(lx, y, lz, OBSIDIAN);
        if (dx === 0 && dz === 0) chunk.setBlock(lx, pillar.top + 1, lz, BEDROCK_STATE);
      }
      exitPortalColumn(chunk, lx, lz, x, z, air);
    }
  }
  chunk.recomputeHeightMap();
  computeChunkLight(chunk);
  return chunk;
}

/**
 * A bacia do portal de saída, apagada: piso de rocha-mãe, a borda um bloco
 * acima e a coluna do meio com quatro de altura. As células de dentro da
 * borda ficam vazias — é onde o portal acende (`exitPortalCells`).
 */
function exitPortalColumn(
  chunk: ChunkColumn, lx: number, lz: number, x: number, z: number, air: number,
): void {
  const d2 = x * x + z * z;
  const outer = (EXIT_RADIUS + 0.5) ** 2;
  if (d2 > outer) return;
  chunk.setBlock(lx, END_ISLAND_Y, lz, BEDROCK_STATE);
  const center = x === 0 && z === 0;
  const rim = d2 > (EXIT_RADIUS - 0.5) ** 2;
  // Até seis acima do piso: ar, menos a borda (um bloco) e a coluna (quatro).
  for (let dy = 1; dy <= 6; dy++) {
    const solid = center ? dy <= 4 : rim && dy === 1;
    chunk.setBlock(lx, END_ISLAND_Y + dy, lz, solid ? BEDROCK_STATE : air);
  }
}

/**
 * As células do portal de saída (dentro da borda, fora da coluna), como
 * `[x, z]` no nível `END_ISLAND_Y + 1`. Quem acende é a luta, ao fim.
 */
export function exitPortalCells(): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  const inner = (EXIT_RADIUS - 0.5) ** 2;
  for (let z = -EXIT_RADIUS; z <= EXIT_RADIUS; z++) {
    for (let x = -EXIT_RADIUS; x <= EXIT_RADIUS; x++) {
      if (x === 0 && z === 0) continue;
      if (x * x + z * z <= inner) out.push([x, z]);
    }
  }
  return out;
}
