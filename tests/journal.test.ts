/**
 * M10 — saber onde se está: bússola, relógio, mapa, marcador, estatísticas e
 * espectador.
 *
 * Critério do doc 14: *"sair da base, andar 500 blocos, e voltar usando só o
 * mapa e o marcador. O mapa não pode custar mais que 1 ms por segundo de jogo
 * nem crescer o save de forma ilimitada."* — é o último `describe`, com a
 * geração de terreno de verdade.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { BLOCK_BY_NAME, WATER, makeState } from '../src/data/blocks';
import { itemId, makeStack, type ItemStack } from '../src/data/items';
import { RecipeBook, type CraftGrid } from '../src/game/crafting';
import {
  MAP_MAX_REGIONS, MAP_REGION, PIXEL_KNOWN, WorldMap, blockOfPixel, decodeRegion, encodeRegion,
  shadeOf,
} from '../src/game/worldmap';
import { MAX_MARKERS, Markers } from '../src/game/markers';
import { Journal } from '../src/game/journal';
import { formatStat } from '../src/data/stats';
import { DIMENSIONS } from '../src/data/dimensions';
import { clockFrame, compassFrame, spinFrame } from '../src/ui/dials';
import {
  MAP_VIEW, compassPoint, headingOnView, paintMapView, viewToWorld, worldToView,
} from '../src/ui/mapview';
import { buildItemSheet } from '../src/render/itemsprites';
import { DIAL_FRAMES } from '../src/data/itemart';
import { Player } from '../src/entity/player';

const GROUND_Y = 63;
const STONE = makeState(BLOCK_BY_NAME.get('stone')!.id);
const GRASS = BLOCK_BY_NAME.get('grass_block')!.id;
const POPPY = makeState(BLOCK_BY_NAME.get('poppy')!.id);

/** Planície de grama de `radius` chunks em volta da origem. */
function meadow(radius: number): World {
  const world = new World(1);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = 0; y < GROUND_Y; y++) chunk.setBlock(x, y, z, STONE);
          chunk.setBlock(x, GROUND_Y, z, makeState(GRASS));
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

function fillMap(map: WorldMap, world: World, x: number, z: number): void {
  for (let n = 0; n < 81; n++) map.explore(world, x, z);
}

describe('receitas', () => {
  const book = new RecipeBook();
  const grid = (rows: string[], legend: Record<string, string>): CraftGrid => {
    const slots: (ItemStack | null)[] = new Array(9).fill(null);
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '.') slots[y * 3 + x] = makeStack(itemId(legend[c]), 1);
    }));
    return { size: 3, slots };
  };

  it('bússola, relógio e mapa se fabricam como no original', () => {
    expect(book.match(grid(['.I.', 'IRI', '.I.'], { I: 'iron_ingot', R: 'redstone' }))?.item)
      .toBe(itemId('compass'));
    expect(book.match(grid(['.G.', 'GRG', '.G.'], { G: 'gold_ingot', R: 'redstone' }))?.item)
      .toBe(itemId('clock'));
    expect(book.match(grid(['PPP', 'PCP', 'PPP'], { P: 'paper', C: 'compass' }))?.item)
      .toBe(itemId('map'));
  });
});

