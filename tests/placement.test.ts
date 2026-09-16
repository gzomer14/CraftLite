/**
 * Colocação dos blocos com forma própria (M8).
 *
 * `tests/multiblock.test.ts` cobre o par de metades; aqui o caminho é o **de
 * verdade**, o mesmo que o clique do jogador percorre: `Interaction.tryPlace`,
 * com o acerto do raio, o encaixe derivado da face e o apoio conferido.
 *
 * É o teste que faltava para responder "por que a tocha não foi colocada?" sem
 * abrir o jogo — e a resposta certa, para o teto, é "porque tocha de cabeça
 * para baixo não existe".
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Interaction } from '../src/game/interaction';
import { BLOCK_BY_NAME, blockIdOf, makeState, stateBitsOf, AIR } from '../src/data/blocks';
import { ITEM_BY_NAME } from '../src/data/items';
import { MOUNT_FLOOR } from '../src/world/mesh/shapes';
import { attachMultiBlocks } from '../src/world/multiblock';
import { Session } from '../src/game/session';
import { itemId, makeStack } from '../src/data/items';
import type { RayHit } from '../src/world/raycast';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const TORCH = BLOCK_BY_NAME.get('torch')!.id;
const DOOR = BLOCK_BY_NAME.get('oak_door')!.id;
const DOOR_TOP = BLOCK_BY_NAME.get('oak_door_top')!.id;
const BED = BLOCK_BY_NAME.get('bed')!.id;
const BED_HEAD = BLOCK_BY_NAME.get('bed_head')!.id;

const lighting = { onBlockChanged: () => { /* a luz não é o assunto aqui */ } };

