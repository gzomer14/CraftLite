/**
 * Onde ficam as fortalezas da superfície (M16).
 *
 * São **três por mundo**, num anel em volta da origem, a 120° uma da outra, com
 * o ângulo e a distância sorteados pela seed. Poucas e conhecidas de antemão:
 * é o que deixa o olho do ender apontar para a mais próxima sem varrer o
 * mundo, e o gerador de terreno perguntar "algum pedaço dela cai neste chunk?"
 * com três contas.
 *
 * **Desvio consciente do gênero**, que usa 128 fortalezas em oito anéis a
 * partir de 1280 blocos: aqui o anel fica entre 448 e 768 blocos. No celular,
 * correr 2000 blocos para achar a primeira seria uma hora de jogo só de
 * caminhada, e três bastam para que sempre haja uma a menos de ~800 blocos de
 * quem nasceu perto da origem.
 */

import { hash2 } from '../../core/rng';

export const STRONGHOLD_COUNT = 3;
export const RING_MIN = 448;
export const RING_MAX = 768;
/** Andar do piso da sala do portal. Fundo, abaixo de qualquer vale. */
export const STRONGHOLD_FLOOR_Y = 24;

const SALT_STRONGHOLD = 0x5748;

/** Centro de cada fortaleza como `[x0, z0, x1, z1, x2, z2]`, por seed. */
export function strongholdSites(seed: number): Int32Array {
  const out = new Int32Array(STRONGHOLD_COUNT * 2);
  const start = (hash2(seed, 0, 0, SALT_STRONGHOLD) / 4294967296) * Math.PI * 2;
  for (let i = 0; i < STRONGHOLD_COUNT; i++) {
    const angle = start + (i * Math.PI * 2) / STRONGHOLD_COUNT;
    const t = hash2(seed, i, 1, SALT_STRONGHOLD) / 4294967296;
    const distance = RING_MIN + t * (RING_MAX - RING_MIN);
    out[i * 2] = Math.round(Math.cos(angle) * distance);
    out[i * 2 + 1] = Math.round(Math.sin(angle) * distance);
  }
  return out;
}

/**
 * As doze posições do anel do portal do End em volta do vão centrado em
 * `(0, 0)`: três de cada lado, a dois blocos do centro, sem os cantos. Mora
 * aqui, e não em `game/endportal.ts`, para o gerador não depender do jogo.
 */
export const RING: readonly (readonly [number, number])[] = [
  [-1, -2], [0, -2], [1, -2],
  [-1, 2], [0, 2], [1, 2],
  [-2, -1], [-2, 0], [-2, 1],
  [2, -1], [2, 0], [2, 1],
];

/** Cache de um mundo só: a seed muda raramente, e o olho pergunta toda vez. */
let cachedSeed = -1;
let cachedSites: Int32Array | null = null;

/**
 * Centro da fortaleza mais perto de `(x, z)`, escrito em `out` como `[x, z]`.
 * Sem alocação depois da primeira chamada da seed.
 */
export function nearestStronghold(seed: number, x: number, z: number, out: Int32Array): void {
  if (cachedSites === null || cachedSeed !== seed) {
    cachedSites = strongholdSites(seed);
    cachedSeed = seed;
  }
  let best = Infinity;
  for (let i = 0; i < STRONGHOLD_COUNT; i++) {
    const sx = cachedSites[i * 2];
    const sz = cachedSites[i * 2 + 1];
    const d = (sx - x) * (sx - x) + (sz - z) * (sz - z);
    if (d < best) { best = d; out[0] = sx; out[1] = sz; }
  }
}
