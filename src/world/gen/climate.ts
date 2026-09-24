/**
 * Clima do mundo: temperatura e umidade por coluna (doc 03 §4.1).
 *
 * São dois dos cinco mapas lentos do `heightfield.ts`, e os únicos que a
 * thread principal precisa (M14): o tint de grama, folha e água sai deles
 * (`render/biometint.ts`). Moram aqui, num módulo sem nada do resto do
 * gerador, para o render ler o clima sem puxar terreno, caverna e decoração
 * para o bundle principal.
 *
 * **Contrato:** `ClimateSampler.fillChunk` dá o mesmo número que
 * `HeightField.sample(...).temperature/humidity`. Os dois leem os mesmos nós de
 * uma rede de passo `CLIMATE_STEP` ancorada em coordenada de mundo, com a mesma
 * bilinear — o teste `tests/biometint.test.ts` confere.
 */

import { Noise } from '../../core/noise';

export const FREQ_TEMPERATURE = 1 / 1200;
export const FREQ_HUMIDITY = 1 / 1000;
/** Salts dos dois mapas — os mesmos de `TerrainNoise`. */
export const SALT_TEMPERATURE = 3;
export const SALT_HUMIDITY = 4;
/** Passo da rede dos mapas lentos (o `SLOW_STEP` do campo de altura). */
export const CLIMATE_STEP = 8;

const OCTAVES = 3;

/**
 * Espalha o clima em −1..1 (M14).
 *
 * A tabela do doc 03 §4.3 escreve as faixas de bioma em −1..1 — floresta com
 * umidade de 0,5 a 1, pântano de 0,8 a 1, savana e deserto com temperatura
 * acima de 0,7. Mas o FBM de três oitavas fica em ±0,7 (1% e 99%), com os
 * quartis em ±0,22: a floresta cobria 0,3% da terra, e savana e pântano,
 * **zero**. O fator leva o 1% e o 99% às pontas, e é aplicado no **nó** da
 * rede para o campo de altura e o `ClimateSampler` continuarem dando o mesmo
 * número.
 */
const CLIMATE_SPREAD = 1 / 0.7;

function spread(value: number): number {
  const v = value * CLIMATE_SPREAD;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function temperatureNode(noise: Noise, x: number, z: number): number {
  return spread(noise.fbm2(x, z, OCTAVES, FREQ_TEMPERATURE));
}

export function humidityNode(noise: Noise, x: number, z: number): number {
  return spread(noise.fbm2(x, z, OCTAVES, FREQ_HUMIDITY));
}

/** Um valor de clima (−1..1) em byte, como a textura guarda. */
export function climateByte(value: number): number {
  const b = Math.round((value + 1) * 127.5);
  return b < 0 ? 0 : b > 255 ? 255 : b;
}

/** Nós da rede lenta que um chunk usa: 16 blocos de lado, passo 8 → 3×3. */
const NODES = 16 / CLIMATE_STEP + 1;

/**
 * Clima de uma seed para quem não gera terreno. Uma instância por mundo; o
 * scratch é dela, então `fillChunk` não aloca.
 */
export class ClimateSampler {
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly nodesT = new Float64Array(NODES * NODES);
  private readonly nodesH = new Float64Array(NODES * NODES);

  constructor(seed: number) {
    this.temperature = new Noise(seed, SALT_TEMPERATURE);
    this.humidity = new Noise(seed, SALT_HUMIDITY);
  }

  /**
   * Escreve os 256 pares `(temperatura, umidade)` do chunk `(cx, cz)` como
   * bytes em `out`: a coluna `(lx, lz)` vai para `offset + lz·stride + lx·2`.
   */
  fillChunk(cx: number, cz: number, out: Uint8Array, offset: number, stride: number): void {
    const x0 = cx * 16;
    const z0 = cz * 16;
    for (let gz = 0; gz < NODES; gz++) {
      for (let gx = 0; gx < NODES; gx++) {
        const i = gz * NODES + gx;
        this.nodesT[i] = temperatureNode(this.temperature, x0 + gx * CLIMATE_STEP, z0 + gz * CLIMATE_STEP);
        this.nodesH[i] = humidityNode(this.humidity, x0 + gx * CLIMATE_STEP, z0 + gz * CLIMATE_STEP);
      }
    }
    for (let lz = 0; lz < 16; lz++) {
      const gz = lz >> 3;
      const tz = (lz & 7) / CLIMATE_STEP;
      for (let lx = 0; lx < 16; lx++) {
        const gx = lx >> 3;
        const tx = (lx & 7) / CLIMATE_STEP;
        const o = offset + lz * stride + lx * 2;
        out[o] = climateByte(bilinearNode(this.nodesT, gx, gz, tx, tz));
        out[o + 1] = climateByte(bilinearNode(this.nodesH, gx, gz, tx, tz));
      }
    }
  }
}

/** A bilinear de `HeightField.slowAt`, na mesma ordem de operações. */
function bilinearNode(nodes: Float64Array, gx: number, gz: number, tx: number, tz: number): number {
  const i = gz * NODES + gx;
  const a = nodes[i];
  if (tx === 0 && tz === 0) return a;
  const b = nodes[i + 1];
  const c = nodes[i + NODES];
  const d = nodes[i + NODES + 1];
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}
