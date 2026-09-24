/**
 * Campo de altura e bioma, com margem (doc 03 §4.2 e §4.3).
 *
 * **Por que existe.** A altura de uma coluna depende do bioma — `heightOffset`
 * e `heightScale` da tabela do doc 03 §4.3 —, e bioma é uma *classificação*,
 * não um número: muda de degrau. Aplicado coluna a coluna, esse degrau vira
 * parede. Entre montanha (offset 26, escala 2,2) e planície (offset 2) o
 * terreno subia **29 blocos em um bloco de distância**, e onde a fronteira se
 * esfarela — porque o `detail` de 1/60 faz o `h0` cruzar o limiar de montanha
 * para frente e para trás — a parede vira uma fileira de pilares soltos.
 *
 * O doc 03 §4.3 já previa o sintoma ("sem isso, aparecem paredes retas entre
 * biomas") e prescreve a cura: **média ponderada 5×5 a cada 4 blocos**. O que o
 * código fazia era outra coisa — interpolava os *mapas de ruído* numa grade
 * esparsa, o que suaviza a entrada mas não a saída. O degrau do `heightOffset`
 * passava inteiro.
 *
 * **A segunda causa do mesmo sintoma.** A altura terminava num `clamp` duro em
 * `WORLD_HEIGHT − 4`. Metade das colunas de montanha batia nesse teto, então a
 * cordilheira inteira virava um platô liso na altura 124 — topo chapado, lado
 * vertical. Aqui o teto é **macio**: uma hipérbole que se aproxima do limite
 * sem nunca encostar, e que por isso nunca achata dois vizinhos na mesma cota.
 *
 * **Margem.** Decoração (`decorate.ts`) e estruturas (`structures.ts`) sorteiam
 * posições nos 8 chunks vizinhos e escrevem só o que cai neste, então precisam
 * da altura até 16 blocos fora da borda. A janela preparada cobre isso; quem
 * pedir fora dela cai num caminho lento que dá **o mesmo número**, porque as
 * duas rotas leem os mesmos nós de uma rede ancorada em coordenada de mundo.
 */

import { BIOMES, BIOME_BEACH, BIOME_OCEAN, BIOME_RIVER, pickBiome } from '../../data/biomes';
import { Noise } from '../../core/noise';
import { CLIMATE_STEP, humidityNode, temperatureNode } from './climate';
import { clamp, spline } from '../../core/math';
import { SEA_LEVEL, SECTION_SIZE, WORLD_HEIGHT } from '../chunk';

/** Frequências do doc 03 §4.1, em 1/blocos. */
const FREQ_CONTINENT = 1 / 2000;
const FREQ_EROSION = 1 / 1500;
const FREQ_WEIRDNESS = 1 / 800;
const FREQ_DETAIL = 1 / 60;

/**
 * Rios (M14). O leito é onde `|ruído|` passa perto de zero: uma linha fina e
 * sinuosa, sem começo nem fim, que o warp entorta para não sair reta.
 *
 * O perfil é um vale, não uma vala. A margem (`RIVER_BANK`) **alarga com o
 * desnível** até o leito, e é isso que impede a parede: descer 20 blocos até
 * a água leva 20 blocos de margem, não um. E o rio some no terreno alto
 * (`RIVER_FADE_*`) — nasce no pé do morro em vez de rasgar a montanha num
 * cânion de paredes verticais.
 */
const FREQ_RIVER = 1 / 420;
const RIVER_WARP = 40;
/** `|ruído|` abaixo disto é leito. Com o gradiente do ruído, ~6 a 10 blocos de largura. */
const RIVER_CORE = 0.017;
/** Margem mínima e quanto ela cresce por bloco de desnível, em unidades de ruído. */
const RIVER_BANK = 0.03;
const RIVER_BANK_PER_BLOCK = 0.01;
/** Cota do leito: três blocos de água no meio do rio. */
export const RIVER_BED = SEA_LEVEL - 3;
/** Faixa de altura em que o rio perde força, até sumir. */
const RIVER_FADE_LOW = SEA_LEVEL + 12;
const RIVER_FADE_HIGH = SEA_LEVEL + 26;

/** Spline de continentalidade do doc 03 §4.2 — oceano em −1, planalto em +1. */
const CONT_X = [-1.0, -0.4, -0.15, 0.0, 0.3, 0.6, 1.0];
const CONT_Y = [32, 48, 60, 65, 72, 84, 100];

