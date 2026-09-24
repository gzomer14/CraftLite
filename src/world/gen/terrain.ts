/**
 * Gerador de terreno (doc 03 §3–§6).
 *
 * Puro e determinístico: dado `(seed, cx, cz)`, produz sempre a mesma coluna,
 * em qualquer ordem e em qualquer worker. Não toca no `World` — devolve uma
 * `ChunkColumn` pronta.
 *
 * Ordem do pipeline: campo de altura e bioma (`heightfield.ts`, que já faz o
 * blend 5×5 do doc 03 §4.3) → terreno base → cavernas → superfície → minérios →
 * skylight colunar.
 */

import { BIOMES } from '../../data/biomes';
import { AIR, BEDROCK, GRAVEL, SAND, STONE, WATER, LAVA, defOf } from '../../data/blocks';
import { Noise, valueNoise3 } from '../../core/noise';
import { hash2, hash3 } from '../../core/rng';
import { clamp } from '../../core/math';
import { decorate } from './decorate';
import { HeightField } from './heightfield';
import { SALT_HUMIDITY, SALT_TEMPERATURE } from './climate';
import { placeStructures } from './structures';
import { ChunkColumn, SEA_LEVEL, SECTION_SIZE, WORLD_HEIGHT } from '../chunk';

/**
 * Limiares das cavernas, **calibrados empiricamente**.
 *
 * O doc 03 §5 sugere `abs(noise3) < 0.08`, mas assume um ruído com distribuição
 * mais espalhada (OpenSimplex2). No Perlin melhorado que usamos, os valores se
 * concentram perto de zero: `|n| < 0.08` captura **21%** das amostras e deixa o
 * subsolo com 15–30% escavado — inviável tanto visualmente quanto para o
 * meshing, porque cada bolha vira mais faces.
 *
 * Os valores abaixo foram escolhidos medindo os percentis do próprio ruído e
 * mirando ~2% de salões e ~1,5% de túneis, que é a densidade que faz explorar
 * caverna parecer certo.
 */
const CHEESE_THRESHOLD = 0.012;
const SPAGHETTI_THRESHOLD = 0.045;

/** Salts: cada mapa de ruído tem o seu, senão todos ficam correlacionados. */
const SALT_CONTINENT = 1;
const SALT_EROSION = 2;
const SALT_WEIRDNESS = 5;
const SALT_DETAIL = 6;
const SALT_CHEESE = 7;
const SALT_SPAGHETTI_A = 8;
const SALT_SPAGHETTI_B = 9;
const SALT_ORE = 10;
const SALT_RIVER = 11;

/** Uma entrada da tabela de minérios (doc 03 §6). */
interface OreSpec {
  block: number;
  minY: number;
  maxY: number;
  /** Y de maior probabilidade; `-1` = distribuição uniforme na faixa. */
  peakY: number;
  attempts: number;
  minSize: number;
  maxSize: number;
}

export const ORES: readonly OreSpec[] = [
  { block: 22, minY: 5, maxY: 127, peakY: -1, attempts: 20, minSize: 4, maxSize: 17 }, // carvão
  { block: 24, minY: 0, maxY: 96, peakY: 48, attempts: 6, minSize: 3, maxSize: 10 },  // cobre
  { block: 23, minY: 0, maxY: 72, peakY: 16, attempts: 10, minSize: 3, maxSize: 10 }, // ferro
  { block: 25, minY: 0, maxY: 32, peakY: 16, attempts: 2, minSize: 2, maxSize: 8 },   // ouro
  { block: 26, minY: 0, maxY: 16, peakY: 8, attempts: 8, minSize: 3, maxSize: 10 },   // redstone
  { block: 27, minY: 0, maxY: 32, peakY: 14, attempts: 2, minSize: 2, maxSize: 8 },   // lápis
  { block: 28, minY: 0, maxY: 16, peakY: 6, attempts: 1, minSize: 1, maxSize: 8 },    // diamante
];

