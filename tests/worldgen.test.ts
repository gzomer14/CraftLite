/**
 * Integração: geração → mundo → vizinhança → meshing.
 *
 * Cobre o que o doc 14 chama de teste de determinismo: a mesma seed tem que dar
 * o mesmo chunk em qualquer ordem e com qualquer número de workers.
 */
import { describe, expect, it } from 'vitest';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { World } from '../src/world/world';
import { ChunkColumn, SEA_LEVEL, WORLD_HEIGHT, SECTIONS_PER_COLUMN } from '../src/world/chunk';
import { extractNeighborhood, NB_VOLUME } from '../src/world/neighborhood';
import { GreedyMesher } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { AIR, BEDROCK, STONE, WATER, blockIdOf, makeState } from '../src/data/blocks';

const SEED = 987654;
const tables = buildBlockTables(buildLayerIndex());

/** Serializa uma coluna para comparação exata. */
function fingerprint(chunk: ReturnType<typeof generateChunk>): string {
  const out: number[] = [];
  for (let y = 0; y < WORLD_HEIGHT; y += 3) {
    for (let z = 0; z < 16; z += 2) {
      for (let x = 0; x < 16; x += 2) out.push(chunk.getBlock(x, y, z));
    }
  }
  return out.join(',');
}

describe('determinismo da geração', () => {
  it('a mesma seed e coordenada dão o mesmo chunk', () => {
    const a = generateChunk(SEED, new TerrainNoise(SEED), 3, -7);
    const b = generateChunk(SEED, new TerrainNoise(SEED), 3, -7);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('a ordem de geração não muda o resultado', () => {
    const noise = new TerrainNoise(SEED);
    const direct = fingerprint(generateChunk(SEED, noise, 5, 5));
    // Gera outros chunks no meio, simulando N workers fora de ordem.
    generateChunk(SEED, noise, -12, 40);
    generateChunk(SEED, noise, 0, 0);
    generateChunk(SEED, noise, 99, -99);
    expect(fingerprint(generateChunk(SEED, noise, 5, 5))).toBe(direct);
  });

  it('instâncias diferentes de TerrainNoise com a mesma seed são equivalentes', () => {
    const a = generateChunk(SEED, new TerrainNoise(SEED), -4, 9);
    const b = generateChunk(SEED, new TerrainNoise(SEED), -4, 9);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('seeds diferentes dão mundos diferentes', () => {
    const a = generateChunk(1, new TerrainNoise(1), 0, 0);
    const b = generateChunk(2, new TerrainNoise(2), 0, 0);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});

describe('invariantes do terreno', () => {
  const noise = new TerrainNoise(SEED);
  const chunks = [
    generateChunk(SEED, noise, 0, 0),
    generateChunk(SEED, noise, 20, -35),
    generateChunk(SEED, noise, -60, 80),
  ];

  it('Y=0 é sempre bedrock', () => {
    for (const chunk of chunks) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          expect(blockIdOf(chunk.getBlock(x, 0, z))).toBe(BEDROCK);
        }
      }
    }
  });

  it('o topo do mundo é sempre ar', () => {
    for (const chunk of chunks) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          expect(chunk.getBlock(x, WORLD_HEIGHT - 1, z)).toBe(AIR);
        }
      }
    }
  });

  it('não há água acima do nível do mar', () => {
    for (const chunk of chunks) {
      for (let y = SEA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            expect(blockIdOf(chunk.getBlock(x, y, z)), `y=${y}`).not.toBe(WATER);
          }
        }
      }
    }
  });

  it('não há bloco flutuando acima do heightmap', () => {
    for (const chunk of chunks) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const h = chunk.heightMap[(z << 4) | x];
          for (let y = h + 1; y < WORLD_HEIGHT; y++) {
            expect(chunk.getBlock(x, y, z)).toBe(AIR);
          }
        }
      }
    }
  });

  it('toda coluna tem terreno em uma faixa plausível', () => {
    for (const chunk of chunks) {
      for (let i = 0; i < 256; i++) {
        expect(chunk.heightMap[i]).toBeGreaterThan(3);
        expect(chunk.heightMap[i]).toBeLessThan(WORLD_HEIGHT - 3);
      }
    }
  });

  it('a superfície ao ar livre recebe luz do céu 15', () => {
    const chunk = chunks[0];
    const section = chunk.sections[SEA_LEVEL >> 4];
    expect(section.skyLight).not.toBeNull();
    // O bloco logo acima do topo de uma coluna tem que estar iluminado.
    let checked = 0;
    for (let x = 0; x < 16 && checked < 8; x++) {
      const h = chunk.heightMap[x];
      if (h + 1 >= WORLD_HEIGHT) continue;
      const s = chunk.sections[(h + 1) >> 4];
      if (s.skyLight === null) continue;
      const index = (((h + 1) & 15) << 8) | x;
      const byte = s.skyLight[index >> 1];
      const value = (index & 1) === 0 ? byte & 0xf : (byte >> 4) & 0xf;
      expect(value).toBe(15);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('as sections mais altas ficam vazias e sem alocação', () => {
    const chunk = chunks[0];
    const top = chunk.sections[SECTIONS_PER_COLUMN - 1];
    expect(top.isEmpty).toBe(true);
    expect(top.data).toBeNull();
  });

  /**
   * Regressão: `setByIndex` guardava o array de dados **antes** de resolver o
   * índice na paleta. Quando o estado novo estourava os bits, `growBits`
   * trocava `this.data` e a escrita caía no buffer descartado — o bloco
   * simplesmente não aparecia, só no voxel que fez a paleta crescer.
   */
  it('escrever o estado que estoura os bits da paleta não perde o bloco', () => {
    const chunk = new ChunkColumn(0, 0);
    // 1 bit → 2 estados. O terceiro força a subida para 2 bits.
    chunk.setBlock(0, 0, 0, makeState(1));
    chunk.setBlock(1, 0, 0, makeState(5));
    chunk.setBlock(2, 0, 0, makeState(8));
    expect(blockIdOf(chunk.getBlock(2, 0, 0))).toBe(8);

    // E segue valendo depois de mais uma subida (2 → 4 bits).
    for (let i = 0; i < 6; i++) chunk.setBlock(3 + i, 0, 0, makeState(10 + i));
    for (let i = 0; i < 6; i++) {
      expect(blockIdOf(chunk.getBlock(3 + i, 0, 0))).toBe(10 + i);
    }
    expect(chunk.sections[0].bits).toBeGreaterThanOrEqual(4);
  });

  it('a paleta cresce só o necessário', () => {
    // Uma section de subsolo tem pedra, minérios e ar: poucos estados distintos.
    const chunk = chunks[0];
    const deep = chunk.sections[1];
    expect(deep.paletteLen).toBeLessThan(16);
    expect(deep.bits).toBeLessThanOrEqual(4);
  });
});

describe('densidade de cavernas', () => {
  /**
   * O limiar do doc 03 §5 pressupõe um ruído com outra distribuição; com o
   * nosso Perlin ele escavaria 15–30% do subsolo. Este teste trava a
   * calibração: caverna demais estraga o visual e explode a contagem de faces.
   */
  it('escava entre 1% e 8% do sólido', () => {
    const noise = new TerrainNoise(SEED);
    const coords: [number, number][] = [[0, 0], [20, -35], [-60, 80], [5, 5]];
    let total = 0;
    for (const [cx, cz] of coords) {
      const plain = countSolid(generateChunk(SEED, noise, cx, cz, { caves: false, ores: false }));
      const caved = countSolid(generateChunk(SEED, noise, cx, cz, { caves: true, ores: false }));
      total += ((plain - caved) / plain) * 100;
    }
    const average = total / coords.length;
    expect(average).toBeGreaterThan(1);
    expect(average).toBeLessThan(8);
  });

  it('nunca escava a rocha-mãe', () => {
    const chunk = generateChunk(SEED, new TerrainNoise(SEED), 11, 11);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        expect(blockIdOf(chunk.getBlock(x, 0, z))).toBe(BEDROCK);
      }
    }
  });
});