describe('mostradores', () => {
  it('a bússola aponta para o alvo relativo ao olhar', () => {
    // Olhando para +Z (yaw 0) com o alvo em frente: agulha para cima.
    expect(compassFrame(0, 0, 0, 0, 50)).toBe(0);
    // Alvo atrás: agulha para baixo.
    expect(compassFrame(0, 0, 0, 0, -50)).toBe(DIAL_FRAMES / 2);
    // A direita de quem olha para +Z é −X: agulha a 90° no sentido horário.
    expect(compassFrame(0, 0, 0, -50, 0)).toBe(DIAL_FRAMES / 4);
    // Virar o corpo gira a agulha: olhando para −X, o mesmo alvo fica em frente.
    expect(compassFrame(0, 0, -Math.PI / 2, -50, 0)).toBe(0);
  });

  it('o relógio põe o sol no alto ao meio-dia e a lua à meia-noite', () => {
    expect(clockFrame(6000)).toBe(0);
    expect(clockFrame(18000)).toBe(DIAL_FRAMES / 2);
    expect(clockFrame(0)).toBe((DIAL_FRAMES * 3) / 4);
  });

  it('no Nether, o mostrador passa por todos os quadros', () => {
    const seen = new Set<number>();
    for (let tick = 0; tick < DIAL_FRAMES * 3; tick++) seen.add(spinFrame(tick, 0));
    expect(seen.size).toBe(DIAL_FRAMES);
  });

  it('a folha tem um quadro diferente para cada ângulo da bússola e do relógio', () => {
    const sheet = buildItemSheet({ texturePixels: () => null });
    for (const name of ['compass', 'clock']) {
      const tiles = sheet.dials.get(itemId(name));
      expect(tiles?.length, name).toBe(DIAL_FRAMES);
      expect(new Set(tiles).size).toBe(DIAL_FRAMES);
      const pixelsOf = (tile: number): string => {
        const x0 = (tile % sheet.columns) * 16;
        const y0 = Math.floor(tile / sheet.columns) * 16;
        let out = '';
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) out += sheet.pixels[((y0 + y) * sheet.width + x0 + x) * 4];
        }
        return out;
      };
      expect(pixelsOf(tiles![0])).not.toBe(pixelsOf(tiles![4]));
    }
    // O mapa é item comum, sem quadros.
    expect(sheet.dials.has(itemId('map'))).toBe(false);
    expect(sheet.index.has(itemId('map'))).toBe(true);
  });
});