/** Conjunto de campos de ruído de uma seed. Criar é caro; reusar é obrigatório. */
export class TerrainNoise {
  readonly continent: Noise;
  readonly erosion: Noise;
  readonly temperature: Noise;
  readonly humidity: Noise;
  readonly weirdness: Noise;
  readonly detail: Noise;
  readonly cheese: Noise;
  readonly spaghettiA: Noise;
  readonly spaghettiB: Noise;
  readonly river: Noise;

  constructor(seed: number) {
    this.continent = new Noise(seed, SALT_CONTINENT);
    this.erosion = new Noise(seed, SALT_EROSION);
    this.temperature = new Noise(seed, SALT_TEMPERATURE);
    this.humidity = new Noise(seed, SALT_HUMIDITY);
    this.weirdness = new Noise(seed, SALT_WEIRDNESS);
    this.detail = new Noise(seed, SALT_DETAIL);
    this.cheese = new Noise(seed, SALT_CHEESE);
    this.spaghettiA = new Noise(seed, SALT_SPAGHETTI_A);
    this.spaghettiB = new Noise(seed, SALT_SPAGHETTI_B);
    this.river = new Noise(seed, SALT_RIVER);
    this.field = new HeightField(this);
  }

  /**
   * Campo de altura e bioma desta seed. Mora aqui porque tem o mesmo ciclo de
   * vida do ruído — um por worker — e porque `prepare` reusa os buffers dele a
   * cada chunk em vez de alocar.
   */
  readonly field: HeightField;
}

export interface GenerateOptions {
  /** Desliga cavernas/minérios em testes de determinismo rápidos. */
  caves?: boolean;
  ores?: boolean;
  /** Árvores e plantas (doc 03 §4). */
  decoration?: boolean;
  /** Dungeon, mina e aldeia (doc 03 §7). */
  structures?: boolean;
}

/** Gera uma coluna completa. */
export function generateChunk(
  seed: number, noise: TerrainNoise, cx: number, cz: number, options: GenerateOptions = {},
): ChunkColumn {
  const chunk = new ChunkColumn(cx, cz);
  const withCaves = options.caves ?? true;
  const withOres = options.ores ?? true;
  const withDecoration = options.decoration ?? true;
  const withStructures = options.structures ?? true;

  const heights = HEIGHT_SCRATCH;
  const biomes = BIOME_SCRATCH;

  // 1–3. campo de altura e bioma, já com o blend do doc 03 §4.3
  const field = noise.field;
  field.prepare(cx, cz);
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const wx = cx * SECTION_SIZE + lx;
      const wz = cz * SECTION_SIZE + lz;
      const s = field.sample(wx, wz);
      const i = (lz << 4) | lx;
      heights[i] = s.height;
      biomes[i] = s.biome;
      chunk.biomeMap[i] = s.biome;
    }
  }

  // 4. terreno base + 6. superfície
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const i = (lz << 4) | lx;
      const height = heights[i];
      const biome = BIOMES[biomes[i]];
      const wx = cx * SECTION_SIZE + lx;
      const wz = cz * SECTION_SIZE + lz;

      for (let y = 0; y <= height; y++) {
        let block = STONE;
        if (y === 0) {
          block = BEDROCK;
        } else if (y <= 3) {
          // Bedrock irregular nas camadas 1..3.
          block = valueNoise3(seed, wx, y, wz) < (4 - y) / 4 ? BEDROCK : STONE;
        } else if (y === height) {
          // Debaixo d'água a superfície vira cascalho/areia, não grama.
          block = height < SEA_LEVEL ? (height < SEA_LEVEL - 4 ? GRAVEL : SAND) : biome.surface;
        } else if (y >= height - 3) {
          block = height < SEA_LEVEL ? (height < SEA_LEVEL - 4 ? GRAVEL : SAND) : biome.filler;
        }
        chunk.setBlock(lx, y, lz, block);
      }

      // Água até o nível do mar.
      for (let y = height + 1; y <= SEA_LEVEL; y++) {
        chunk.setBlock(lx, y, lz, WATER);
      }
    }
  }

  // 5. cavernas
  if (withCaves) carveCaves(chunk, noise, seed, cx, cz, heights);

  // 7. minérios
  if (withOres) placeOres(chunk, seed, cx, cz, heights);

  // 8. árvores e plantas — antes do heightmap e da luz, que precisam vê-las.
  if (withDecoration) decorate(chunk, seed, field);

  // 9. estruturas — depois da decoração, para a casa não nascer com árvore
  // dentro; antes do heightmap e da luz, que precisam vê-las (doc 03 §7).
  if (withStructures) placeStructures(chunk, seed, field);

  chunk.recomputeHeightMap();
  computeChunkLight(chunk);
  return chunk;
}