function countSolid(chunk: ReturnType<typeof generateChunk>): number {
  let n = 0;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) if (chunk.getBlock(x, y, z) !== AIR) n++;
    }
  }
  return n;
}

describe('integração mundo → vizinhança → mesh', () => {
  it('gera, monta a vizinhança e produz geometria', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.addChunk(generateChunk(SEED, noise, dx, dz));
      }
    }

    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME);
    expect(extractNeighborhood(world, 0, 0, SEA_LEVEL >> 4, blocks, light)).toBe(true);

    const mesher = new GreedyMesher(tables, true);
    const mesh = mesher.mesh(blocks, light);
    expect(mesh.quads).toBeGreaterThan(0);
    expect(mesh.opaque).not.toBeNull();
    // Greedy de verdade: muito menos quads que faces individuais.
    expect(mesh.quads).toBeLessThan(16 * 16 * 16);
  });

  it('recusa a vizinhança quando falta um vizinho', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    world.addChunk(generateChunk(SEED, noise, 0, 0));
    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME);
    expect(extractNeighborhood(world, 0, 0, 4, blocks, light)).toBe(false);
  });

  it('a vizinhança traz os blocos do chunk vizinho na borda', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        world.addChunk(generateChunk(SEED, noise, dx, dz));
      }
    }
    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME);
    extractNeighborhood(world, 0, 0, 3, blocks, light);

    // O padding em x = −1 tem que ser o bloco x = 15 do chunk à esquerda.
    const y = 8;
    const fromNeighbor = world.getBlock(-1, 3 * 16 + y, 0);
    const inPadding = blocks[(y + 1) * 324 + 1 * 18 + 0];
    expect(inPadding).toBe(fromNeighbor);
  });
});

