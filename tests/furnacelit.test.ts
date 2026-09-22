/**
 * Fornalha acesa (M8).
 *
 * A fornalha queimava sem dar sinal nenhum: mesma textura parada, mesma luz.
 * Quem passava por uma oficina não sabia se a fundição estava andando sem
 * abrir a tela — e, no escuro, uma fornalha ligada não iluminava nada.
 *
 * São dois ids de bloco, como a lâmpada de redstone, e a razão é a mesma: a
 * emissão de luz é coluna da tabela indexada por **id**, e é ela que o flood
 * fill lê. O que estes testes protegem é a sincronia entre o estado do tile
 * entity e o voxel — e, principalmente, que a **luz** acompanhe a troca.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Furnace, FURNACE_FUEL, FURNACE_INPUT } from '../src/game/container';
import { BLOCK_BY_NAME, blockIdOf, makeState } from '../src/data/blocks';
import { itemId, makeStack } from '../src/data/items';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const FURNACE = BLOCK_BY_NAME.get('furnace')!.id;
const FURNACE_LIT = BLOCK_BY_NAME.get('furnace_lit')!.id;

/** Mundo de pedra até y = 63, com a fornalha em (8, 64, 8). */
function worldWithFurnace(): { world: World; session: Session } {
  const world = new World(31);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 63; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      chunk.recomputeHeightMap();
      for (const section of chunk.sections) {
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
      }
      world.addChunk(chunk);
    }
  }
  const player = new Player(8.5, 64, 10.5);
  const session = new Session(world, player, {
    onOpenScreen: () => { /* sem UI */ },
    onDeath: () => { /* não morre */ },
    onPickup: () => { /* nada */ },
  });
  world.setBlock(8, 64, 8, makeState(FURNACE), 'player');
  return { world, session };
}

/** Abre a fornalha pelo caminho do jogo, que é o que cria o tile entity. */
function openFurnace(session: Session, x: number, y: number, z: number): Furnace {
  session.player.setPosition(x + 0.5, y, z + 2.5);
  session.player.yaw = Math.PI; // olhando para −Z
  // Os olhos ficam 1,62 acima dos pés: mirando na horizontal o raio passa por
  // cima do bloco. A inclinação é o que faz ele cair dentro da fornalha.
  session.player.pitch = 0.6;
  session.interaction.updateTarget();
  session.useHeld();
  const container = session.workbench.openContainer;
  expect(container, 'a fornalha tem que abrir').toBeInstanceOf(Furnace);
  return container as Furnace;
}

describe('fornalha acesa', () => {
  it('apagada, o bloco é a fornalha comum', () => {
    const { world } = worldWithFurnace();
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(FURNACE);
  });

  it('com combustível queimando, o bloco troca para o aceso', () => {
    const { world, session } = worldWithFurnace();
    const furnace = openFurnace(session, 8, 64, 8);
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 1));
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 1));

    for (let i = 0; i < 5; i++) session.tick();
    expect(furnace.isLit).toBe(true);
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(FURNACE_LIT);
  });

  /*
   * A troca sem aviso à luz é o erro clássico: a textura acende e a caverna
   * continua escura, porque o flood fill não soube que a emissão mudou.
   */
  it('acesa, ela ilumina o que está em volta', () => {
    const { world, session } = worldWithFurnace();
    const furnace = openFurnace(session, 8, 64, 8);
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 1));
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 1));
    expect(world.getBlockLight(8, 64, 9)).toBe(0);

    for (let i = 0; i < 5; i++) session.tick();
    expect(world.getBlockLight(8, 64, 9)).toBeGreaterThan(0);
  });

  it('quando o combustível acaba, ela apaga e o mundo escurece de novo', () => {
    const { world, session } = worldWithFurnace();
    const furnace = openFurnace(session, 8, 64, 8);
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 1));
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 1));
    for (let i = 0; i < 5; i++) session.tick();
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(FURNACE_LIT);

    // Queima o resto do combustível sem nada para fundir.
    furnace.burnTicks = 1;
    furnace.set(FURNACE_INPUT, null);
    furnace.set(FURNACE_FUEL, null);
    for (let i = 0; i < 5; i++) session.tick();

    expect(furnace.isLit).toBe(false);
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(FURNACE);
    expect(world.getBlockLight(8, 64, 9)).toBe(0);
  });

  it('a fornalha acesa continua abrindo e guardando o mesmo conteúdo', () => {
    const { world, session } = worldWithFurnace();
    const furnace = openFurnace(session, 8, 64, 8);
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 1));
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 1));
    for (let i = 0; i < 5; i++) session.tick();
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(FURNACE_LIT);

    session.workbench.closeScreen();
    const again = openFurnace(session, 8, 64, 8);
    expect(again).toBe(furnace);
    // O carvão já foi consumido ao acender; o que fica é a fundição em curso.
    expect(again.get(FURNACE_INPUT)?.item).toBe(itemId('raw_iron'));
  });
});
