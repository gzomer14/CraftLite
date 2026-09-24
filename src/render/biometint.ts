/**
 * Tint de grama, folha e água por bioma (doc 03 §4.3; M14).
 *
 * O doc pede cor por bioma **com blend** — "média ponderada da altura e da
 * cor de tint". Até aqui só a altura tinha blend: a cor era uma só para o
 * mundo inteiro (`TINT_COLORS[1..3]`), e as cores de `data/biomes.ts` não
 * eram lidas por ninguém.
 *
 * **Como.** O vértice não tem bit sobrando para cor, e bioma é classificação
 * (degrau), não número. Mas o bioma sai do **clima**, e o clima é contínuo.
 * Então:
 *
 * 1. `ClimateTexture`: temperatura e umidade de cada coluna perto da câmera,
 *    2 bytes por coluna, numa textura toroidal (a coluna `(x, z)` mora no
 *    texel `(x mod N, z mod N)`), preenchida da seed na thread principal
 *    (`world/gen/climate.ts`) — sem mexer em worker, protocolo nem save.
 * 2. `buildColormap`: a tabela `clima → cor`, uma faixa por tipo de tint,
 *    pintada com o bioma que cada clima escolhe e borrada para a fronteira
 *    virar degradê.
 * 3. O vertex shader do terreno lê o clima no canto do bloco (a filtragem
 *    linear já faz a média das quatro colunas em volta) e a cor na tabela.
 *
 * Só WebGL2: textura no vertex shader não é garantida no WebGL1, e lá o tint
 * continua o fixo de antes. No Nether não há clima (`enabled = false`).
 *
 * O que ficou de fora: o bioma **de altura** (montanha, praia, rio) pinta com
 * o clima em que está, não com a cor da própria linha — é o que o gênero
 * também faz, e evita costura onde a altura cruza o limiar.
 */

import { BIOMES, pickClimateBiome } from '../data/biomes';
import { ClimateSampler, climateByte } from '../world/gen/climate';
import type { GlContext } from './gl';

/** Lado da tabela de cores, por tipo de tint. */
export const COLORMAP_SIZE = 32;
/** Tipos de tint na tabela, na ordem de `TINT_GRASS..TINT_WATER`. */
export const COLORMAP_KINDS = 3;
/**
 * Raio e passes do borrão da tabela. Uma célula da tabela é ~0,06 de clima,
 * uns 25 blocos de mundo; o borrão estende a fronteira por ~3 células, e a
 * filtragem linear da textura faz o resto. Mais que isso lavava o pântano, que
 * é uma caixa pequena num canto.
 */
const BLUR_RADIUS = 1;
const BLUR_PASSES = 2;

/** Chunks preenchidos por quadro: um teletransporte não trava o quadro. */
const FILLS_PER_FRAME = 32;
/** Marca de slot vazio. */
const EMPTY = 0x7fffffff;

/**
 * A tabela `clima → cor`: RGBA, `COLORMAP_SIZE` de largura (temperatura) e
 * `COLORMAP_SIZE × 3` de altura (umidade, uma faixa por tipo: grama, folha,
 * água). Pura — o teste confere cor e degradê sem GL.
 */
export function buildColormap(): Uint8Array {
  const n = COLORMAP_SIZE;
  const rgb = new Float32Array(n * n * COLORMAP_KINDS * 3);
  for (let j = 0; j < n; j++) {
    const humidity = -1 + (j + 0.5) * 2 / n;
    for (let i = 0; i < n; i++) {
      const temperature = -1 + (i + 0.5) * 2 / n;
      const biome = BIOMES[pickClimateBiome(temperature, humidity)];
      const colors = [biome.grassTint, biome.foliageTint, biome.waterTint];
      for (let k = 0; k < COLORMAP_KINDS; k++) {
        const o = ((k * n + j) * n + i) * 3;
        rgb[o] = ((colors[k] >> 16) & 255) / 255;
        rgb[o + 1] = ((colors[k] >> 8) & 255) / 255;
        rgb[o + 2] = (colors[k] & 255) / 255;
      }
    }
  }
  // Borrão por faixa: a fronteira entre caixas de bioma vira degradê.
  const tmp = new Float32Array(rgb.length);
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    blurAxis(rgb, tmp, n, 1, 0);
    blurAxis(tmp, rgb, n, 0, 1);
  }
  const out = new Uint8Array(n * n * COLORMAP_KINDS * 4);
  for (let p = 0; p < n * n * COLORMAP_KINDS; p++) {
    out[p * 4] = Math.round(rgb[p * 3] * 255);
    out[p * 4 + 1] = Math.round(rgb[p * 3 + 1] * 255);
    out[p * 4 + 2] = Math.round(rgb[p * 3 + 2] * 255);
    out[p * 4 + 3] = 255;
  }
  return out;
}

/** Média de caixa num eixo, sem atravessar de uma faixa de tipo para outra. */
function blurAxis(src: Float32Array, dst: Float32Array, n: number, dx: number, dy: number): void {
  for (let k = 0; k < COLORMAP_KINDS; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let d = -BLUR_RADIUS; d <= BLUR_RADIUS; d++) {
          const x = i + d * dx;
          const y = j + d * dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const o = ((k * n + y) * n + x) * 3;
          r += src[o]; g += src[o + 1]; b += src[o + 2];
          count++;
        }
        const o = ((k * n + j) * n + i) * 3;
        dst[o] = r / count; dst[o + 1] = g / count; dst[o + 2] = b / count;
      }
    }
  }
}