describe('mutação do mundo', () => {
  it('setBlock marca as sections vizinhas quando o bloco está na borda', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.addChunk(generateChunk(SEED, noise, dx, dz));
    }
    const scratch: number[] = [];
    world.takeDirtySections(scratch);

    // Usa o topo da coluna: y fixo pode cair dentro de uma caverna.
    const chunk = world.getChunk(0, 0)!;
    const y = chunk.heightMap[0];
    expect(world.setBlock(0, y, 0, AIR, 'player')).toBe(true);
    // A própria section + a do chunk a oeste + a do chunk ao norte.
    expect(world.dirtyCount).toBeGreaterThanOrEqual(3);
  });

  it('setBlock em chunk não carregado não faz nada', () => {
    const world = new World(SEED);
    expect(world.setBlock(9999, 40, 9999, AIR, 'player')).toBe(false);
  });

  it('marca o chunk como modificado só quando não é geração', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    const chunk = generateChunk(SEED, noise, 0, 0);
    world.addChunk(chunk);
    expect(chunk.modified).toBe(false);

    const y1 = chunk.heightMap[(1 << 4) | 1];
    expect(world.setBlock(1, y1, 1, AIR, 'gen')).toBe(true);
    expect(chunk.modified).toBe(false);

    const y2 = chunk.heightMap[(2 << 4) | 2];
    expect(world.setBlock(2, y2, 2, AIR, 'player')).toBe(true);
    expect(chunk.modified).toBe(true);
  });

  it('notifica quem escuta mudanças de bloco', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    world.addChunk(generateChunk(SEED, noise, 0, 0));

    let seen = 0;
    let lastSource = '';
    world.onBlockChange((change) => { seen++; lastSource = change.source; });
    const y = world.getChunk(0, 0)!.heightMap[(3 << 4) | 3];
    world.setBlock(3, y, 3, AIR, 'player');
    expect(seen).toBe(1);
    expect(lastSource).toBe('player');
  });

  it('ouvinte que muda outro bloco não corrompe o evento dos seguintes', () => {
    // O crescimento faz exatamente isto: ao ver a terra sumir, arranca a
    // plantação de cima de dentro do próprio evento.
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    world.addChunk(generateChunk(SEED, noise, 0, 0));
    const y = world.getChunk(0, 0)!.heightMap[(4 << 4) | 4];

    world.onBlockChange((change) => {
      if (change.y === y) world.setBlock(4, y + 4, 4, makeState(STONE), 'physics');
    });

    const seen: number[] = [];
    world.onBlockChange((change) => { seen.push(change.y); });

    world.setBlock(4, y, 4, AIR, 'player');

    // O segundo ouvinte vê a mudança de dentro **e** a de fora, nesta ordem,
    // cada uma com a própria posição.
    expect(seen).toEqual([y + 4, y]);
  });
});
