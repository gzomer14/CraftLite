/**
 * Fortaleza do Nether (doc 14 — M16).
 *
 * **Uma por região de 16×16 chunks**, com o centro sorteado pela seed longe
 * da borda da região: a fortaleza inteira cabe na própria região, e cada chunk
 * só pergunta pela da sua. Nenhuma coluna do Nether fica a mais de ~200
 * blocos de uma — o portal que o jogador acende na superfície cai, do outro
 * lado, a uma caminhada da mais próxima.
 *
 * A forma é a de uma cruz de pontes de tijolo sobre a lava:
 *
 * ```
 *                 [ blaze ]
 *                     │
 *   [ jardim ] ───── (+) ───── [ blaze ]
 *                     │
 *                 [ baú ]
 * ```
 *
 * - o cruzamento no centro, com cerca em volta;
 * - quatro pontes de 5 de largura e 20 a 36 de comprimento, com cerca nas
 *   bordas, **pilares** até o chão (a peça `pillar`, que desce até achar
 *   sólido) e pedra luminosa na grade a cada 8 blocos — são as luzes que se
 *   veem de longe na névoa do Nether e dizem "é ali";
 * - uma sala no fim de cada ponte: duas com gerador de blaze numa plataforma,
 *   uma com o jardim de verruga na areia das almas, e uma com o baú.
 *
 * Onde a ponte atravessa a rocha, o ar da passagem a cava: vira corredor.
 *
 * É um `StructureDef` montado em código, a partir da seed — as peças são as
 * mesmas de `data/structures.ts`, e o `stamp` de `structures.ts` escreve só a
 * fatia que cai em cada chunk.
 */

import type { Piece, StructureDef } from '../../data/structures';
import { hash2 } from '../../core/rng';
import { SECTION_SIZE, type ChunkColumn } from '../chunk';
import { stamp } from './structures';

/** Lado da região de uma fortaleza, em chunks. */
export const FORTRESS_REGION = 16;
/** Margem do centro até a borda da região, em blocos. */
const MARGIN = 64;
/** Metade do cruzamento central. */
const CROSS = 4;
/** Comprimento da ponte: `BRIDGE_MIN` + até `BRIDGE_SPREAD`. */
const BRIDGE_MIN = 20;
const BRIDGE_SPREAD = 17;
/** Lado da sala da ponta. */
const ROOM = 11;
/** Alcance máximo a partir do centro — para o chunk saber se é tocado. */
export const FORTRESS_REACH = CROSS + 1 + BRIDGE_MIN + BRIDGE_SPREAD + ROOM + 2;
/** Andar do piso: no meio dos salões, bem acima do mar de lava (31). */
const FLOOR_MIN = 52;
const FLOOR_SPREAD = 12;

const SALT_FORTRESS = 0x464f;

/** O que mora na sala do fim de cada ponte. */
type RoomKind = 'blaze' | 'garden' | 'chest';

/** As quatro direções das pontes, e a sala de cada uma. */
const ARMS: readonly { dx: number; dz: number; room: RoomKind }[] = [
  { dx: 1, dz: 0, room: 'blaze' },
  { dx: -1, dz: 0, room: 'garden' },
  { dx: 0, dz: 1, room: 'blaze' },
  { dx: 0, dz: -1, room: 'chest' },
];

/** Centro da fortaleza da região `(rx, rz)`, como `[x, y, z]`. */
export function fortressCenter(seed: number, rx: number, rz: number, out: Int32Array): void {
  const pick = hash2(seed, rx, rz, SALT_FORTRESS);
  const span = FORTRESS_REGION * SECTION_SIZE - 2 * MARGIN;
  out[0] = rx * FORTRESS_REGION * SECTION_SIZE + MARGIN + (pick % span);
  out[1] = FLOOR_MIN + ((pick >>> 20) % FLOOR_SPREAD);
  out[2] = rz * FORTRESS_REGION * SECTION_SIZE + MARGIN + ((pick >>> 10) % span);
}

/** Comprimento da ponte `arm` da fortaleza da região. */
function bridgeLength(seed: number, rx: number, rz: number, arm: number): number {
  return BRIDGE_MIN + (hash2(seed, rx * 4 + arm, rz, SALT_FORTRESS + 1) % BRIDGE_SPREAD);
}

/**
 * Caixa de uma peça numa ponte: `s` corre ao longo da ponte (a partir do
 * centro), `w` atravessa. Converte para `[x0,y0,z0,x1,y1,z1]` do eixo certo.
 */