/** Chão de pedra em y = 63, num mundo de 3×3 chunks. */
function flatWorld(): World {
  const world = new World(7);
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

/** Acerto de raio numa face de `(x,y,z)`, com a normal apontando para fora. */
function hitOn(x: number, y: number, z: number, nx: number, ny: number, nz: number): RayHit {
  return {
    hit: true, x, y, z, nx, ny, nz,
    px: x + 0.5, py: y + 0.5, pz: z + 0.5, state: makeState(STONE), distance: 3,
  } as RayHit;
}

function setup(): { world: World; player: Player; interaction: Interaction } {
  const world = flatWorld();
  // Longe do lugar onde os testes colocam, senão o próprio corpo atrapalha.
  const player = new Player(0.5, 64, 0.5);
  player.mode = 'creative';
  return { world, player, interaction: new Interaction(world, player, lighting) };
}

const stack = (name: string) => ({ item: ITEM_BY_NAME.get(name)!.id, count: 1, damage: 0 });

describe('tocha', () => {
  it('no topo de um bloco fica em pé, com encaixe de chão', () => {
    const { world, interaction } = setup();
    interaction.state.target = hitOn(6, 63, 6, 0, 1, 0);
    expect(interaction.tryPlace(stack('torch'))).toBe(true);
    const state = world.getBlock(6, 64, 6);
    expect(blockIdOf(state)).toBe(TORCH);
    expect(stateBitsOf(state) & 7).toBe(MOUNT_FLOOR);
  });

  /*
   * A face clicada decide a parede: o apoio fica sempre do lado oposto à
   * normal do acerto. Errar isso deixa a tocha inclinada para dentro do muro.
   */
  it('na lateral de um bloco aponta para a parede que a segura', () => {
    const casos: [number, number, number, number][] = [
      [1, 0, 0, 1], [-1, 0, 0, 0], [0, 0, 1, 3], [0, 0, -1, 2],
    ];
    for (const [nx, , nz, esperado] of casos) {
      const { world, interaction } = setup();
      world.setBlock(6, 64, 6, makeState(STONE), 'player');
      interaction.state.target = hitOn(6, 64, 6, nx, 0, nz);
      expect(interaction.tryPlace(stack('torch'))).toBe(true);
      const state = world.getBlock(6 + nx, 64, 6 + nz);
      expect(blockIdOf(state)).toBe(TORCH);
      expect(stateBitsOf(state) & 7).toBe(esperado);
    }
  });

  it('no teto não é colocada — tocha de cabeça para baixo não existe', () => {
    const { world, interaction } = setup();
    world.setBlock(6, 66, 6, makeState(STONE), 'player');
    interaction.state.target = hitOn(6, 66, 6, 0, -1, 0);
    expect(interaction.tryPlace(stack('torch'))).toBe(false);
    expect(world.getBlock(6, 65, 6)).toBe(AIR);
  });

  it('sem apoio não é colocada', () => {
    const { world, interaction } = setup();
    // Bloco solto no ar, clicado por baixo — já recusado acima — e pela lateral
    // de um bloco que **não** existe: o alvo é ar, então não há o que apoiar.
    interaction.state.target = hitOn(6, 70, 6, 0, 1, 0);
    expect(interaction.tryPlace(stack('torch'))).toBe(false);
    expect(world.getBlock(6, 71, 6)).toBe(AIR);
  });
});

describe('porta', () => {
  it('um clique escreve as duas metades', () => {
    const { world, interaction } = setup();
    interaction.state.target = hitOn(6, 63, 6, 0, 1, 0);
    expect(interaction.tryPlace(stack('oak_door'))).toBe(true);
    expect(blockIdOf(world.getBlock(6, 64, 6))).toBe(DOOR);
    expect(blockIdOf(world.getBlock(6, 65, 6))).toBe(DOOR_TOP);
  });

  it('com o teto baixo não coloca nem a metade de baixo', () => {
    const { world, interaction } = setup();
    world.setBlock(6, 65, 6, makeState(STONE), 'player');
    interaction.state.target = hitOn(6, 63, 6, 0, 1, 0);
    expect(interaction.tryPlace(stack('oak_door'))).toBe(false);
    expect(world.getBlock(6, 64, 6)).toBe(AIR);
  });

  it('quebrar uma folha leva a outra', () => {
    const { world, interaction } = setup();
    attachMultiBlocks(world);
    interaction.state.target = hitOn(6, 63, 6, 0, 1, 0);
    interaction.tryPlace(stack('oak_door'));
    world.setBlock(6, 65, 6, AIR, 'player');
    expect(world.getBlock(6, 64, 6)).toBe(AIR);
  });
});

describe('cama', () => {
  it('a cabeceira vai para longe de quem coloca', () => {
    const { world, player, interaction } = setup();
    // Olhando para +Z: a cabeceira fica em +Z.
    player.yaw = 0;
    interaction.state.target = hitOn(6, 63, 6, 0, 1, 0);
    expect(interaction.tryPlace(stack('bed'))).toBe(true);
    expect(blockIdOf(world.getBlock(6, 64, 6))).toBe(BED);
    expect(blockIdOf(world.getBlock(6, 64, 7))).toBe(BED_HEAD);
  });

  it('sem espaço para a cabeceira não coloca nada', () => {
    const { world, player, interaction } = setup();
    player.yaw = 0;
    world.setBlock(6, 64, 7, makeState(STONE), 'player');
    interaction.state.target = hitOn(6, 63, 6, 0, 1, 0);
    expect(interaction.tryPlace(stack('bed'))).toBe(false);
    expect(world.getBlock(6, 64, 6)).toBe(AIR);
  });
});

/*
 * O caminho inteiro, com a sessão montada: clicar coloca, e o que foi colocado
 * **continua lá** depois de o mundo tickar.
 *
 * A segunda metade é o que importa aqui: a tocha ganhou `support: 'mount'` no
 * M8, e a fila de `world/redstone.ts` passou a visitar quem depende de apoio.
 * Um erro de sinal na direção do encaixe faria a tocha nascer e sumir no tick
 * seguinte — o tipo de bug que só aparece com o jogo montado.
 */
describe('o jogo inteiro, da mão ao mundo', () => {
  function sessionWorld(): { world: World; session: Session; player: Player } {
    const world = flatWorld();
    // O chão de `flatWorld` é pedra; a luz precisa existir para a sessão tickar.
    world.forEachChunk((chunk) => {
      chunk.recomputeHeightMap();
      for (const section of chunk.sections) {
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
      }
    });
    const player = new Player(8.5, 64, 8.5);
    player.mode = 'creative';
    const session = new Session(world, player, {
      onOpenScreen: () => { /* sem tela */ },
      onDeath: () => { /* não morre */ },
      onPickup: () => { /* nada */ },
    });
    return { world, session, player };
  }

  it('a tocha colocada pelo clique sobrevive aos ticks do mundo', () => {
    const { world, session, player } = sessionWorld();
    session.inventory.set(0, makeStack(itemId('torch'), 64));
    session.inventory.selected = 0;
    player.yaw = 0;
    player.pitch = 0.9; // olhando para o chão à frente
    session.interaction.updateTarget();
    expect(session.useHeld()).toBe(true);

    const target = session.interaction.state.target!;
    const x = target.x + target.nx;
    const y = target.y + target.ny;
    const z = target.z + target.nz;
    expect(blockIdOf(world.getBlock(x, y, z))).toBe(TORCH);

    for (let i = 0; i < 20; i++) session.tick();
    expect(blockIdOf(world.getBlock(x, y, z))).toBe(TORCH);
  });

  it('a tocha cai quando o apoio dela é minerado', () => {
    const { world, session, player } = sessionWorld();
    session.inventory.set(0, makeStack(itemId('torch'), 64));
    session.inventory.selected = 0;
    player.yaw = 0;
    player.pitch = 0.9;
    session.interaction.updateTarget();
    session.useHeld();
    const target = session.interaction.state.target!;
    const x = target.x + target.nx;
    const y = target.y + target.ny;
    const z = target.z + target.nz;

    world.setBlock(x, y - 1, z, AIR, 'player');
    for (let i = 0; i < 20; i++) session.tick();
    expect(world.getBlock(x, y, z)).toBe(AIR);
  });
});