/**
 * Cavernas: *cheese* (salões) + *spaghetti* (túneis, interseção de dois campos).
 * Nunca esculpe bedrock, e abaixo de Y=10 o vazio vira lava (doc 03 §5).
 */
function carveCaves(
  chunk: ChunkColumn, noise: TerrainNoise, seed: number, cx: number, cz: number,
  heights: Uint8Array,
): void {
  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      const wx = cx * SECTION_SIZE + lx;
      const wz = cz * SECTION_SIZE + lz;
      const surface = heights[(lz << 4) | lx];
      // Não esculpir logo abaixo do oceano: evita o mar vazar para a caverna.
      const top = Math.min(surface - 2, surface < SEA_LEVEL ? SEA_LEVEL - 6 : surface - 2);

      for (let y = 4; y <= top; y++) {
        const current = chunk.getBlock(lx, y, lz);
        if (current !== STONE) continue;

        let carve = false;
        if (y < 60) {
          const cheese = noise.cheese.noise3(wx / 70, y / 40, wz / 70);
          if (Math.abs(cheese) < CHEESE_THRESHOLD) carve = true;
        }
        if (!carve) {
          // Interseção de dois campos independentes = tubo. Testar o primeiro
          // antes evita amostrar o segundo em ~95% dos voxels.
          const a = noise.spaghettiA.noise3(wx / 90, y / 55, wz / 90);
          if (Math.abs(a) < SPAGHETTI_THRESHOLD) {
            const b = noise.spaghettiB.noise3(wx / 90 + 31.7, y / 55 - 12.3, wz / 90 + 7.1);
            if (Math.abs(b) < SPAGHETTI_THRESHOLD) carve = true;
          }
        }
        if (!carve) continue;

        chunk.setBlock(lx, y, lz, y < 10 ? LAVA : AIR);
      }
    }
  }

  carveRavines(chunk, seed, cx, cz, heights);
}

/** Uma ravina a cada ~150 chunks (doc 03 §5). */
const RAVINE_CHANCE = 1 / 150;
/** Alcance de busca: a ravina nasce até 3 chunks daqui e ainda alcança este. */
const RAVINE_RADIUS = 3;
/** Sal do RNG de ravina. */
const SALT_RAVINE = 50;

/**
 * Ravinas: fenda vertical de 3–12 de largura e 40–70 de comprimento, do Y=10
 * até a superfície (doc 03 §5).
 *
 * É uma **linha reta com raio variável**, não um caminho serpenteante: o
 * serpenteado exigiria estado entre chunks, e o orçamento de geração de T0 não
 * o comporta. O ruído na largura por segmento é o que quebra a linha e evita
 * que ela pareça um corte de bisturi.
 *
 * Cada chunk varre as ravinas nascidas nos vizinhos ao alcance, pela mesma
 * razão da árvore em `decorate.ts`: sem isso, a fenda pararia na borda do chunk.
 */
function carveRavines(
  chunk: ChunkColumn, seed: number, cx: number, cz: number, heights: Uint8Array,
): void {
  for (let dz = -RAVINE_RADIUS; dz <= RAVINE_RADIUS; dz++) {
    for (let dx = -RAVINE_RADIUS; dx <= RAVINE_RADIUS; dx++) {
      const ocx = cx + dx;
      const ocz = cz + dz;
      const roll = hash2(seed, ocx, ocz, SALT_RAVINE);
      if (roll / 4294967296 >= RAVINE_CHANCE) continue;
      carveOneRavine(chunk, seed, ocx, ocz, roll, heights);
    }
  }
}

