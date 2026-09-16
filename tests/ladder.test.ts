/**
 * Escada de mão (M8): a forma e a escalada.
 *
 * A escada existia desde o M6 como **decoração** — uma chapa de 3/16 com a
 * textura vazada, que o jogador atravessava como se fosse ar. Não havia desvio
 * consciente registrado em lugar nenhum: era um buraco. Estes testes cobrem as
 * duas metades da correção, a que se vê e a que se sente.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import {
  BOX_STRIDE, MAX_BOXES, SHAPE_LADDER, boundsFor, boxesFor,
} from '../src/world/mesh/shapes';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const LADDER = BLOCK_BY_NAME.get('ladder')!.id;

const IDLE = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
const boxes = new Float32Array(MAX_BOXES * BOX_STRIDE);
const box = (i: number): number[] =>
  Array.from(boxes.subarray(i * BOX_STRIDE, (i + 1) * BOX_STRIDE));

describe('forma', () => {
  it('são dois montantes e três degraus, não uma chapa', () => {
    expect(boxesFor(SHAPE_LADDER, 0, 0, boxes)).toBe(5);
  });

  it('tudo encosta na parede em que ela está pendurada', () => {
    // Encaixe 3 = parede em −Z: as caixas ficam coladas em z = 0.
    const count = boxesFor(SHAPE_LADDER, 3, 0, boxes);
    for (let b = 0; b < count; b++) expect(box(b)[2]).toBeLessThan(3 / 16);
  });

  /*
   * O degrau recuado é o que faz o olho ler "degrau" em vez de "listra": ele
   * fica mais perto da parede que o montante, e a sombra entre os dois aparece.
   */
  it('o degrau fica recuado em relação ao montante', () => {
    boxesFor(SHAPE_LADDER, 3, 0, boxes);
    const montante = box(0);
    const degrau = box(2);
    expect(degrau[5]).toBeLessThan(montante[5]);
  });

  it('os montantes ficam nas duas bordas e os degraus entre eles', () => {
    boxesFor(SHAPE_LADDER, 3, 0, boxes);
    expect(box(0)[0]).toBeCloseTo(1 / 16, 6);
    expect(box(1)[3]).toBeCloseTo(15 / 16, 6);
    for (let b = 2; b < 5; b++) {
      expect(box(b)[0]).toBeGreaterThanOrEqual(3 / 16);
      expect(box(b)[3]).toBeLessThanOrEqual(13 / 16);
    }
  });

  it('a envolvente cobre a escada inteira, para o contorno não encolher', () => {
    const bounds = new Float32Array(6);
    boundsFor(SHAPE_LADDER, 3, bounds);
    expect(bounds[1]).toBe(0);
    expect(bounds[4]).toBe(1);
    expect(bounds[3] - bounds[0]).toBeCloseTo(14 / 16, 6);
  });
});

/**
 * Poço de 1×1 escavado na pedra, com escada em toda a altura — que é o lugar
 * onde uma escada é usada de verdade.
 *
 * As paredes não são enfeite do teste: sem elas o jogador simplesmente **anda
 * para fora** da escada no primeiro tick de "para a frente", e o que se estaria
 * medindo é a caminhada, não a escalada.
 */
function ladderShaft(): World {
  const world = new World(11);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 80; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  // Escava o poço e pendura a escada na parede −Z.
  for (let y = 64; y <= 74; y++) world.setBlock(8, y, 8, makeState(LADDER, 3), 'player');
  return world;
}

/** O mesmo poço, mas sem escada: a coluna é só ar. */
function emptyShaft(): World {
  const world = ladderShaft();
  for (let y = 64; y <= 74; y++) world.setBlock(8, y, 8, 0, 'player');
  return world;
}

function climber(world: World): Player {
  const player = new Player(8.5, 64, 8.5);
  // Um tick parado para o estado de escada se estabelecer.
  player.tick(world, IDLE);
  return player;
}

describe('escalar', () => {
  it('o jogador reconhece que está numa escada', () => {
    const player = climber(ladderShaft());
    expect(player.onLadder).toBe(true);
  });

  it('empurrar para a frente sobe', () => {
    const world = ladderShaft();
    const player = climber(world);
    const y0 = player.y;
    for (let i = 0; i < 20; i++) player.tick(world, { ...IDLE, forward: 1 });
    expect(player.y).toBeGreaterThan(y0 + 2);
  });

  it('pular também sobe, e não salta', () => {
    const world = ladderShaft();
    const player = climber(world);
    for (let i = 0; i < 10; i++) player.tick(world, { ...IDLE, jump: true });
    // Subida de escada, não parábola de pulo: o ganho é linear e comportado.
    expect(player.y).toBeGreaterThan(64.5);
    expect(player.vy).toBeLessThanOrEqual(0.2 + 1e-6);
  });

  it('agachado, fica parado no lugar', () => {
    const world = ladderShaft();
    const player = climber(world);
    for (let i = 0; i < 10; i++) player.tick(world, { ...IDLE, forward: 1, sneak: true });
    expect(player.y).toBeCloseTo(64, 1);
  });

  /*
   * Descer tem que ser **controlado**: sem o limite, soltar o comando na
   * escada é uma queda livre com dano no fim.
   */
  it('descer é controlado, não queda livre', () => {
    const world = ladderShaft();
    const player = climber(world);
    player.setPosition(8.5, 72, 8.5);
    for (let i = 0; i < 20; i++) player.tick(world, IDLE);
    expect(player.vy).toBeGreaterThanOrEqual(-0.15 - 1e-6);
    expect(player.y).toBeGreaterThan(68);
  });

  it('no mesmo poço sem escada, é queda livre', () => {
    const world = emptyShaft();
    const player = new Player(8.5, 74, 8.5);
    for (let i = 0; i < 5; i++) player.tick(world, { ...IDLE, forward: 1 });
    expect(player.onLadder).toBe(false);
    expect(player.vy).toBeLessThan(-0.15);
    expect(player.y).toBeLessThan(74);
  });
});