function along(
  dx: number, dz: number, s0: number, s1: number, y0: number, y1: number, w0: number, w1: number,
): readonly [number, number, number, number, number, number] {
  const a = Math.min(s0 * (dx + dz), s1 * (dx + dz));
  const b = Math.max(s0 * (dx + dz), s1 * (dx + dz));
  return dx !== 0 ? [a, y0, w0, b, y1, w1] : [w0, y0, a, w1, y1, b];
}

/** Um ponto ao longo da ponte. */
function at(dx: number, dz: number, s: number, y: number, w: number): readonly [number, number, number] {
  const k = s * (dx + dz);
  return dx !== 0 ? [k, y, w] : [w, y, k];
}

function piece(
  kind: Piece['kind'], block: string, box: readonly [number, number, number, number, number, number],
  state?: number,
): Piece {
  return { kind, block, box, replace: 'any', ...(state !== undefined ? { state } : {}) };
}

/**
 * Monta a fortaleza da região como um `StructureDef`, com a origem no centro
 * do cruzamento, no nível do piso.
 */
export function fortressDef(seed: number, rx: number, rz: number): StructureDef {
  const pieces: Piece[] = [];
  const chests: { at: readonly [number, number, number]; loot: string }[] = [];
  const spawners: { at: readonly [number, number, number]; mob: string }[] = [];

  // Cruzamento: piso, ar, cerca em volta com as quatro saídas, pilares.
  pieces.push(piece('fill', 'nether_bricks', [-CROSS, 0, -CROSS, CROSS, 0, CROSS]));
  pieces.push(piece('fill', 'air', [-CROSS, 1, -CROSS, CROSS, 5, CROSS]));
  pieces.push(piece('walls', 'nether_brick_fence', [-CROSS, 1, -CROSS, CROSS, 1, CROSS]));
  pieces.push(piece('point', 'glowstone', [0, 0, 0, 0, 0, 0]));
  for (const cx of [-CROSS, CROSS]) {
    for (const cz of [-CROSS, CROSS]) {
      pieces.push(piece('pillar', 'nether_bricks', [cx, -1, cz, cx, -1, cz]));
      pieces.push(piece('point', 'glowstone', [cx, 1, cz, cx, 1, cz]));
    }
  }

  for (let arm = 0; arm < ARMS.length; arm++) {
    const { dx, dz, room } = ARMS[arm];
    const length = bridgeLength(seed, rx, rz, arm);
    // A saída do cruzamento: a cerca abre na largura da passagem.
    pieces.push(piece('fill', 'air', along(dx, dz, CROSS, CROSS, 1, 1, -1, 1)));

    // Ponte: piso, passagem cavada, cerca nas bordas, luzes e pilares.
    const s0 = CROSS + 1;
    const s1 = CROSS + length;
    pieces.push(piece('fill', 'nether_bricks', along(dx, dz, s0, s1, 0, 0, -2, 2)));
    pieces.push(piece('fill', 'air', along(dx, dz, s0, s1, 1, 4, -2, 2)));
    pieces.push(piece('fill', 'nether_brick_fence', along(dx, dz, s0, s1, 1, 1, -2, -2)));
    pieces.push(piece('fill', 'nether_brick_fence', along(dx, dz, s0, s1, 1, 1, 2, 2)));
    for (let s = s0 + 3; s <= s1; s += 8) {
      for (const w of [-2, 2]) {
        const [x, y, z] = at(dx, dz, s, 1, w);
        pieces.push(piece('point', 'glowstone', [x, y, z, x, y, z]));
        const [px, , pz] = at(dx, dz, s, -1, w);
        pieces.push(piece('pillar', 'nether_bricks', [px, -1, pz, px, -1, pz]));
      }
    }

    // Sala da ponta: casca, miolo, porta para a ponte, janelas de cerca.
    const a = s1 + 1;
    const b = a + ROOM - 1;
    const half = (ROOM - 1) / 2;
    pieces.push(piece('hollow', 'nether_bricks', along(dx, dz, a, b, 0, 6, -half, half)));
    pieces.push(piece('fill', 'air', along(dx, dz, a + 1, b - 1, 1, 5, -half + 1, half - 1)));
    pieces.push(piece('fill', 'air', along(dx, dz, a, a, 1, 3, -1, 1)));
    pieces.push(piece('fill', 'nether_brick_fence', along(dx, dz, a + 4, a + 6, 2, 3, -half, -half)));
    pieces.push(piece('fill', 'nether_brick_fence', along(dx, dz, a + 4, a + 6, 2, 3, half, half)));
    for (const s of [a, b]) {
      for (const w of [-half, half]) {
        const [px, , pz] = at(dx, dz, s, -1, w);
        pieces.push(piece('pillar', 'nether_bricks', [px, -1, pz, px, -1, pz]));
      }
    }
    const middle = a + half;
    const [lx, ly, lz] = at(dx, dz, middle, 6, 0);
    pieces.push(piece('point', 'glowstone', [lx, ly, lz, lx, ly, lz]));

    if (room === 'blaze') {
      // A plataforma do gerador, com o gerador em cima.
      pieces.push(piece('fill', 'nether_bricks', along(dx, dz, middle - 1, middle + 1, 1, 1, -1, 1)));
      spawners.push({ at: at(dx, dz, middle, 2, 0), mob: 'blaze' });
    } else if (room === 'garden') {
      // Dois canteiros de areia das almas com a verruga madura, e um baú.
      for (const w of [-(half - 1), half - 1]) {
        pieces.push(piece('fill', 'soul_sand', along(dx, dz, a + 2, b - 2, 1, 1, w, w)));
        pieces.push(piece('fill', 'nether_wart', along(dx, dz, a + 2, b - 2, 2, 2, w, w), 3));
      }
      chests.push({ at: at(dx, dz, b - 1, 1, 0), loot: 'nether_fortress' });
    } else {
      chests.push({ at: at(dx, dz, middle, 1, 0), loot: 'nether_fortress' });
      chests.push({ at: at(dx, dz, b - 1, 1, 0), loot: 'nether_fortress' });
    }
  }

  const size = 2 * FORTRESS_REACH + 1;
  return {
    name: 'nether_fortress',
    size: [size, 16, size],
    pieces,
    chests,
    spawners,
    placement: { attempts: 0, minY: 0, maxY: 0, surface: false },
  };
}