function carveOneRavine(
  chunk: ChunkColumn, seed: number, ocx: number, ocz: number, roll: number,
  heights: Uint8Array,
): void {
  const startX = ocx * SECTION_SIZE + (roll & 15);
  const startZ = ocz * SECTION_SIZE + ((roll >>> 4) & 15);
  const angle = ((roll >>> 8) & 0xff) / 255 * Math.PI * 2;
  const length = 40 + ((roll >>> 16) & 0x1f);
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);

  const baseX = chunk.cx * SECTION_SIZE;
  const baseZ = chunk.cz * SECTION_SIZE;

  for (let step = 0; step < length; step++) {
    const wx = Math.round(startX + dirX * step);
    const wz = Math.round(startZ + dirZ * step);
    // Fora do chunk (com folga do raio máximo) não custa amostrar largura.
    if (wx < baseX - 8 || wx >= baseX + SECTION_SIZE + 8) continue;
    if (wz < baseZ - 8 || wz >= baseZ + SECTION_SIZE + 8) continue;

    // Largura afunila nas pontas: no meio a fenda é larga, na borda fecha.
    const t = step / length;
    const taper = Math.sin(t * Math.PI);
    const wobble = hash3(seed, wx, step, wz, SALT_RAVINE + 1) / 4294967296;
    const radius = Math.max(1, Math.round((1.5 + wobble * 4.5) * taper));

    for (let oz = -radius; oz <= radius; oz++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oz * oz > radius * radius) continue;
        const lx = wx + ox - baseX;
        const lz = wz + oz - baseZ;
        if (lx < 0 || lx >= SECTION_SIZE || lz < 0 || lz >= SECTION_SIZE) continue;

        const surface = heights[(lz << 4) | lx];
        // Não abrir ravina no fundo do mar: o oceano vazaria para dentro dela.
        if (surface < SEA_LEVEL + 1) continue;
        const top = surface - 1;

        for (let y = 10; y <= top; y++) {
          if (chunk.getBlock(lx, y, lz) !== STONE) continue;
          chunk.setBlock(lx, y, lz, AIR);
        }
      }
    }
  }
}

/**
 * Minérios como blobs. A posição de cada tentativa vem de `valueNoise3` sobre
 * `(seed, chunk, índice)` — determinístico e independente da ordem.
 *
 * A faixa de Y usa distribuição **triangular** em torno do pico, o que é o que
 * dá a sensação de "diamante é raro lá embaixo" (doc 03 §6).
 */
function placeOres(
  chunk: ChunkColumn, seed: number, cx: number, cz: number, heights: Uint8Array,
): void {
  for (let o = 0; o < ORES.length; o++) {
    const ore = ORES[o];
    for (let attempt = 0; attempt < ore.attempts; attempt++) {
      const salt = SALT_ORE + o * 97 + attempt * 7919;
      const r1 = valueNoise3(seed ^ salt, cx, attempt, cz);
      const r2 = valueNoise3(seed ^ (salt + 1), cx, attempt + 61, cz);
      const r3 = valueNoise3(seed ^ (salt + 2), cx, attempt + 131, cz);
      const r4 = valueNoise3(seed ^ (salt + 3), cx, attempt + 211, cz);

      const y = ore.peakY < 0
        ? ore.minY + Math.floor(r1 * (ore.maxY - ore.minY + 1))
        : triangularY(r1, r2, ore.minY, ore.maxY, ore.peakY);
      if (y < 1 || y >= WORLD_HEIGHT) continue;

      const ox = Math.floor(r2 * SECTION_SIZE);
      const oz = Math.floor(r3 * SECTION_SIZE);
      const size = ore.minSize + Math.floor(r4 * (ore.maxSize - ore.minSize + 1));
      const surface = heights[((oz & 15) << 4) | (ox & 15)];

      placeOreBlob(chunk, seed, salt, ox, y, oz, size, ore.block, surface);
    }
  }
}

/** Y triangular: mais provável no pico, decaindo linear até as pontas. */
function triangularY(r1: number, r2: number, minY: number, maxY: number, peakY: number): number {
  // Soma de duas uniformes centrada no pico dá uma triangular sem tabela.
  const spread = Math.max(peakY - minY, maxY - peakY);
  const offset = (r1 + r2 - 1) * spread;
  return Math.round(clamp(peakY + offset, minY, maxY));
}