describe('mapa explorado', () => {
  it('enche em volta do jogador, até o raio de exploração', () => {
    const world = meadow(6);
    const map = new WorldMap();
    fillMap(map, world, 8, 8);
    const near = map.pixel(8 + 40, 8);
    expect(near & PIXEL_KNOWN).not.toBe(0);
    expect(blockOfPixel(near)).toBe(GRASS);
    // Chunk a 6 de distância: fora do raio de 4.
    expect(map.pixel(8 + 6 * 16, 8)).toBe(0);
  });

  it('flor não é o chão; relevo e profundidade viram sombra', () => {
    const world = meadow(2);
    world.setBlock(3, GROUND_Y + 1, 3, POPPY, 'gen');
    world.setBlock(5, GROUND_Y + 1, 5, STONE, 'gen');
    for (let x = 10; x < 14; x++) {
      world.setBlock(x, GROUND_Y, 2, makeState(WATER), 'gen');
      for (let d = 0; d < 6; d++) world.setBlock(x, GROUND_Y - d, 10, makeState(WATER), 'gen');
    }
    world.getChunk(0, 0)!.recomputeHeightMap();
    const map = new WorldMap();
    map.sampleChunk(world, world.getChunk(0, 0)!);

    expect(blockOfPixel(map.pixel(3, 3))).toBe(GRASS);
    // O bloco mais alto que o vizinho do norte (−Z na linha anterior) é claro.
    expect(shadeOf(map.pixel(5, 5))).toBe(2);
    expect(shadeOf(map.pixel(5, 6))).toBe(0);
    expect(shadeOf(map.pixel(8, 8))).toBe(1);
    // Água rasa clara, funda escura.
    expect(blockOfPixel(map.pixel(11, 2))).toBe(WATER);
    expect(shadeOf(map.pixel(11, 2))).toBe(2);
    expect(shadeOf(map.pixel(11, 10))).toBe(0);
  });

  it('a região comprime por carreira e volta igual', () => {
    const world = meadow(2);
    const map = new WorldMap();
    fillMap(map, world, 8, 8);
    for (const region of map.regions.values()) {
      const bytes = encodeRegion(region);
      expect(bytes.byteLength).toBeLessThan(region.byteLength / 4);
      expect(decodeRegion(bytes)).toEqual(region);
    }
    expect(decodeRegion(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodeRegion(new Uint8Array([1, 0, 5, 0]))).toBeNull();
  });

  it('tem teto de regiões: a mais longe do jogador é esquecida', () => {
    const map = new WorldMap();
    const world = new World(1);
    for (let n = 0; n <= MAP_MAX_REGIONS + 5; n++) {
      const chunk = new ChunkColumn(n * (MAP_REGION / 16), 0);
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
      map.sampleChunk(world, chunk, n * MAP_REGION, 0);
    }
    expect(map.regions.size).toBe(MAP_MAX_REGIONS);
    // O jogador andou para +X: quem saiu foi o começo do caminho.
    expect(map.pixel(0, 0)).toBe(0);
    expect(map.forgotten.size).toBe(6);
  });

  it('no Nether o mapa não enche (não há céu)', () => {
    const world = meadow(2);
    const nether = DIMENSIONS.findIndex((d) => !d.hasSky);
    world.dimension = nether;
    const journal = new Journal();
    const player = new Player(8, GROUND_Y + 1, 8);
    for (let t = 0; t < 100; t++) journal.tick(world, player, false);
    expect(journal.map.regions.size).toBe(0);
  });
});

describe('vista do mapa', () => {
  const out = new Float64Array(2);

  it('norte (+Z) para cima e leste (−X) à direita', () => {
    worldToView(100, 110, 100, 100, 2, out);
    expect(out[1]).toBeLessThan(MAP_VIEW / 2);
    worldToView(90, 100, 100, 100, 2, out);
    expect(out[0]).toBeGreaterThan(MAP_VIEW / 2);
    expect(compassPoint(0, 0, 0, 10)).toBe('N');
    expect(compassPoint(0, 0, -10, 0)).toBe('L');
    expect(compassPoint(0, 0, 10, -10)).toBe('SO');
  });

  it('tela e mundo são inversos', () => {
    worldToView(37.25, -12.5, 30, -20, 4, out);
    viewToWorld(out[0], out[1], 30, -20, 4, out);
    expect(out[0]).toBeCloseTo(37.25, 6);
    expect(out[1]).toBeCloseTo(-12.5, 6);
  });

  it('a seta do jogador aponta para onde ele olha', () => {
    expect(headingOnView(0)).toBeCloseTo(0, 6); // norte: para cima
    expect(headingOnView(Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6); // +X é oeste: esquerda
  });

  it('o que ninguém explorou é escuro; o explorado tem a cor do bloco', () => {
    const world = meadow(1);
    const map = new WorldMap();
    fillMap(map, world, 8, 8);
    const palette = new Uint8Array(1024 * 3);
    palette[GRASS * 3 + 1] = 200;
    const image = new Uint8ClampedArray(MAP_VIEW * MAP_VIEW * 4);
    paintMapView(map, palette, image, 8, 8, 1);
    const at = (px: number, py: number): number => (py * MAP_VIEW + px) * 4;
    expect(image[at(MAP_VIEW / 2, MAP_VIEW / 2) + 1]).toBeGreaterThan(100);
    expect(image[at(2, 2) + 1]).toBeLessThan(60);
  });
});

describe('marcadores', () => {
  it('nome padrão, renomear, apagar e teto', () => {
    const markers = new Markers();
    const a = markers.add('', 1, 70, 2, 0)!;
    expect(a.name).toBe('Marcador 1');
    markers.rename(a.id, '   Casa    da   praia ');
    expect(a.name).toBe('Casa da praia');
    for (let n = 1; n < MAX_MARKERS; n++) markers.add('x', n, 70, n, 0);
    expect(markers.add('demais', 0, 0, 0, 0)).toBeNull();
    markers.remove(a.id);
    expect(markers.list.length).toBe(MAX_MARKERS - 1);
  });

  it('só há um marcador de morte, e ele não conta no teto', () => {
    const markers = new Markers();
    markers.setDeath(1, 64, 1, 0);
    markers.setDeath(50, 64, -5, 0);
    const deaths = markers.list.filter((m) => m.kind === 'death');
    expect(deaths.map((m) => [m.x, m.z])).toEqual([[50, -5]]);
    for (let n = 0; n < MAX_MARKERS; n++) expect(markers.add('', n, 0, n, 0)).not.toBeNull();
  });

  it('registro estranho no save é descartado, não quebra', () => {
    const markers = new Markers();
    markers.restore([{ name: 'ok', x: 1, z: 2 }, { x: 'a' } as never, { name: 3 } as never]);
    expect(markers.list.map((m) => m.name)).toEqual(['ok']);
  });
});

describe('estatísticas', () => {
  it('distância a pé, voando e de carrinho; teletransporte não conta', () => {
    const world = meadow(1);
    const journal = new Journal();
    const player = new Player(0, GROUND_Y + 1, 0);
    journal.tick(world, player, false);
    for (let t = 0; t < 40; t++) {
      player.x += 0.25;
      journal.tick(world, player, false);
    }
    expect(journal.stats.get('walk')).toBeCloseTo(10, 5);
    player.x += 300; // portal, renascer
    journal.tick(world, player, false);
    expect(journal.stats.get('walk')).toBeCloseTo(10, 5);
    player.flying = true;
    for (let t = 0; t < 10; t++) { player.z += 0.5; journal.tick(world, player, false); }
    expect(journal.stats.get('fly')).toBeCloseTo(5, 5);
    player.flying = false;
    for (let t = 0; t < 10; t++) { player.z += 0.4; journal.tick(world, player, true); }
    expect(journal.stats.get('ride')).toBeCloseTo(4, 5);
    expect(journal.stats.get('play_time')).toBe(62);
  });

  it('formata tempo, distância e contagem', () => {
    expect(formatStat('time', 20 * 60 * 75)).toBe('1 h 15 min');
    expect(formatStat('distance', 523.7)).toBe('523 m');
    expect(formatStat('distance', 12345)).toBe('12,3 km');
    expect(formatStat('count', 4)).toBe('4');
  });
});

describe('espectador', () => {
  it('atravessa a parede que prende o voo normal', () => {
    const world = meadow(1);
    for (let y = GROUND_Y + 1; y < GROUND_Y + 8; y++) {
      for (let z = -4; z < 12; z++) world.setBlock(6, y, z, STONE, 'gen');
    }
    const input = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false };
    const run = (spectator: boolean): number => {
      const player = new Player(2.5, GROUND_Y + 2, 4.5);
      player.mode = 'creative';
      player.flying = true;
      player.spectator = spectator;
      player.yaw = Math.PI / 2; // olhando para +X
      for (let t = 0; t < 60; t++) player.tick(world, input);
      return player.x;
    };
    expect(run(false)).toBeLessThan(6);
    expect(run(true)).toBeGreaterThan(8);
  });
});

describe('mapa voando', () => {
  /*
   * Campo, 2026-09-23: "Sai voando sem abrir o mapa, quando abri (…) onde eu
   * já passei estava tudo mal carregado" — um xadrez. O mapa lia um chunk por
   * vez em rodízio fixo; voando, o anel andava mais rápido que a volta.
   */
  it('voando a 20 blocos por segundo, o mapa não deixa buraco em volta do caminho', () => {
    const seed = 2;
    const noise = new TerrainNoise(seed);
    const world = new World(seed);
    const journal = new Journal();
    const player = new Player(8.5, 120, 8.5);
    player.flying = true;
    const loaded = new Set<string>();
    const load = (): void => {
      const cx0 = Math.floor(player.x) >> 4;
      const cz0 = Math.floor(player.z) >> 4;
      for (let dz = -5; dz <= 5; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          const key = `${cx0 + dx},${cz0 + dz}`;
          if (loaded.has(key)) continue;
          loaded.add(key);
          world.addChunk(generateChunk(seed, noise, cx0 + dx, cz0 + dz));
        }
      }
    };
    for (let t = 0; t < 400; t++) {
      if (t % 8 === 0) load();
      player.x += 1;
      journal.tick(world, player, false);
    }
    // Todo chunk a até dois de distância do caminho está no mapa.
    let holes = 0;
    for (let x = 16; x < player.x - 32; x += 16) {
      for (let dz = -2; dz <= 2; dz++) {
        if ((journal.map.pixel(x, 8 + dz * 16) & PIXEL_KNOWN) === 0) holes++;
      }
    }
    expect(holes).toBe(0);
  }, 60_000);
});

