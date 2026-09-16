/**
 * Blocos de duas células: porta e cama (M8).
 *
 * Até 2026-09-16 a porta tinha um bloco de altura e a cama era um cubo de lã —
 * o comentário de `game/sleep.ts` chamava isso de desvio consciente "até haver
 * máquina de colocação/quebra". Estes testes são essa máquina: o que importa é
 * que as duas metades **nascem juntas e morrem juntas**, inclusive quando quem
 * as derruba não é o jogador.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, blockIdOf, makeState, stateBitsOf } from '../src/data/blocks';
import {
  attachMultiBlocks, isBedAt, isMulti, isMultiRoot, partnerIdOf, partnerOffset, partnerState,
  placeMulti, rootPositionOf,
} from '../src/world/multiblock';

const DOOR = BLOCK_BY_NAME.get('oak_door')!.id;
const DOOR_TOP = BLOCK_BY_NAME.get('oak_door_top')!.id;
const BED = BLOCK_BY_NAME.get('bed')!.id;
const BED_HEAD = BLOCK_BY_NAME.get('bed_head')!.id;
const STONE = BLOCK_BY_NAME.get('stone')!.id;

/** Mundo de 3×3 chunks vazios, com chão de pedra em y = 63. */
function flatWorld(): World {
  const world = new World(1);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) chunk.setBlock(x, 63, z, makeState(STONE));
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

const free = (world: World) => (x: number, y: number, z: number) =>
  world.getBlock(x, y, z) === AIR;

describe('tabela de duas células', () => {
  it('porta e cama declaram as duas metades, e só uma delas é a raiz', () => {
    expect(isMulti(DOOR)).toBe(true);
    expect(isMulti(DOOR_TOP)).toBe(true);
    expect(isMultiRoot(DOOR)).toBe(true);
    expect(isMultiRoot(DOOR_TOP)).toBe(false);
    expect(partnerIdOf(DOOR)).toBe(DOOR_TOP);
    expect(partnerIdOf(DOOR_TOP)).toBe(DOOR);
    expect(isMultiRoot(BED)).toBe(true);
    expect(isMultiRoot(BED_HEAD)).toBe(false);
  });

  it('pedra continua sendo bloco de uma célula', () => {
    expect(isMulti(STONE)).toBe(false);
  });

  it('a metade de cima da porta fica acima, e a volta aponta para baixo', () => {
    const out = new Int8Array(3);
    partnerOffset(makeState(DOOR), out);
    expect([...out]).toEqual([0, 1, 0]);
    partnerOffset(makeState(DOOR_TOP), out);
    expect([...out]).toEqual([0, -1, 0]);
  });

  /*
   * A cama é o caso que não pode sair errado: as duas metades apontam **uma
   * para a outra**, senão os pés nascem os dois do mesmo lado.
   */
  it('as duas metades da cama apontam uma para a outra', () => {
    const out = new Int8Array(3);
    for (let facing = 0; facing < 4; facing++) {
      const foot = makeState(BED, facing);
      const head = partnerState(foot);
      expect(blockIdOf(head)).toBe(BED_HEAD);
      partnerOffset(foot, out);
      const dx = out[0]; const dz = out[2];
      partnerOffset(head, out);
      expect(out[0] + dx).toBe(0);
      expect(out[2] + dz).toBe(0);
      expect(Math.abs(dx) + Math.abs(dz)).toBe(1);
    }
  });
});

/*
 * As portas das outras madeiras entraram no M8 com ids no fim da tabela, para
 * não empurrar o id de nada. O que precisa valer para elas é o mesmo que vale
 * para a de carvalho — inclusive o par apontando um para o outro.
 */
describe('portas das outras madeiras', () => {
  for (const wood of ['birch', 'spruce']) {
    it(`${wood}: as duas folhas se acham`, () => {
      const base = BLOCK_BY_NAME.get(`${wood}_door`)!;
      const top = BLOCK_BY_NAME.get(`${wood}_door_top`)!;
      expect(isMultiRoot(base.id)).toBe(true);
      expect(isMultiRoot(top.id)).toBe(false);
      expect(partnerIdOf(base.id)).toBe(top.id);
      expect(partnerIdOf(top.id)).toBe(base.id);
      // A de cima não é item: quem dropa é a receita de `data/loot.ts`.
      expect(top.itemless).toBe(true);
    });

    it(`${wood}: colocar escreve as duas células e quebrar leva as duas`, () => {
      const world = flatWorld();
      attachMultiBlocks(world);
      const base = BLOCK_BY_NAME.get(`${wood}_door`)!.id;
      expect(placeMulti(world, 6, 64, 6, makeState(base, 2), free(world))).toBe(true);
      expect(blockIdOf(world.getBlock(6, 65, 6))).toBe(partnerIdOf(base));
      world.setBlock(6, 65, 6, AIR, 'player');
      expect(world.getBlock(6, 64, 6)).toBe(AIR);
    });
  }
});

