/**
 * Tabela declarativa de biomas (doc 03 §4.3).
 *
 * A seleção é um lookup no espaço temperatura × umidade, com regras de
 * continentalidade/erosão antes. As cores de tint são multiplicadas nas
 * texturas em escala de cinza (grama, folhas, água).
 */

import { GRASS_BLOCK, DIRT, SAND, SANDSTONE, GRAVEL, STONE, SNOW_BLOCK, PODZOL } from './blocks';

export interface BiomeDef {
  id: number;
  name: string;
  display: string;
  /** Bloco de superfície e o que vem logo abaixo. */
  surface: number;
  filler: number;
  /** Deslocamento de altura sobre a base calculada pelas splines. */
  heightOffset: number;
  /** Multiplicador de amplitude do ruído de detalhe. */
  heightScale: number;
  /** Cores de tint, em 0xRRGGBB. */
  grassTint: number;
  foliageTint: number;
  waterTint: number;
  /** Faixas de seleção; `undefined` = não participa do lookup normal. */
  temperature?: [number, number];
  humidity?: [number, number];
  /**
   * Variação de outro bioma (M14): uma caixa pequena dentro da caixa do pai.
   * Dentro dela, a variação ganha; fora, ela nem concorre. É o que deixa a
   * floresta de bétula aparecer **no meio** da floresta, e não disputar a
   * fronteira com ela.
   */
  variant?: boolean;
}

export const BIOMES: readonly BiomeDef[] = [
  { id: 0, name: 'ocean', display: 'Oceano', surface: GRAVEL, filler: GRAVEL,
    heightOffset: 0, heightScale: 0.4,
    grassTint: 0x8eb971, foliageTint: 0x71a74d, waterTint: 0x3f76e4 },

  { id: 1, name: 'beach', display: 'Praia', surface: SAND, filler: SANDSTONE,
    heightOffset: 0, heightScale: 0.25,
    grassTint: 0x91bd59, foliageTint: 0x77ab2f, waterTint: 0x3f76e4 },

  { id: 2, name: 'plains', display: 'Planície', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: 2, heightScale: 0.6,
    grassTint: 0x91bd59, foliageTint: 0x77ab2f, waterTint: 0x3f76e4,
    temperature: [0.3, 0.8], humidity: [0.2, 0.6] },

  { id: 3, name: 'forest', display: 'Floresta', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: 4, heightScale: 0.9,
    grassTint: 0x79c05a, foliageTint: 0x59ae30, waterTint: 0x3f76e4,
    temperature: [0.2, 0.7], humidity: [0.5, 1.0] },

  { id: 4, name: 'taiga', display: 'Taiga', surface: GRASS_BLOCK, filler: PODZOL,
    heightOffset: 6, heightScale: 1.1,
    grassTint: 0x86b783, foliageTint: 0x68a464, waterTint: 0x3d57d6,
    temperature: [-0.3, 0.2], humidity: [0.4, 1.0] },

  { id: 5, name: 'desert', display: 'Deserto', surface: SAND, filler: SANDSTONE,
    heightOffset: 1, heightScale: 0.7,
    grassTint: 0xbfb755, foliageTint: 0xaea42a, waterTint: 0x32a598,
    temperature: [0.8, 1.0], humidity: [-1.0, 0.3] },

  { id: 6, name: 'savanna', display: 'Savana', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: 3, heightScale: 0.8,
    grassTint: 0xbfb755, foliageTint: 0xaea42a, waterTint: 0x3f76e4,
    temperature: [0.7, 1.0], humidity: [0.3, 0.5] },

  { id: 7, name: 'snowy_plains', display: 'Planície Nevada', surface: SNOW_BLOCK, filler: DIRT,
    heightOffset: 2, heightScale: 0.6,
    grassTint: 0x80b497, foliageTint: 0x60a17b, waterTint: 0x3938c9,
    temperature: [-1.0, -0.4], humidity: [-1.0, 1.0] },

  { id: 8, name: 'mountains', display: 'Montanhas', surface: STONE, filler: STONE,
    heightOffset: 26, heightScale: 2.2,
    grassTint: 0x8ab689, foliageTint: 0x6da36b, waterTint: 0x3f76e4 },

  // M14: mais escuro que o do gênero, para o pântano se ler de longe agora
  // que o tint de bioma existe.
  { id: 9, name: 'swamp', display: 'Pântano', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: -2, heightScale: 0.3,
    grassTint: 0x5a6232, foliageTint: 0x4f5a2c, waterTint: 0x4c6a55,
    temperature: [0.5, 0.8], humidity: [0.8, 1.0] },

  // M14: o rio não entra no lookup — quem o marca é o canal, em
  // `world/gen/heightfield.ts`. O leito sai de areia pela regra de "debaixo
  // d'água" do terreno; o bioma existe para o afogado e para o tint.
  { id: 10, name: 'river', display: 'Rio', surface: SAND, filler: SAND,
    heightOffset: 0, heightScale: 0.4,
    grassTint: 0x91bd59, foliageTint: 0x77ab2f, waterTint: 0x3f76e4 },

  // M14: variações que só custam tint (e uma linha de decoração).
  { id: 11, name: 'birch_forest', display: 'Floresta de Bétula', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: 4, heightScale: 0.8,
    grassTint: 0x88bb67, foliageTint: 0x6ba941, waterTint: 0x3f76e4,
    temperature: [0.25, 0.45], humidity: [0.6, 0.85], variant: true },

  { id: 12, name: 'flower_plains', display: 'Planície Florida', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: 2, heightScale: 0.5,
    grassTint: 0x9ccb5b, foliageTint: 0x7fb335, waterTint: 0x3f76e4,
    temperature: [0.4, 0.6], humidity: [0.25, 0.4], variant: true },

  // M14: a selva, quente e úmida — o canto da tabela que era do pântano e da
  // savana por falta de dono. Custa as cinco camadas da madeira nova.
  { id: 13, name: 'jungle', display: 'Selva', surface: GRASS_BLOCK, filler: DIRT,
    heightOffset: 5, heightScale: 1.0,
    grassTint: 0x59c93c, foliageTint: 0x30bb0b, waterTint: 0x3f76e4,
    temperature: [0.8, 1.0], humidity: [0.55, 1.0] },
];