/** Cache das últimas fortalezas montadas: um chunk vizinho quase sempre pede a mesma. */
const CACHE_SIZE = 4;
const cacheKeys: string[] = [];
const cacheDefs: StructureDef[] = [];

function cachedDef(seed: number, rx: number, rz: number): StructureDef {
  const key = `${seed}:${rx}:${rz}`;
  const found = cacheKeys.indexOf(key);
  if (found >= 0) return cacheDefs[found];
  const def = fortressDef(seed, rx, rz);
  cacheKeys.unshift(key);
  cacheDefs.unshift(def);
  if (cacheKeys.length > CACHE_SIZE) { cacheKeys.pop(); cacheDefs.pop(); }
  return def;
}

const CENTER = new Int32Array(3);

/** Escreve no chunk a fatia da fortaleza da região dele, se houver. */
export function placeFortress(chunk: ChunkColumn, seed: number): void {
  const rx = Math.floor(chunk.cx / FORTRESS_REGION);
  const rz = Math.floor(chunk.cz / FORTRESS_REGION);
  fortressCenter(seed, rx, rz, CENTER);
  const x0 = chunk.cx * SECTION_SIZE;
  const z0 = chunk.cz * SECTION_SIZE;
  if (x0 + SECTION_SIZE <= CENTER[0] - FORTRESS_REACH || x0 > CENTER[0] + FORTRESS_REACH) return;
  if (z0 + SECTION_SIZE <= CENTER[2] - FORTRESS_REACH || z0 > CENTER[2] + FORTRESS_REACH) return;
  stamp(chunk, seed, cachedDef(seed, rx, rz), CENTER[0], CENTER[1], CENTER[2]);
}

/** Centro da fortaleza mais perto de `(x, z)`, em `out` como `[x, y, z]` (testes e conquista). */
export function nearestFortress(seed: number, x: number, z: number, out: Int32Array): void {
  const size = FORTRESS_REGION * SECTION_SIZE;
  const rx = Math.floor(x / size);
  const rz = Math.floor(z / size);
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      fortressCenter(seed, rx + dx, rz + dz, CENTER);
      const d = (CENTER[0] - x) ** 2 + (CENTER[2] - z) ** 2;
      if (d < best) { best = d; out[0] = CENTER[0]; out[1] = CENTER[1]; out[2] = CENTER[2]; }
    }
  }
}