describe('colocar', () => {
  it('a porta ocupa duas células de altura', () => {
    const world = flatWorld();
    expect(placeMulti(world, 2, 64, 2, makeState(DOOR, 3), free(world))).toBe(true);
    expect(blockIdOf(world.getBlock(2, 64, 2))).toBe(DOOR);
    expect(blockIdOf(world.getBlock(2, 65, 2))).toBe(DOOR_TOP);
    // Os bits de direção vão junto: as duas folhas encaram o mesmo lado.
    expect(stateBitsOf(world.getBlock(2, 65, 2))).toBe(3);
  });

  it('a cama ocupa duas células na direção em que foi colocada', () => {
    const world = flatWorld();
    // Direção 2 = +Z.
    expect(placeMulti(world, 4, 64, 4, makeState(BED, 2), free(world))).toBe(true);
    expect(blockIdOf(world.getBlock(4, 64, 4))).toBe(BED);
    expect(blockIdOf(world.getBlock(4, 64, 5))).toBe(BED_HEAD);
  });

  it('não coloca nada quando a segunda célula está ocupada', () => {
    const world = flatWorld();
    world.setBlock(2, 65, 2, makeState(STONE), 'player');
    expect(placeMulti(world, 2, 64, 2, makeState(DOOR), free(world))).toBe(false);
    // E o mundo não ficou com meia porta.
    expect(world.getBlock(2, 64, 2)).toBe(AIR);
  });
});

describe('quebrar', () => {
  it('derrubar a metade de baixo leva a de cima junto', () => {
    const world = flatWorld();
    attachMultiBlocks(world);
    placeMulti(world, 2, 64, 2, makeState(DOOR), free(world));

    world.setBlock(2, 64, 2, AIR, 'player');
    expect(world.getBlock(2, 65, 2)).toBe(AIR);
  });

  it('derrubar a metade de cima leva a de baixo junto', () => {
    const world = flatWorld();
    attachMultiBlocks(world);
    placeMulti(world, 2, 64, 2, makeState(DOOR), free(world));

    world.setBlock(2, 65, 2, AIR, 'player');
    expect(world.getBlock(2, 64, 2)).toBe(AIR);
  });

  /*
   * A regra vale para **qualquer** causa porque mora no `setBlock`: é o que
   * impede meia cama sobrar depois de um creeper.
   */
  it('a explosão também leva as duas metades da cama', () => {
    const world = flatWorld();
    attachMultiBlocks(world);
    placeMulti(world, 4, 64, 4, makeState(BED, 2), free(world));

    world.setBlock(4, 64, 5, AIR, 'physics');
    expect(world.getBlock(4, 64, 4)).toBe(AIR);
  });

  it('avisa quem cuida da luz sobre a metade que saiu junto', () => {
    const world = flatWorld();
    const seen: number[][] = [];
    attachMultiBlocks(world, {
      onChanged: (x, y, z) => { seen.push([x, y, z]); },
    });
    placeMulti(world, 2, 64, 2, makeState(DOOR), free(world));
    world.setBlock(2, 64, 2, AIR, 'player');
    expect(seen).toEqual([[2, 65, 2]]);
  });

  it('abrir a porta não desmancha o par', () => {
    const world = flatWorld();
    attachMultiBlocks(world);
    placeMulti(world, 2, 64, 2, makeState(DOOR), free(world));

    // Bit 2 = aberta: muda o estado, não o bloco.
    world.setBlock(2, 64, 2, makeState(DOOR, 4), 'player');
    expect(blockIdOf(world.getBlock(2, 65, 2))).toBe(DOOR_TOP);
  });

  /*
   * Duas camas encostadas de cabeceira com cabeceira têm ids que casam mas não
   * apontam uma para a outra. Sem conferir a volta, quebrar uma levaria a
   * vizinha junto.
   */
  it('cama vizinha que não é a outra metade fica de pé', () => {
    const world = flatWorld();
    attachMultiBlocks(world);
    // Pé em (4,64,4) com cabeceira em (4,64,5).
    placeMulti(world, 4, 64, 4, makeState(BED, 2), free(world));
    // Outro pé em (4,64,6) com cabeceira em (4,64,7) — costas com costas.
    placeMulti(world, 4, 64, 6, makeState(BED, 2), free(world));

    world.setBlock(4, 64, 6, AIR, 'player');
    expect(blockIdOf(world.getBlock(4, 64, 5))).toBe(BED_HEAD);
    expect(blockIdOf(world.getBlock(4, 64, 4))).toBe(BED);
  });
});

describe('achar a metade principal', () => {
  it('a cabeceira da cama devolve o pé', () => {
    const world = flatWorld();
    placeMulti(world, 4, 64, 4, makeState(BED, 2), free(world));
    const out = new Int32Array(3);
    expect(rootPositionOf(world, 4, 64, 5, out)).toBe(true);
    expect([...out]).toEqual([4, 64, 4]);
  });

  it('as duas metades da cama respondem como cama', () => {
    const world = flatWorld();
    placeMulti(world, 4, 64, 4, makeState(BED, 2), free(world));
    expect(isBedAt(world, 4, 64, 4)).toBe(true);
    expect(isBedAt(world, 4, 64, 5)).toBe(true);
    expect(isBedAt(world, 4, 64, 6)).toBe(false);
  });
});