/** Os cinco mapas 2D lentos, na ordem em que ficam guardados. */
const MAP_CONTINENT = 0;
const MAP_EROSION = 1;
const MAP_TEMPERATURE = 2;
const MAP_HUMIDITY = 3;
const MAP_WEIRDNESS = 4;
const MAP_COUNT = 5;

/**
 * Passo da rede dos mapas lentos. Eles variam entre 1/800 e 1/2000 — 8 blocos
 * entre amostras é fino demais para o olho e grosso o bastante para o custo.
 */
const SLOW_STEP = CLIMATE_STEP;

/** Passo da rede de bioma, e raio do kernel: 5×5 a cada 4 blocos (doc 03 §4.3). */
const BIOME_STEP = 4;
const KERNEL_RADIUS = 2;
/** Pesos binomiais — uma gaussiana pobre, separável e sem divisão. */
const KERNEL = [1, 4, 6, 4, 1];
const KERNEL_SUM = 256; // (1+4+6+4+1)²

/** Quanto a janela se estende para fora do chunk, em blocos. */
export const FIELD_MARGIN = 16;

/** Teto do terreno e o joelho onde a compressão começa. */
const MAX_HEIGHT = WORLD_HEIGHT - 4;
const CEILING_KNEE = 104;

/** Lado da rede suave (a que as colunas leem) e da rede crua (a que o kernel lê). */
const SMOOTH_SIDE = (SECTION_SIZE + 2 * FIELD_MARGIN) / BIOME_STEP + 1; // 13
const RAW_SIDE = SMOOTH_SIDE + 2 * KERNEL_RADIUS; // 17
/** Lado da rede lenta: cobre a rede crua inteira. */
const SLOW_SIDE = (RAW_SIDE - 1) * BIOME_STEP / SLOW_STEP + 1; // 9

/**
 * O que o campo precisa de uma seed. `TerrainNoise` satisfaz isto por estrutura
 * — a dependência é declarada aqui para não haver import circular.
 */
export interface HeightNoise {
  readonly continent: Noise;
  readonly erosion: Noise;
  readonly temperature: Noise;
  readonly humidity: Noise;
  readonly weirdness: Noise;
  readonly detail: Noise;
  /** Canal dos rios (M14). */
  readonly river: Noise;
}

/** Amostra de coluna: o que os mapas dizem sobre um `(x, z)`. */
export interface ColumnSample {
  height: number;
  biome: number;
  temperature: number;
  humidity: number;
  erosion: number;
  continent: number;
}

/**
 * Teto macio. Um `clamp` duro achata todo mundo na mesma cota — é isso que
 * transforma cordilheira em platô. Esta hipérbole leva `KNEE + s` para
 * `KNEE + s/2` e tende a `MAX_HEIGHT` sem alcançá-lo, então dois vizinhos com
 * alturas cruas diferentes continuam com alturas diferentes.
 */
export function softCeiling(h: number): number {
  if (h <= CEILING_KNEE) return h;
  const span = MAX_HEIGHT - CEILING_KNEE;
  return CEILING_KNEE + span * (1 - 1 / (1 + (h - CEILING_KNEE) / span));
}

/** Valor de um mapa lento num nó da rede (coordenada múltipla de `SLOW_STEP`). */
function slowNode(noise: HeightNoise, map: number, nx: number, nz: number): number {
  switch (map) {
    case MAP_CONTINENT: return noise.continent.fbm2(nx, nz, 4, FREQ_CONTINENT);
    case MAP_EROSION: return noise.erosion.fbm2(nx, nz, 4, FREQ_EROSION);
    case MAP_TEMPERATURE: return temperatureNode(noise.temperature, nx, nz);
    case MAP_HUMIDITY: return humidityNode(noise.humidity, nx, nz);
    default: return noise.weirdness.fbm2(nx, nz, 3, FREQ_WEIRDNESS);
  }
}

/** Amplitude do relevo local: erosão alta (+1) achata, baixa (−1) dá montanha. */
function amplitudeOf(erosion: number): number {
  return 3 + (1 - (erosion + 1) / 2) * 25;
}

/** Os cinco mapas lentos num ponto, escritos em `out`. */
const SLOW_SCRATCH = new Float64Array(MAP_COUNT);
const SLOW_SCRATCH_ALT = new Float64Array(MAP_COUNT);

/**
 * Campo preparado para um chunk. Uma instância por worker: os buffers são
 * pré-alocados e reusados a cada `prepare`, porque geração de chunk é caminho
 * quente e o doc 02 §5 não admite alocação por chunk.
 */
