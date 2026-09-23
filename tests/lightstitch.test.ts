/**
 * Luz que atravessa a borda do chunk (M12).
 *
 * O worker ilumina cada coluna sozinha, e a luz parava na borda: uma lava
 * encostada na fronteira acendia um lado e deixava o outro no escuro, com uma
 * aresta reta de sombra exatamente na divisa. `Lighting.stitchColumn` compara
 * os pares de voxels que se tocam através da borda e propaga a diferença.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { ChunkColumn, ChunkState, chunkKey } from '../src/world/chunk';
import { computeChunkLight } from '../src/world/gen/terrain';
import { Lighting } from '../src/world/lighting';
import { BLOCK_BY_NAME } from '../src/data/blocks';
import { AIR, STONE } from './helpers/blockids';

const LAVA = BLOCK_BY_NAME.get('lava')!.id;
const Y = 40;

/** Coluna de pedra até Y=80, com um túnel em X na altura `Y`, linha z=8. */
function rockColumn(cx: number, cz: number): ChunkColumn {
  const chunk = new ChunkColumn(cx, cz);
  for (let y = 0; y <= 80; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, STONE);
    }
  }
  for (let x = 0; x < 16; x++) chunk.setBlock(x, Y, 8, AIR);
  return chunk;
}

/** Como o pipeline faz: luz calculada coluna a coluna, sem olhar o vizinho. */
function arrive(world: World, chunk: ChunkColumn): void {
  computeChunkLight(chunk);
  chunk.state = ChunkState.Generated;
  world.addChunk(chunk);
}

describe('costura de luz entre colunas', () => {
  it('a lava encostada na borda acende o túnel do outro lado', () => {
    const world = new World(1);
    const a = rockColumn(0, 0);
    a.setBlock(15, Y, 8, LAVA);
    arrive(world, a);
    const b = rockColumn(1, 0);
    arrive(world, b);

    // Sem a costura: a borda é uma parede de escuro.
    expect(world.getBlockLight(15, Y, 8)).toBe(15);
    expect(world.getBlockLight(16, Y, 8)).toBe(0);

    new Lighting(world).stitchColumn(1, 0);

    // Decai um nível por bloco, sem degrau na divisa.
    for (let x = 16; x < 30; x++) {
      expect(world.getBlockLight(x, Y, 8), `x=${x}`).toBe(15 - (x - 15));
    }
  });

  it('funciona nos dois sentidos: a coluna nova recebe luz da vizinha', () => {
    const world = new World(1);
    const b = rockColumn(1, 0);
    b.setBlock(0, Y, 8, LAVA); // lava na borda −X da coluna de lá
    arrive(world, b);
    const a = rockColumn(0, 0);
    arrive(world, a);

    new Lighting(world).stitchColumn(0, 0); // a coluna que chegou por último é a 0
    expect(world.getBlockLight(15, Y, 8)).toBe(14);
    expect(world.getBlockLight(10, Y, 8)).toBe(9);
  });

  it('a luz do céu entra de lado pela boca de caverna na divisa', () => {
    const world = new World(1);
    const a = rockColumn(0, 0);
    // Poço aberto até o céu encostado na borda +Z da coluna 0.
    for (let y = Y; y <= 80; y++) a.setBlock(8, y, 15, AIR);
    arrive(world, a);
    const b = rockColumn(0, 1);
    for (let z = 0; z < 6; z++) b.setBlock(8, Y, z, AIR); // túnel em Z do outro lado
    arrive(world, b);

    expect(world.getSkyLight(8, Y, 15)).toBe(15);
    expect(world.getSkyLight(8, Y, 16)).toBe(0);
    new Lighting(world).stitchColumn(0, 1);
    expect(world.getSkyLight(8, Y, 16)).toBe(14);
    expect(world.getSkyLight(8, Y, 20)).toBe(10);
  });

  it('só manda re-meshar quem já tinha malha', () => {
    const world = new World(1);
    const a = rockColumn(0, 0);
    arrive(world, a);
    a.state = ChunkState.Ready; // já meshada: a luz nova precisa aparecer nela
    const b = rockColumn(1, 0);
    b.setBlock(0, Y, 8, LAVA);
    arrive(world, b); // recém-chegada: vai ser meshada depois, já com a luz
    world.takeDirtySections([]);

    new Lighting(world).stitchColumn(1, 0);
    expect(world.getBlockLight(15, Y, 8)).toBe(14);

    const dirty: number[] = [];
    const n = world.takeDirtySections(dirty);
    const sections = dirty.slice(0, n).map((key) => {
      const sy = key % 8;
      return `${(key - sy) / 8 === chunkKey(0, 0) ? 'a' : 'b'}:${sy}`;
    });
    expect(sections).toEqual([`a:${Y >> 4}`]);
  });

  it('campo aberto dos dois lados: nenhuma semente, nenhuma section suja', () => {
    const world = new World(1);
    arrive(world, new ChunkColumn(0, 0));
    arrive(world, new ChunkColumn(1, 0));
    world.getChunk(0, 0)!.state = ChunkState.Ready;
    const lighting = new Lighting(world);
    lighting.stitchColumn(1, 0);
    expect(lighting.lastTouched).toBe(0);
    expect(world.dirtyCount).toBe(0);
  });

  /*
   * Travamento achado pelo smoke test no M12: a aba congelava ao criar o mundo.
   * Coluna não carregada responde "luz 0" e ignora a escrita, então o BFS via
   * todo voxel lá fora como mais escuro e o empurrava de novo para a fila, cada
   * um com seus 6 vizinhos — até 6^14 caminhos. O defeito era do BFS de sempre
   * (uma tocha rente à borda do mundo carregado também explodiria); a costura,
   * que roda justamente na fronteira, passou a acioná-lo em toda coluna nova.
   *
   * ATENÇÃO: se regredir, este teste **trava** em vez de falhar.
   */
  it('luz rente à borda do mundo carregado não escapa para fora dele', () => {
    const world = new World(1);
    const a = rockColumn(0, 0);
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) a.setBlock(x, Y, z, AIR); // um salão aberto
    }
    arrive(world, a);
    // (16, Y, 8) está na coluna 1, que não existe.
    world.setBlock(15, Y, 8, LAVA, 'player');
    const lighting = new Lighting(world);
    lighting.onBlockChanged(15, Y, 8, AIR, LAVA);
    expect(world.getBlockLight(15, Y, 8)).toBe(15);
    expect(world.getBlockLight(0, Y, 8)).toBe(0); // 15 − 15
    // Só o salão dentro da coluna carregada foi tocado.
    expect(lighting.lastTouched).toBeLessThan(16 * 16 * 3);

    // E a costura, com a vizinha de −X chegando depois, também termina.
    const b = rockColumn(-1, 0);
    arrive(world, b);
    lighting.stitchColumn(-1, 0);
    expect(world.getBlockLight(-1, Y, 8)).toBe(0);
  });
});