export const BIOME_OCEAN = 0;
export const BIOME_BEACH = 1;
export const BIOME_PLAINS = 2;
export const BIOME_MOUNTAINS = 8;
export const BIOME_RIVER = 10;

/** Tabela achatada de tints, para o shader consultar por índice sem branch. */
export function biomeTintTable(): Float32Array {
  const out = new Float32Array(BIOMES.length * 9);
  for (let i = 0; i < BIOMES.length; i++) {
    const b = BIOMES[i];
    writeColor(out, i * 9, b.grassTint);
    writeColor(out, i * 9 + 3, b.foliageTint);
    writeColor(out, i * 9 + 6, b.waterTint);
  }
  return out;
}

function writeColor(out: Float32Array, offset: number, hex: number): void {
  out[offset] = ((hex >> 16) & 255) / 255;
  out[offset + 1] = ((hex >> 8) & 255) / 255;
  out[offset + 2] = (hex & 255) / 255;
}

/**
 * Escolhe o bioma a partir dos mapas de ruído. A ordem importa: oceano e praia
 * vêm da continentalidade/altura, montanha da erosão, e só o resto cai no
 * lookup de temperatura × umidade.
 */
export function pickBiome(
  height: number, seaLevel: number, temperature: number, humidity: number, erosion: number,
): number {
  if (height < seaLevel - 2) return BIOME_OCEAN;
  if (height <= seaLevel + 2) return BIOME_BEACH;
  // Erosão baixa = relevo acentuado; acima de certa altura vira montanha.
  if (erosion < -0.35 && height > seaLevel + 26) return BIOME_MOUNTAINS;

  return pickClimateBiome(temperature, humidity);
}

/**
 * A parte do lookup que só olha o clima: o bioma que a temperatura e a
 * umidade pedem, sem as regras de altura. É também o que pinta a tabela de
 * cores do tint (`render/biometint.ts`).
 */
export function pickClimateBiome(temperature: number, humidity: number): number {
  // Variação primeiro: dentro da caixa dela, ela ganha do pai.
  for (let i = 0; i < BIOMES.length; i++) {
    const b = BIOMES[i];
    if (b.variant !== true || b.temperature === undefined || b.humidity === undefined) continue;
    if (axisDistance(temperature, b.temperature) === 0 && axisDistance(humidity, b.humidity) === 0) {
      return b.id;
    }
  }
  let best = BIOME_PLAINS;
  let bestScore = Infinity;
  for (let i = 0; i < BIOMES.length; i++) {
    const b = BIOMES[i];
    if (b.variant === true || b.temperature === undefined || b.humidity === undefined) continue;
    // Distância até a caixa de seleção: 0 dentro dela, cresce para fora.
    const dt = axisDistance(temperature, b.temperature);
    const dh = axisDistance(humidity, b.humidity);
    const score = dt * dt + dh * dh;
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  return best;
}

function axisDistance(value: number, range: [number, number]): number {
  if (value < range[0]) return range[0] - value;
  if (value > range[1]) return value - range[1];
  return 0;
}