export class HeightField {
  private readonly slow = new Float64Array(SLOW_SIDE * SLOW_SIDE * MAP_COUNT);
  private readonly rawOffset = new Float64Array(RAW_SIDE * RAW_SIDE);
  private readonly rawScale = new Float64Array(RAW_SIDE * RAW_SIDE);
  private readonly smoothOffset = new Float64Array(SMOOTH_SIDE * SMOOTH_SIDE);
  private readonly smoothScale = new Float64Array(SMOOTH_SIDE * SMOOTH_SIDE);

  /** Canto da janela, em coordenada de mundo. */
  private originX = 0;
  private originZ = 0;
  private ready = false;

  private readonly sample_: ColumnSample = {
    height: 0, biome: 0, temperature: 0, humidity: 0, erosion: 0, continent: 0,
  };

  constructor(readonly noise: HeightNoise) {}

  /**
   * Prepara a janela do chunk `(cx, cz)`: os mapas lentos, a rede de bioma e a
   * média 5×5. Depois disto, `sample` de qualquer coluna da janela é barato.
   */
  prepare(cx: number, cz: number): void {
    const originX = cx * SECTION_SIZE - FIELD_MARGIN;
    const originZ = cz * SECTION_SIZE - FIELD_MARGIN;
    this.originX = originX;
    this.originZ = originZ;
    this.ready = true;

    // A rede crua começa `KERNEL_RADIUS` passos antes da janela.
    const rawX = originX - KERNEL_RADIUS * BIOME_STEP;
    const rawZ = originZ - KERNEL_RADIUS * BIOME_STEP;

    const slow = this.slow;
    for (let gz = 0; gz < SLOW_SIDE; gz++) {
      const wz = rawZ + gz * SLOW_STEP;
      for (let gx = 0; gx < SLOW_SIDE; gx++) {
        const wx = rawX + gx * SLOW_STEP;
        const base = (gz * SLOW_SIDE + gx) * MAP_COUNT;
        for (let m = 0; m < MAP_COUNT; m++) slow[base + m] = slowNode(this.noise, m, wx, wz);
      }
    }

    const rawOffset = this.rawOffset;
    const rawScale = this.rawScale;
    for (let gz = 0; gz < RAW_SIDE; gz++) {
      const wz = rawZ + gz * BIOME_STEP;
      for (let gx = 0; gx < RAW_SIDE; gx++) {
        const wx = rawX + gx * BIOME_STEP;
        this.slowAt(wx, wz, SLOW_SCRATCH);
        const biome = BIOMES[this.biomeAtNode(wx, wz, SLOW_SCRATCH)];
        const i = gz * RAW_SIDE + gx;
        rawOffset[i] = biome.heightOffset;
        rawScale[i] = biome.heightScale;
      }
    }

    // Média ponderada 5×5 (doc 03 §4.3): é o que impede a parede reta.
    const smoothOffset = this.smoothOffset;
    const smoothScale = this.smoothScale;
    for (let gz = 0; gz < SMOOTH_SIDE; gz++) {
      for (let gx = 0; gx < SMOOTH_SIDE; gx++) {
        let sumOffset = 0;
        let sumScale = 0;
        for (let dz = -KERNEL_RADIUS; dz <= KERNEL_RADIUS; dz++) {
          const kz = KERNEL[dz + KERNEL_RADIUS];
          const row = (gz + KERNEL_RADIUS + dz) * RAW_SIDE + gx + KERNEL_RADIUS;
          for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
            const k = kz * KERNEL[dx + KERNEL_RADIUS];
            sumOffset += rawOffset[row + dx] * k;
            sumScale += rawScale[row + dx] * k;
          }
        }
        const i = gz * SMOOTH_SIDE + gx;
        smoothOffset[i] = sumOffset / KERNEL_SUM;
        smoothScale[i] = sumScale / KERNEL_SUM;
      }
    }
  }

  /** Altura da coluna. Atalho de `sample().height`. */
  heightAt(wx: number, wz: number): number {
    return this.sample(wx, wz).height;
  }

  /**
   * Amostra completa de uma coluna. O objeto devolvido é reusado: não guarde a
   * referência esperando que ela sobreviva à próxima chamada.
   */
  sample(wx: number, wz: number): ColumnSample {
    const lx = wx - this.originX;
    const lz = wz - this.originZ;
    const span = SECTION_SIZE + 2 * FIELD_MARGIN;
    const inside = this.ready && lx >= 0 && lz >= 0 && lx <= span && lz <= span;

    const slowOut = SLOW_SCRATCH_ALT;
    this.slowAt(wx, wz, slowOut);
    const cont = slowOut[MAP_CONTINENT];
    const ero = slowOut[MAP_EROSION];
    const temp = slowOut[MAP_TEMPERATURE];
    const humid = slowOut[MAP_HUMIDITY];
    const weird = slowOut[MAP_WEIRDNESS];

    const amp = amplitudeOf(ero);
    const detail = this.noise.detail.warpedFbm2(wx, wz, 3, FREQ_DETAIL, 12);
    const h0 = spline(CONT_X, CONT_Y, cont) + detail * amp + weird * 4;
    const biome = pickBiome(Math.round(h0), SEA_LEVEL, temp, humid, ero);

    let offset: number;
    let scale: number;
    if (inside) {
      offset = bilinear(this.smoothOffset, SMOOTH_SIDE, lx / BIOME_STEP, lz / BIOME_STEP);
      scale = bilinear(this.smoothScale, SMOOTH_SIDE, lx / BIOME_STEP, lz / BIOME_STEP);
    } else {
      offset = this.blendedFar(wx, wz, true);
      scale = this.blendedFar(wx, wz, false);
    }

    const land = softCeiling(h0 + offset + detail * amp * (scale - 1) * 0.5);
    // A força do rio lê a altura **lisa** (sem o ruído de detalhe): lida da
    // altura final, a faixa em que o rio perde força copiava cada lombada do
    // detalhe e a multiplicava pela profundidade do vale — parede de 13.
    const h = this.carveRiver(wx, wz, land, spline(CONT_X, CONT_Y, cont) + offset);
    const out = this.sample_;
    out.height = Math.round(clamp(h, 4, MAX_HEIGHT));
    // Rio é a água que só existe por causa do canal: o mar e a praia continuam
    // sendo mar e praia onde o rio desemboca.
    out.biome = out.height < SEA_LEVEL && land >= SEA_LEVEL
      && biome !== BIOME_OCEAN && biome !== BIOME_BEACH ? BIOME_RIVER : biome;
    out.temperature = temp;
    out.humidity = humid;
    out.erosion = ero;
    out.continent = cont;
    return out;
  }

  /**
   * Altura depois do rio. `smooth` é a altura sem o detalhe, que decide onde
   * o rio tem força. Fora do vale devolve `land` intacto; no leito,
   * `RIVER_BED`; entre os dois, uma curva suave cuja largura cresce com o
   * desnível — ver `FREQ_RIVER`.
   */
  private carveRiver(wx: number, wz: number, land: number, smooth: number): number {
    if (land <= RIVER_BED || smooth >= RIVER_FADE_HIGH) return land;
    const strength = 1 - smooth01((smooth - RIVER_FADE_LOW) / (RIVER_FADE_HIGH - RIVER_FADE_LOW));
    if (strength <= 0) return land;
    const drop = land - RIVER_BED;
    const bank = RIVER_BANK + drop * RIVER_BANK_PER_BLOCK;
    const r = Math.abs(this.noise.river.warpedFbm2(wx, wz, 2, FREQ_RIVER, RIVER_WARP));
    if (r >= RIVER_CORE + bank) return land;
    const valley = RIVER_BED + drop * smooth01((r - RIVER_CORE) / bank);
    return land + (valley - land) * strength;
  }

  /** Os cinco mapas lentos em `(wx, wz)`, por bilinear entre nós da rede. */
  private slowAt(wx: number, wz: number, out: Float64Array): void {
    const nx = Math.floor(wx / SLOW_STEP) * SLOW_STEP;
    const nz = Math.floor(wz / SLOW_STEP) * SLOW_STEP;
    const tx = (wx - nx) / SLOW_STEP;
    const tz = (wz - nz) / SLOW_STEP;
    // Nó exato é a metade dos pedidos da rede de bioma: não interpolar economiza
    // as três amostras que entrariam multiplicadas por zero.
    if (tx === 0 && tz === 0) {
      for (let m = 0; m < MAP_COUNT; m++) out[m] = this.slowNodeCached(m, nx, nz);
      return;
    }
    for (let m = 0; m < MAP_COUNT; m++) {
      const a = this.slowNodeCached(m, nx, nz);
      const b = this.slowNodeCached(m, nx + SLOW_STEP, nz);
      const c = this.slowNodeCached(m, nx, nz + SLOW_STEP);
      const d = this.slowNodeCached(m, nx + SLOW_STEP, nz + SLOW_STEP);
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      out[m] = top + (bottom - top) * tz;
    }
  }

  /**
   * Nó da rede lenta: da janela quando ele está dentro, calculado na hora quando
   * não está. Os dois caminhos dão o mesmo bit porque a rede é ancorada em
   * coordenada de mundo e os valores são guardados em `Float64Array`.
   */
  private slowNodeCached(map: number, nx: number, nz: number): number {
    if (this.ready) {
      const gx = (nx - (this.originX - KERNEL_RADIUS * BIOME_STEP)) / SLOW_STEP;
      const gz = (nz - (this.originZ - KERNEL_RADIUS * BIOME_STEP)) / SLOW_STEP;
      if (gx >= 0 && gx < SLOW_SIDE && gz >= 0 && gz < SLOW_SIDE) {
        return this.slow[(gz * SLOW_SIDE + gx) * MAP_COUNT + map];
      }
    }
    return slowNode(this.noise, map, nx, nz);
  }

  /** Bioma de um nó da rede, a partir dos mapas lentos já amostrados nele. */
  private biomeAtNode(wx: number, wz: number, slow: Float64Array): number {
    const ero = slow[MAP_EROSION];
    const amp = amplitudeOf(ero);
    const detail = this.noise.detail.warpedFbm2(wx, wz, 3, FREQ_DETAIL, 12);
    const h0 = spline(CONT_X, CONT_Y, slow[MAP_CONTINENT]) + detail * amp
      + slow[MAP_WEIRDNESS] * 4;
    return pickBiome(
      Math.round(h0), SEA_LEVEL, slow[MAP_TEMPERATURE], slow[MAP_HUMIDITY], ero,
    );
  }

  /**
   * Caminho lento: o mesmo blend, para um ponto fora da janela. Refaz o kernel
   * 5×5 em volta dos quatro nós da bilinear — 36 avaliações de rede. Serve
   * ferramenta e teste; a geração nunca passa por aqui.
   */
  private blendedFar(wx: number, wz: number, wantOffset: boolean): number {
    const nx = Math.floor(wx / BIOME_STEP) * BIOME_STEP;
    const nz = Math.floor(wz / BIOME_STEP) * BIOME_STEP;
    const tx = (wx - nx) / BIOME_STEP;
    const tz = (wz - nz) / BIOME_STEP;
    const a = this.smoothedAt(nx, nz, wantOffset);
    const b = this.smoothedAt(nx + BIOME_STEP, nz, wantOffset);
    const c = this.smoothedAt(nx, nz + BIOME_STEP, wantOffset);
    const d = this.smoothedAt(nx + BIOME_STEP, nz + BIOME_STEP, wantOffset);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  /** Média 5×5 em volta de um nó da rede de bioma, calculada na hora. */
  private smoothedAt(nx: number, nz: number, wantOffset: boolean): number {
    let sum = 0;
    for (let dz = -KERNEL_RADIUS; dz <= KERNEL_RADIUS; dz++) {
      const kz = KERNEL[dz + KERNEL_RADIUS];
      for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
        const wx = nx + dx * BIOME_STEP;
        const wz = nz + dz * BIOME_STEP;
        this.slowAt(wx, wz, SLOW_SCRATCH);
        const biome = BIOMES[this.biomeAtNode(wx, wz, SLOW_SCRATCH)];
        sum += (wantOffset ? biome.heightOffset : biome.heightScale)
          * kz * KERNEL[dx + KERNEL_RADIUS];
      }
    }
    return sum / KERNEL_SUM;
  }
}

/** Smoothstep em 0..1, com a entrada já presa. */
function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Bilinear numa rede quadrada, com coordenada já em passos de rede. */
function bilinear(grid: Float64Array, side: number, fx: number, fz: number): number {
  const x0 = Math.min(side - 2, Math.max(0, fx | 0));
  const z0 = Math.min(side - 2, Math.max(0, fz | 0));
  const tx = fx - x0;
  const tz = fz - z0;
  const i = z0 * side + x0;
  const top = grid[i] + (grid[i + 1] - grid[i]) * tx;
  const bottom = grid[i + side] + (grid[i + side + 1] - grid[i + side]) * tx;
  return top + (bottom - top) * tz;
}