describe('critério de aceite do M10', () => {
  /*
   * Sai da base, anda 500 blocos pelo terreno de verdade (seed 2), e volta
   * lendo só o mapa e o marcador. O mapa tem que ter o caminho inteiro, o
   * marcador tem que apontar a volta, e o custo do mapa tem que caber em 1 ms
   * por segundo de jogo.
   */
  it('andar 500 blocos e voltar pelo mapa e pelo marcador', () => {
    const seed = 2;
    const noise = new TerrainNoise(seed);
    const world = new World(seed);
    const journal = new Journal();
    const player = new Player(8.5, 90, 8.5);
    const load = (): void => {
      const cx0 = Math.floor(player.x) >> 4;
      const cz0 = Math.floor(player.z) >> 4;
      for (let dz = -5; dz <= 5; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          if (world.getChunk(cx0 + dx, cz0 + dz) === undefined) {
            world.addChunk(generateChunk(seed, noise, cx0 + dx, cz0 + dz));
          }
        }
      }
    };

    load();
    const base = journal.markers.add('Base', player.x, player.y, player.z, 0)!;
    const direction = [Math.SQRT1_2, -Math.SQRT1_2]; // para o sudoeste, na diagonal
    let journalMs = 0;
    let ticks = 0;
    const step = (dx: number, dz: number): void => {
      player.x += dx;
      player.z += dz;
      if (ticks % 16 === 0) load();
      const t0 = performance.now();
      journal.tick(world, player, false);
      journalMs += performance.now() - t0;
      ticks++;
    };

    while (Math.hypot(player.x - base.x, player.z - base.z) < 500) {
      step(direction[0] * 0.28, direction[1] * 0.28);
    }
    for (let t = 0; t < 100; t++) step(0, 0);

    // O caminho inteiro está no mapa: da base até aqui, a cada 8 blocos.
    const walked = Math.hypot(player.x - base.x, player.z - base.z);
    for (let d = 0; d <= walked; d += 8) {
      const x = Math.floor(base.x + direction[0] * d);
      const z = Math.floor(base.z + direction[1] * d);
      expect(journal.map.pixel(x, z) & PIXEL_KNOWN, `caminho a ${d} m`).not.toBe(0);
    }

    // Volta: a cada passo, só o que o marcador diz (rumo e distância).
    let guard = 0;
    while (Math.hypot(player.x - base.x - 0.5, player.z - base.z - 0.5) > 1.5 && guard++ < 5000) {
      const dx = base.x + 0.5 - player.x;
      const dz = base.z + 0.5 - player.z;
      const length = Math.hypot(dx, dz);
      step((dx / length) * 0.28, (dz / length) * 0.28);
    }
    expect(guard).toBeLessThan(5000);
    expect(compassPoint(8.5 + 400 * direction[0], 8.5 + 400 * direction[1], base.x, base.z)).toBe('NE');

    // Custo: o mapa (e o resto do caderno) cabe em 1 ms por segundo de jogo.
    const seconds = ticks / 20;
    expect(journalMs / seconds, 'ms de caderno por segundo de jogo').toBeLessThan(1);

    // E o save do mapa tem tamanho finito: tudo comprimido, bem abaixo do teto.
    let bytes = 0;
    for (const region of journal.map.regions.values()) bytes += encodeRegion(region).byteLength;
    expect(journal.map.regions.size).toBeLessThanOrEqual(MAP_MAX_REGIONS);
    console.log(`  500 blocos e volta: ${(journalMs / seconds).toFixed(2)} ms/s de caderno, `
      + `${journal.map.regions.size} regiões, ${(bytes / 1024).toFixed(0)} KB de mapa`);
    expect(bytes).toBeLessThan(1024 * 1024);
  }, 120_000);
});
