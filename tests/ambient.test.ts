/**
 * Fagulha de tocha (M8).
 *
 * O sorteio é barato de propósito — algumas sondas por tick, custo fixo —, e é
 * justamente por ser sorteio que ele precisa de teste: com um `random`
 * injetado dá para exigir que a fagulha saia **na ponta** da tocha, e não no
 * canto do bloco, que é onde ela apareceria se o encaixe fosse ignorado.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { SPARK_RADIUS, emitTorchSparks } from '../src/game/ambient';
import { MOUNT_FLOOR, TORCH_FLOOR_TOP, TORCH_WALL_Y1 } from '../src/world/mesh/shapes';

const TORCH = BLOCK_BY_NAME.get('torch')!.id;
const TORCH_OFF = BLOCK_BY_NAME.get('redstone_torch_off')!.id;
const STONE = BLOCK_BY_NAME.get('stone')!.id;

function worldWith(x: number, y: number, z: number, state: number): World {
  const world = new World(1);
  world.addChunk(new ChunkColumn(0, 0));
  world.setBlock(x, y, z, state, 'player');
  return world;
}

/**
 * `random` que devolve sempre a posição `(dx,dy,dz)` relativa ao jogador.
 * O sorteio consome três valores por sonda, na ordem x, y, z.
 */
function aimAt(dx: number, dy: number, dz: number): () => number {
  const span = SPARK_RADIUS * 2 + 1;
  const values = [dx, dy, dz].map((d) => (d + SPARK_RADIUS) / span);
  let i = 0;
  return () => values[i++ % 3];
}

describe('fagulha de tocha', () => {
  it('sai da ponta da tocha de chão, não do canto do bloco', () => {
    const world = worldWith(4, 64, 4, makeState(TORCH, MOUNT_FLOOR));
    const out: number[][] = [];
    const n = emitTorchSparks(world, 4.5, 64.5, 4.5, 1, (x, y, z) => { out.push([x, y, z]); },
      aimAt(0, 0, 0));
    expect(n).toBe(1);
    expect(out[0][0]).toBeCloseTo(4.5, 6);
    expect(out[0][1]).toBeCloseTo(64 + TORCH_FLOOR_TOP, 6);
    expect(out[0][2]).toBeCloseTo(4.5, 6);
  });

  /*
   * A tocha de parede é torta: a ponta dela não fica no centro do bloco. Se a
   * fagulha ignorar o encaixe, ela nasce visivelmente ao lado da chama.
   */
  it('segue a inclinação da tocha de parede', () => {
    // Encaixe 0 = apoio em +X: a ponta se afasta da parede, para −X.
    const world = worldWith(4, 64, 4, makeState(TORCH, 0));
    const out: number[][] = [];
    emitTorchSparks(world, 4.5, 64.5, 4.5, 1, (x, y, z) => { out.push([x, y, z]); },
      aimAt(0, 0, 0));
    expect(out[0][1]).toBeCloseTo(64 + TORCH_WALL_Y1, 6);
    expect(out[0][0]).toBeGreaterThan(4.5);
    expect(out[0][0]).toBeLessThan(4.9);
  });

  it('tocha apagada não solta fagulha', () => {
    const world = worldWith(4, 64, 4, makeState(TORCH_OFF, MOUNT_FLOOR));
    let n = 0;
    emitTorchSparks(world, 4.5, 64.5, 4.5, 1, () => { n++; }, aimAt(0, 0, 0));
    expect(n).toBe(0);
  });

  it('pedra não solta fagulha', () => {
    const world = worldWith(4, 64, 4, makeState(STONE));
    let n = 0;
    emitTorchSparks(world, 4.5, 64.5, 4.5, 1, () => { n++; }, aimAt(0, 0, 0));
    expect(n).toBe(0);
  });

  it('não sorteia nada quando o orçamento é zero', () => {
    const world = worldWith(4, 64, 4, makeState(TORCH, MOUNT_FLOOR));
    let n = 0;
    emitTorchSparks(world, 4.5, 64.5, 4.5, 0, () => { n++; }, aimAt(0, 0, 0));
    expect(n).toBe(0);
  });

  /*
   * O custo é fixo: dez sondas são dez consultas ao mundo, com uma tocha ou
   * com mil. É essa propriedade que dispensa manter lista de tochas.
   */
  it('o custo não depende de quantas tochas existem', () => {
    const world = new World(1);
    world.addChunk(new ChunkColumn(0, 0));
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) world.setBlock(x, 64, z, makeState(TORCH, MOUNT_FLOOR), 'player');
    }
    let reads = 0;
    const spy = { ...world, getBlock: (x: number, y: number, z: number) => {
      reads++;
      return world.getBlock(x, y, z);
    } } as unknown as World;
    emitTorchSparks(spy, 8.5, 64.5, 8.5, 10, () => { /* conta só as leituras */ });
    expect(reads).toBe(10);
  });
});