/** Lado da textura de clima para uma distância de render: potência de 2 (REPEAT). */
export function climateTextureSide(renderDistance: number): number {
  // O anel carregado tem 2·RD + 1 chunks; mais um de cada lado para o canto
  // do chunk da borda ler a coluna vizinha certa.
  const need = (2 * renderDistance + 3) * 16;
  let side = 64;
  while (side < need) side *= 2;
  return side;
}

/**
 * Clima em volta da câmera, numa textura RG8 toroidal. Quem ocupa cada slot
 * de chunk fica em `slotCx/slotCz`; um slot só é recalculado quando o chunk
 * que devia estar nele muda.
 */
export class BiomeTint {
  private readonly gl: WebGL2RenderingContext;
  private readonly climate: WebGLTexture;
  private readonly colormap: WebGLTexture;
  private sampler: ClimateSampler | null = null;
  private side = 0;
  private slots = 0;
  private slotCx = new Int32Array(0);
  private slotCz = new Int32Array(0);
  private radius = 0;
  /** 16×16 colunas × 2 bytes: o pedaço de um chunk a caminho da GPU. */
  private readonly scratch = new Uint8Array(16 * 16 * 2);

  /** Falso no Nether: lá o shader volta para a tabela fixa. */
  enabled = true;
  /** Chunks preenchidos no último quadro — lido pelos testes e pelo debug. */
  filled = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const climate = gl.createTexture();
    const colormap = gl.createTexture();
    if (climate === null || colormap === null) throw new Error('Falha ao criar textura de clima.');
    this.climate = climate;
    this.colormap = colormap;

    gl.bindTexture(gl.TEXTURE_2D, colormap);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, COLORMAP_SIZE, COLORMAP_SIZE * COLORMAP_KINDS, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, buildColormap(),
    );
    setFilter(gl, gl.CLAMP_TO_EDGE);
  }

  /** Mundo novo: outra seed, todo slot inválido. */
  setSeed(seed: number): void {
    this.sampler = new ClimateSampler(seed);
    this.slotCx.fill(EMPTY);
  }

  /** Recria a textura se o anel não cabe mais nela (ou sobra demais). */
  setRenderDistance(renderDistance: number): void {
    this.radius = renderDistance + 1;
    const side = climateTextureSide(renderDistance);
    if (side === this.side) return;
    this.side = side;
    this.slots = side / 16;
    this.slotCx = new Int32Array(this.slots * this.slots).fill(EMPTY);
    this.slotCz = new Int32Array(this.slots * this.slots);
    const gl = this.gl;
    // Começa com o clima de planície, para o slot ainda não calculado não
    // sair com a cor de um canto da tabela.
    const neutral = new Uint8Array(side * side * 2);
    const t = climateByte(0.55);
    const h = climateByte(0.4);
    for (let i = 0; i < neutral.length; i += 2) { neutral[i] = t; neutral[i + 1] = h; }
    gl.bindTexture(gl.TEXTURE_2D, this.climate);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, side, side, 0, gl.RG, gl.UNSIGNED_BYTE, neutral);
    setFilter(gl, gl.REPEAT);
  }

  /** `1 / lado`, para o shader converter coordenada de mundo em uv. */
  get inverseSide(): number {
    return this.side === 0 ? 0 : 1 / this.side;
  }

  /**
   * Garante o clima dos chunks em volta da câmera, do centro para fora, até
   * `FILLS_PER_FRAME` por quadro. Sem alocação: só compara chave de slot.
   */
  update(cameraX: number, cameraZ: number): void {
    this.filled = 0;
    if (!this.enabled || this.sampler === null || this.side === 0) return;
    const ccx = Math.floor(cameraX / 16);
    const ccz = Math.floor(cameraZ / 16);
    for (let r = 0; r <= this.radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        const edge = dz === -r || dz === r;
        for (let dx = -r; dx <= r; dx += edge || r === 0 ? 1 : 2 * r) {
          if (!this.ensure(ccx + dx, ccz + dz)) return;
        }
      }
    }
  }

  /** Falso quando o orçamento do quadro acabou. */
  private ensure(cx: number, cz: number): boolean {
    const mask = this.slots - 1;
    const sx = cx & mask;
    const sz = cz & mask;
    const slot = sz * this.slots + sx;
    if (this.slotCx[slot] === cx && this.slotCz[slot] === cz) return true;
    if (this.filled >= FILLS_PER_FRAME) return false;
    (this.sampler as ClimateSampler).fillChunk(cx, cz, this.scratch, 0, 32);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.climate);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, sx * 16, sz * 16, 16, 16, gl.RG, gl.UNSIGNED_BYTE, this.scratch);
    this.slotCx[slot] = cx;
    this.slotCz[slot] = cz;
    this.filled++;
    return true;
  }

  /** Liga as duas texturas nas unidades pedidas. */
  bind(climateUnit: number, colormapUnit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + climateUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.climate);
    gl.activeTexture(gl.TEXTURE0 + colormapUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.colormap);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    this.gl.deleteTexture(this.climate);
    this.gl.deleteTexture(this.colormap);
  }
}

function setFilter(gl: WebGL2RenderingContext, wrap: number): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

/** O `BiomeTint` do contexto, ou `null` onde ele não roda (WebGL1). */
export function createBiomeTint(ctx: GlContext): BiomeTint | null {
  if (ctx.gl2 === null) return null;
  // Textura no vertex shader: o WebGL2 garante 16 unidades, mas confere.
  if (ctx.gl2.getParameter(ctx.gl2.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) return null;
  return new BiomeTint(ctx.gl2);
}