/** Blob elipsoidal irregular. Só substitui pedra. */
function placeOreBlob(
  chunk: ChunkColumn, seed: number, salt: number,
  ox: number, oy: number, oz: number, size: number, block: number, surface: number,
): void {
  const radius = Math.max(1, Math.cbrt(size) * 0.9);
  const r = Math.ceil(radius);
  let placed = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (placed >= size) return;
        const x = ox + dx;
        const y = oy + dy;
        const z = oz + dz;
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y >= WORLD_HEIGHT) continue;
        // Contorno irregular: o ruído deforma a esfera.
        const jitter = valueNoise3(seed ^ salt, x + ox * 31, y, z + oz * 17) * 0.6;
        if (dx * dx + dy * dy + dz * dz > (radius + jitter) * (radius + jitter)) continue;
        if (chunk.getBlock(x, y, z) !== STONE) continue;
        // Doc 03 §6: não deixar minério à mostra na superfície de montanha.
        if (y > SEA_LEVEL && y >= surface - 1) continue;
        chunk.setBlock(x, y, z, block);
        placed++;
      }
    }
  }
}

/**
 * Skylight colunar: 15 até o primeiro bloco que atenua luz, decaindo abaixo.
 *
 * A atenuação vem da tabela de blocos, não de um `if` por tipo: folha e água
 * tiram 1, bloco opaco tira os 15. **Isso importa desde que existem árvores** —
 * com atenuação fixa de 15, tudo debaixo de uma copa ficava preto, e a floresta
 * virava um tabuleiro de manchas escuras em pleno meio-dia.
 *
 * Continua sendo aproximação: a luz que entra de lado (boca de caverna, janela)
 * é espalhada pelo flood fill de `world/lighting.ts`.
 */
function computeColumnSkyLight(chunk: ChunkColumn): void {
  for (let sy = 0; sy < chunk.sections.length; sy++) {
    const section = chunk.sections[sy];
    if (section.skyLight === null) section.skyLight = new Uint8Array(2048);
    else section.skyLight.fill(0);
    if (section.blockLight === null) section.blockLight = new Uint8Array(2048);
  }

  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      let light = 15;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const state = chunk.getBlock(lx, y, lz);
        if (state !== AIR) {
          light = Math.max(0, light - defOf(state).lightAttenuation);
        }
        setSkyLight(chunk, lx, y, lz, light);
        if (light === 0) break;
      }
    }
  }
}

/**
 * Luz completa de uma coluna: céu (colunar + espalhamento lateral) e luz de
 * bloco (tocha, lava, pedra luminosa).
 *
 * Exportada porque o **save** também precisa dela: a luz não é gravada (doc 11
 * §2), então uma coluna que volta do disco chega sem luz nenhuma e precisa ser
 * recalculada antes de entrar no mundo.
 */
export function computeChunkLight(chunk: ChunkColumn): void {
  computeColumnSkyLight(chunk);
  spreadSkyLight(chunk);
  spreadBlockLight(chunk);
}

/**
 * Luz de bloco a partir das fontes da própria coluna.
 *
 * Sem isto a lava no fundo da caverna não ilumina nada — o bloco declara
 * `emission: 15` na tabela, mas quem espalha é o flood fill.
 */
