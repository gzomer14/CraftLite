/**
 * Geometria de caixa das formas não-cubo (doc 04 §3) e a colisão que sai dela.
 *
 * A regressão que importa: **desenho e colisão vêm da mesma tabela**. Se
 * alguém acrescentar uma forma só no mesher, a laje volta a colidir como bloco
 * inteiro e o jogador flutua meio bloco acima do degrau.
 */
import { describe, expect, it } from 'vitest';
import {
  BOX_STRIDE, FENCE_COLLISION_HEIGHT, MAX_BOXES, SHAPE_BY_NAME, SHAPE_DOOR, SHAPE_FENCE,
  SHAPE_FENCE_GATE, SHAPE_FLAT, SHAPE_SLAB, SHAPE_STAIRS, SHAPE_TRAPDOOR, boxesFor,
  collisionBoxesFor,
} from '../src/world/mesh/shapes';
import { BLOCKS, BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { createAabb, moveWithCollision, setAabbFromBase } from '../src/world/physics';
import { facingFromYaw, toggleOpenState } from '../src/game/interaction';

const out = new Float32Array(MAX_BOXES * BOX_STRIDE);

/** Caixa `i` como tupla, para asserções legíveis. */
function box(i: number): number[] {
  return Array.from(out.subarray(i * BOX_STRIDE, (i + 1) * BOX_STRIDE));
}

describe('caixas por forma', () => {
  it('laje ocupa a metade de baixo, e a de cima com o bit ligado', () => {
    expect(boxesFor(SHAPE_SLAB, 0, 0, out)).toBe(1);
    expect(box(0)).toEqual([0, 0, 0, 1, 0.5, 1]);
    boxesFor(SHAPE_SLAB, 1, 0, out);
    expect(box(0)).toEqual([0, 0.5, 0, 1, 1, 1]);
  });

  it('escada é base de meia altura mais o degrau, virado para o facing', () => {
    expect(boxesFor(SHAPE_STAIRS, 0, 0, out)).toBe(2);
    expect(box(0)).toEqual([0, 0, 0, 1, 0.5, 1]);
    // facing 0 = +X: o degrau fica na metade −X.
    expect(box(1)).toEqual([0, 0.5, 0, 0.5, 1, 1]);
    // De cabeça para baixo, a base sobe e o degrau desce.
    boxesFor(SHAPE_STAIRS, 4, 0, out);
    expect(box(0)).toEqual([0, 0.5, 0, 1, 1, 1]);
    expect(box(1)[1]).toBe(0);
  });

  it('trilho é uma chapa de um pixel no chão', () => {
    expect(boxesFor(SHAPE_FLAT, 0, 0, out)).toBe(1);
    expect(box(0)[4]).toBeCloseTo(1 / 16, 6);
  });

  it('cerca ganha um braço por vizinho conectado', () => {
    expect(boxesFor(SHAPE_FENCE, 0, 0, out)).toBe(1);
    expect(boxesFor(SHAPE_FENCE, 0, 0b0101, out)).toBe(3);
    expect(boxesFor(SHAPE_FENCE, 0, 0b1111, out)).toBe(5);
  });

  it('portão perde a travessa quando abre', () => {
    const closed = boxesFor(SHAPE_FENCE_GATE, 0, 0, out);
    const open = boxesFor(SHAPE_FENCE_GATE, 4, 0, out);
    expect(closed).toBe(3);
    expect(open).toBe(2);
  });

  it('alçapão fechado deita no chão e aberto fica em pé na parede', () => {
    boxesFor(SHAPE_TRAPDOOR, 0, 0, out);
    expect(box(0)[4]).toBeCloseTo(3 / 16, 6);
    boxesFor(SHAPE_TRAPDOOR, 8, 0, out);
    // Em pé: um bloco inteiro de altura, fino num eixo horizontal.
    expect(box(0)[4]).toBe(1);
  });

  it('porta muda de parede ao abrir', () => {
    boxesFor(SHAPE_DOOR, 0, 0, out);
    const closed = box(0);
    boxesFor(SHAPE_DOOR, 4, 0, out);
    expect(box(0)).not.toEqual(closed);
  });

  it('toda forma cabe no orçamento de caixas', () => {
    for (const shape of Object.values(SHAPE_BY_NAME)) {
      for (let state = 0; state < 16; state++) {
        expect(boxesFor(shape, state, 0b1111, out)).toBeLessThanOrEqual(MAX_BOXES);
      }
    }
  });

  it('toda forma da tabela de blocos está mapeada', () => {
    for (const def of BLOCKS) {
      if (def === undefined) continue;
      if (def.shape === 'cube' || def.shape === 'liquid' || def.shape === 'none') continue;
      expect(SHAPE_BY_NAME[def.shape]).toBeDefined();
    }
  });
});

describe('colisão', () => {
  it('cerca colide como bloco de 1,5 de altura (doc 04 §3)', () => {
    expect(collisionBoxesFor(SHAPE_FENCE, 0, out)).toBe(1);
    expect(box(0)[4]).toBe(FENCE_COLLISION_HEIGHT);
  });

  it('portão aberto não colide com nada', () => {
    expect(collisionBoxesFor(SHAPE_FENCE_GATE, 4, out)).toBe(0);
  });

  it('a laje para o jogador em meia altura, não em altura cheia', () => {
    const world = flatWorld('cobblestone_slab');
    const aabb = createAabb();
    setAabbFromBase(aabb, 8.5, 66, 8.5, 0.6, 1.8);
    // Cai de 2 blocos acima: tem que pousar em 64.5, o topo da laje.
    for (let i = 0; i < 40; i++) moveWithCollision(world, aabb, 0, -0.2, 0, 0);
    expect(aabb[1]).toBeCloseTo(64.5, 2);
  });

  it('o bloco cheio ao lado ainda para em altura cheia', () => {
    const world = flatWorld('stone');
    const aabb = createAabb();
    setAabbFromBase(aabb, 8.5, 66, 8.5, 0.6, 1.8);
    for (let i = 0; i < 40; i++) moveWithCollision(world, aabb, 0, -0.2, 0, 0);
    expect(aabb[1]).toBeCloseTo(65, 2);
  });

  it('a cerca barra quem tenta andar por cima dela', () => {
    const world = flatWorld('stone');
    world.setBlock(9, 65, 8, makeState(BLOCK_BY_NAME.get('oak_fence')!.id), 'player');
    const aabb = createAabb();
    // Jogador no bloco de cima da cerca, tentando atravessar em X.
    setAabbFromBase(aabb, 8.5, 66, 8.5, 0.6, 1.8);
    const before = aabb[0];
    for (let i = 0; i < 10; i++) moveWithCollision(world, aabb, 0.2, 0, 0, 0);
    // A colisão de 1,5 alcança Y=66, então ele não passa para o outro lado.
    expect(aabb[0] - before).toBeLessThan(0.6);
  });
});

describe('orientação ao colocar', () => {
  it('o bloco fica de frente para quem olha', () => {
    // yaw 0 olha para +Z; π/2 para −X (doc 06 §2).
    expect(facingFromYaw(0)).toBe(2);
    expect(facingFromYaw(Math.PI)).toBe(3);
    expect(facingFromYaw(Math.PI / 2)).toBe(1);
    expect(facingFromYaw(-Math.PI / 2)).toBe(0);
  });

  it('porta, portão e alçapão alternam; o resto não', () => {
    const door = makeState(BLOCK_BY_NAME.get('oak_door')!.id, 1);
    const opened = toggleOpenState(door);
    expect(opened).toBeGreaterThan(0);
    expect(toggleOpenState(opened)).toBe(door);

    const gate = makeState(BLOCK_BY_NAME.get('oak_fence_gate')!.id, 2);
    expect(toggleOpenState(gate)).not.toBe(gate);

    const trap = makeState(BLOCK_BY_NAME.get('oak_trapdoor')!.id, 0);
    expect(toggleOpenState(trap)).not.toBe(trap);

    expect(toggleOpenState(makeState(BLOCK_BY_NAME.get('stone')!.id))).toBe(-1);
  });
});

/** Plataforma sólida até Y=63 com uma camada do bloco pedido em Y=64. */
function flatWorld(topName: string): World {
  const world = new World(5150);
  const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
  const top = makeState(BLOCK_BY_NAME.get(topName)!.id);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 63; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) chunk.setBlock(x, 64, z, top);
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}
