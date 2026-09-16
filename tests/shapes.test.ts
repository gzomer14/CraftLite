/**
 * Geometria de caixa das formas não-cubo (doc 04 §3) e a colisão que sai dela.
 *
 * A regressão que importa: **desenho e colisão vêm da mesma tabela**. Se
 * alguém acrescentar uma forma só no mesher, a laje volta a colidir como bloco
 * inteiro e o jogador flutua meio bloco acima do degrau.
 */
import { describe, expect, it } from 'vitest';
import {
  BOX_STRIDE, FENCE_COLLISION_HEIGHT, MAX_BOXES, MOUNT_CEILING, MOUNT_FLOOR, SHAPE_BUTTON,
  SHAPE_BY_NAME, SHAPE_DOOR, SHAPE_FENCE, SHAPE_FENCE_GATE, SHAPE_FLAT, SHAPE_LEVER,
  SHAPE_PISTON, SHAPE_PISTON_HEAD, SHAPE_PLATE, SHAPE_REPEATER, SHAPE_SLAB, SHAPE_STAIRS,
  SHAPE_TRAPDOOR, SHAPE_BED, SHAPE_TORCH, TORCH_FLOOR_TOP, BED_HEIGHT,
  boxesFor, boundsFor, collisionBoxesFor, mountForDir,
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

  // --- redstone (M7) -----------------------------------------------------

  it('botão no chão é uma pastilha rasa, e mais rasa ainda apertado', () => {
    expect(boxesFor(SHAPE_BUTTON, MOUNT_FLOOR, 0, out)).toBe(1);
    expect(box(0)).toEqual([5 / 16, 0, 6 / 16, 11 / 16, 2 / 16, 10 / 16]);
    boxesFor(SHAPE_BUTTON, MOUNT_FLOOR | 8, 0, out);
    expect(box(0)[4]).toBe(1 / 16);
  });

  it('botão no teto cresce para baixo a partir de y=1', () => {
    boxesFor(SHAPE_BUTTON, MOUNT_CEILING, 0, out);
    expect(box(0)[1]).toBe(1 - 2 / 16);
    expect(box(0)[4]).toBe(1);
  });

  it('botão na parede encosta na face daquele lado', () => {
    // Encaixe 0 = apoio em +X: a pastilha fica colada na face +X.
    boxesFor(SHAPE_BUTTON, 0, 0, out);
    expect(box(0)[3]).toBe(1);
    // Encaixe 1 = apoio em −X.
    boxesFor(SHAPE_BUTTON, 1, 0, out);
    expect(box(0)[0]).toBe(0);
  });

  it('alavanca é base mais haste, e a haste muda de lado ao ligar', () => {
    expect(boxesFor(SHAPE_LEVER, MOUNT_FLOOR, 0, out)).toBe(2);
    const desligada = box(1)[2];
    boxesFor(SHAPE_LEVER, MOUNT_FLOOR | 8, 0, out);
    expect(box(1)[2]).not.toBe(desligada);
  });

  it('placa de pressão afunda ao ser pisada', () => {
    expect(boxesFor(SHAPE_PLATE, 0, 0, out)).toBe(1);
    const solta = box(0)[4];
    boxesFor(SHAPE_PLATE, 1, 0, out);
    expect(box(0)[4]).toBeLessThan(solta);
  });

  it('repetidor tem base e duas tochinhas, e o atraso afasta a de trás', () => {
    expect(boxesFor(SHAPE_REPEATER, 0, 0, out)).toBe(3);
    const perto = box(2)[0];
    boxesFor(SHAPE_REPEATER, 0 | (3 << 2), 0, out);
    expect(box(2)[0]).toBeLessThan(perto);
  });

  it('pistão recolhido tem corpo e placa; estendido, só o corpo', () => {
    expect(boxesFor(SHAPE_PISTON, 0, 0, out)).toBe(2);
    expect(boxesFor(SHAPE_PISTON, 0 | 8, 0, out)).toBe(1);
    // Aponta para +X: o corpo ocupa os 12/16 a partir da face −X.
    expect(box(0)[0]).toBe(0);
    expect(box(0)[3]).toBeCloseTo(12 / 16);
  });

  it('braço do pistão é haste mais placa na ponta', () => {
    expect(boxesFor(SHAPE_PISTON_HEAD, 0, 0, out)).toBe(2);
    // A placa fica no fim do curso, na direção em que o pistão empurra.
    expect(box(1)[3]).toBe(1);
    expect(box(1)[0]).toBeCloseTo(12 / 16);
  });

  it('a direção do pistão vira o encaixe certo nos seis eixos', () => {
    expect(mountForDir(0)).toBe(0);
    expect(mountForDir(3)).toBe(3);
    expect(mountForDir(4)).toBe(MOUNT_CEILING);
    expect(mountForDir(5)).toBe(MOUNT_FLOOR);
  });

  it('pó, alavanca, botão e placa não colidem com nada', () => {
    for (const name of ['redstone_wire', 'lever', 'stone_button', 'stone_pressure_plate']) {
      expect(BLOCK_BY_NAME.get(name)!.solid).toBe(false);
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

/*
 * Tocha e cama entraram no M8 com forma própria; a envolvente entrou junto,
 * porque é dela que sai o contorno do bloco mirado.
 */
describe('tocha e cama', () => {
  it('a tocha de chão é um poste fino e alto, não um cubo', () => {
    expect(boxesFor(SHAPE_TORCH, MOUNT_FLOOR, 0, out)).toBe(1);
    const [x0, y0, z0, x1, y1, z1] = box(0);
    expect(x1 - x0).toBeCloseTo(2 / 16, 6);
    expect(z1 - z0).toBeCloseTo(2 / 16, 6);
    expect(y0).toBe(0);
    expect(y1).toBeCloseTo(TORCH_FLOOR_TOP, 6);
  });

  it('a tocha de parede fica encostada na parede em que está presa', () => {
    // Encaixe 0 = apoio em +X: a caixa toca a face x = 1.
    boxesFor(SHAPE_TORCH, 0, 0, out);
    expect(box(0)[3]).toBeCloseTo(1, 6);
    // Encaixe 1 = apoio em −X: toca a face x = 0.
    boxesFor(SHAPE_TORCH, 1, 0, out);
    expect(box(0)[0]).toBeCloseTo(0, 6);
  });

  it('a cama é um colchão com dois pés na ponta de fora', () => {
    const count = boxesFor(SHAPE_BED, 2, 0, out);
    expect(count).toBe(3);
    // O colchão cobre a célula inteira em X e Z.
    expect(box(0)[0]).toBe(0);
    expect(box(0)[3]).toBe(1);
    expect(box(0)[4]).toBeCloseTo(BED_HEIGHT, 6);
    // Os pés ficam do lado oposto à outra metade (que está em +Z).
    for (let b = 1; b < count; b++) expect(box(b)[2]).toBeLessThan(0.5);
  });

  it('dá para andar por cima da cama: ela colide na altura do colchão', () => {
    expect(collisionBoxesFor(SHAPE_BED, 2, out)).toBe(3);
    expect(box(0)[4]).toBeCloseTo(BED_HEIGHT, 6);
  });
});

describe('envolvente da forma', () => {
  it('bloco sem forma de caixa envolve o cubo inteiro', () => {
    const bounds = new Float32Array(6);
    boundsFor(0, 0, bounds);
    expect([...bounds]).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('a laje envolve meia altura', () => {
    const bounds = new Float32Array(6);
    boundsFor(SHAPE_SLAB, 0, bounds);
    expect(bounds[4]).toBeCloseTo(0.5, 6);
  });

  it('a tocha envolve o poste, não o bloco', () => {
    const bounds = new Float32Array(6);
    boundsFor(SHAPE_TORCH, MOUNT_FLOOR, bounds);
    expect(bounds[3] - bounds[0]).toBeCloseTo(2 / 16, 6);
    expect(bounds[4]).toBeCloseTo(TORCH_FLOOR_TOP, 6);
  });

  /*
   * A cerca é o caso que não pode encolher: a envolvente dela é o bloco
   * inteiro, senão o contorno mudaria de tamanho conforme o vizinho.
   */
  it('a cerca envolve o bloco inteiro, com vizinho ou sem', () => {
    const bounds = new Float32Array(6);
    boundsFor(SHAPE_FENCE, 0, bounds);
    expect(bounds[0]).toBe(0);
    expect(bounds[3]).toBe(1);
  });
});