function spreadBlockLight(chunk: ChunkColumn): void {
  let head = 0;
  let tail = 0;
  const mask = SKY_QUEUE.length - 1;

  // A varredura só entra nas sections cuja **paleta** tem algum bloco que
  // emite luz. Sem esse filtro, procurar tocha e lava custa 32 mil consultas
  // por chunk — e a esmagadora maioria das sections não tem fonte nenhuma.
  for (let sy = 0; sy < chunk.sections.length; sy++) {
    if (!sectionEmits(chunk, sy)) continue;
    const baseY = sy * SECTION_SIZE;
    for (let y = baseY; y < baseY + SECTION_SIZE; y++) {
      for (let z = 0; z < SECTION_SIZE; z++) {
        for (let x = 0; x < SECTION_SIZE; x++) {
          const emission = defOf(chunk.getBlock(x, y, z)).emission;
          if (emission === 0) continue;
          setBlockLight(chunk, x, y, z, emission);
          SKY_QUEUE[tail] = (x << 20) | (z << 16) | (y << 8) | emission;
          tail = (tail + 1) & mask;
          if (tail === head) return;
        }
      }
    }
  }

  while (head !== tail) {
    const packed = SKY_QUEUE[head];
    head = (head + 1) & mask;
    const x = (packed >> 20) & 15;
    const z = (packed >> 16) & 15;
    const y = (packed >> 8) & 0xff;
    const level = packed & 0xff;
    if (level <= 1) continue;

    for (let i = 0; i < 6; i++) {
      const nx = x + SKY_NEIGHBORS[i * 3];
      const ny = y + SKY_NEIGHBORS[i * 3 + 1];
      const nz = z + SKY_NEIGHBORS[i * 3 + 2];
      if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;

      const attenuation = defOf(chunk.getBlock(nx, ny, nz)).lightAttenuation;
      if (attenuation >= 15) continue;
      const next = level - Math.max(1, attenuation);
      if (next <= 0) continue;
      if (getBlockLight(chunk, nx, ny, nz) >= next) continue;

      setBlockLight(chunk, nx, ny, nz, next);
      SKY_QUEUE[tail] = (nx << 20) | (nz << 16) | (ny << 8) | next;
      tail = (tail + 1) & mask;
      if (tail === head) return;
    }
  }
}

/** true se a paleta da section tem algum bloco que emite luz. */
function sectionEmits(chunk: ChunkColumn, sy: number): boolean {
  const section = chunk.sections[sy];
  if (section.data === null) return false;
  for (let i = 0; i < section.paletteLen; i++) {
    if (defOf(section.palette[i]).emission > 0) return true;
  }
  return false;
}

/**
 * Espalha a luz do céu lateralmente **dentro do chunk** (BFS).
 *
 * Roda no worker, junto da geração, e não na thread principal: é o que ilumina
 * a sombra de um barranco e a boca de uma caverna sem custar frame nenhum. A
 * luz não atravessa a borda do chunk — o vizinho ainda pode nem existir — e
 * essa é a aproximação aceita; o flood fill completo de `world/lighting.ts`
 * cuida do que muda depois, em jogo.
 *
 * Só entram na fila os voxels de **fronteira** (os que têm vizinho mais escuro
 * do que deveriam). Enfileirar a coluna iluminada inteira encheria a fila com
 * dezenas de milhares de posições que não mudam nada.
 */
const SKY_QUEUE = new Int32Array(1 << 16);

function spreadSkyLight(chunk: ChunkColumn): void {
  let top = 0;
  for (let i = 0; i < chunk.heightMap.length; i++) {
    if (chunk.heightMap[i] > top) top = chunk.heightMap[i];
  }
  top = Math.min(WORLD_HEIGHT - 1, top + 1);

  let head = 0;
  let tail = 0;
  const mask = SKY_QUEUE.length - 1;

  for (let lz = 0; lz < SECTION_SIZE; lz++) {
    for (let lx = 0; lx < SECTION_SIZE; lx++) {
      for (let y = top; y >= 0; y--) {
        const level = getSkyLight(chunk, lx, y, lz);
        if (level === 0) break;
        if (level <= 1) continue;
        if (!hasDarkerNeighbor(chunk, lx, y, lz, level)) continue;
        SKY_QUEUE[tail] = (lx << 20) | (lz << 16) | (y << 8) | level;
        tail = (tail + 1) & mask;
        if (tail === head) return; // fila cheia: melhor sair do que girar
      }
    }
  }

  while (head !== tail) {
    const packed = SKY_QUEUE[head];
    head = (head + 1) & mask;
    const x = (packed >> 20) & 15;
    const z = (packed >> 16) & 15;
    const y = (packed >> 8) & 0xff;
    const level = packed & 0xff;
    if (level <= 1) continue;

    for (let i = 0; i < 6; i++) {
      const nx = x + SKY_NEIGHBORS[i * 3];
      const ny = y + SKY_NEIGHBORS[i * 3 + 1];
      const nz = z + SKY_NEIGHBORS[i * 3 + 2];
      if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;

      const attenuation = defOf(chunk.getBlock(nx, ny, nz)).lightAttenuation;
      if (attenuation >= 15) continue;
      const goingDown = SKY_NEIGHBORS[i * 3 + 1] === -1 && level === 15 && attenuation === 0;
      const next = goingDown ? 15 : level - Math.max(1, attenuation);
      if (next <= 0) continue;
      if (getSkyLight(chunk, nx, ny, nz) >= next) continue;

      setSkyLight(chunk, nx, ny, nz, next);
      SKY_QUEUE[tail] = (nx << 20) | (nz << 16) | (ny << 8) | next;
      tail = (tail + 1) & mask;
      if (tail === head) return;
    }
  }
}

const SKY_NEIGHBORS = new Int32Array([
  1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
]);

function hasDarkerNeighbor(
  chunk: ChunkColumn, x: number, y: number, z: number, level: number,
): boolean {
  for (let i = 0; i < 6; i++) {
    const nx = x + SKY_NEIGHBORS[i * 3];
    const ny = y + SKY_NEIGHBORS[i * 3 + 1];
    const nz = z + SKY_NEIGHBORS[i * 3 + 2];
    if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
    if (ny < 0 || ny >= WORLD_HEIGHT) continue;
    const attenuation = defOf(chunk.getBlock(nx, ny, nz)).lightAttenuation;
    if (attenuation >= 15) continue;
    const goingDown = SKY_NEIGHBORS[i * 3 + 1] === -1 && level === 15 && attenuation === 0;
    const next = goingDown ? 15 : level - Math.max(1, attenuation);
    if (next <= 0) continue;
    if (getSkyLight(chunk, nx, ny, nz) < next) return true;
  }
  return false;
}

function getBlockLight(chunk: ChunkColumn, x: number, y: number, z: number): number {
  const light = chunk.sections[y >> 4].blockLight;
  if (light === null) return 0;
  return readNibble(light, ((y & 15) << 8) | (z << 4) | x);
}

function setBlockLight(chunk: ChunkColumn, x: number, y: number, z: number, value: number): void {
  const section = chunk.sections[y >> 4];
  if (section.blockLight === null) section.blockLight = new Uint8Array(2048);
  const light = section.blockLight;
  const index = ((y & 15) << 8) | (z << 4) | x;
  const byte = index >> 1;
  if ((index & 1) === 0) light[byte] = (light[byte] & 0xf0) | (value & 0xf);
  else light[byte] = (light[byte] & 0x0f) | ((value & 0xf) << 4);
}

/** Luz do céu de um voxel local do chunk. */
function getSkyLight(chunk: ChunkColumn, x: number, y: number, z: number): number {
  const sky = chunk.sections[y >> 4].skyLight;
  if (sky === null) return 0;
  const index = ((y & 15) << 8) | (z << 4) | x;
  return readNibble(sky, index);
}

function setSkyLight(chunk: ChunkColumn, x: number, y: number, z: number, value: number): void {
  const section = chunk.sections[y >> 4];
  const sky = section.skyLight;
  if (sky === null) return;
  const index = ((y & 15) << 8) | (z << 4) | x;
  const byte = index >> 1;
  if ((index & 1) === 0) sky[byte] = (sky[byte] & 0xf0) | (value & 0xf);
  else sky[byte] = (sky[byte] & 0x0f) | ((value & 0xf) << 4);
}

/** Lê um nibble de luz de um array de 2048 bytes. */
export function readNibble(data: Uint8Array, index: number): number {
  const byte = data[index >> 1];
  return (index & 1) === 0 ? byte & 0xf : (byte >> 4) & 0xf;
}

const HEIGHT_SCRATCH = new Uint8Array(SECTION_SIZE * SECTION_SIZE);
const BIOME_SCRATCH = new Uint8Array(SECTION_SIZE * SECTION_SIZE);
