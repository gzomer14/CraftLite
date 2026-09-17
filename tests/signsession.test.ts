/**
 * Fiação da placa e da tampa do baú na `Session` (M8).
 *
 * As duas peças são **estado fora do voxel**: o texto da placa vive num mapa, a
 * tampa vive num bit do estado do bloco. O erro que só um teste de integração
 * pega é o ciclo de vida — texto que sobrevive à placa quebrada (e reaparece na
 * próxima placa colocada no mesmo lugar), tampa que fica aberta para sempre
 * porque ninguém a fechou.
 */

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_NAME, blockIdOf, makeState, stateBitsOf, AIR } from '../src/data/blocks';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';

const CHEST = BLOCK_BY_NAME.get('chest')?.id ?? -1;
const SIGN = BLOCK_BY_NAME.get('oak_sign')?.id ?? -1;

interface Edit { x: number; y: number; z: number; lines: readonly string[] }

/** Mundo chapado de pedra até Y=63, com jogador em cima. */
function flatWorld(): { world: World; session: Session; edits: Edit[] } {
  const world = new World(1);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 63; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(1));
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
  const edits: Edit[] = [];
  const player = new Player(8.5, 64, 10.5);
  const session = new Session(world, player, {
    onOpenScreen: () => { /* sem UI */ },
    onDeath: () => { /* não morre */ },
    onPickup: () => { /* nada */ },
    onSignEdit: (x, y, z, lines) => { edits.push({ x, y, z, lines: lines.slice() }); },
  });
  return { world, session, edits };
}

/** Quebra o bloco mirado pelo caminho do jogo, que é quem dispara os eventos. */
function breakAimed(session: Session): void {
  session.player.mode = 'creative'; // quebra em um tick
  session.interaction.tickBreaking(true, null);
}

/** Mira o bloco `(x, y, z)` de cima, de pé no vizinho de +Z. */
function aimAt(session: Session, x: number, y: number, z: number): void {
  session.player.setPosition(x + 0.5, y, z + 2.5);
  session.player.yaw = Math.PI; // olhando para −Z
  session.player.pitch = 0.6;
  session.interaction.updateTarget();
}

describe('placa na sessão', () => {
  it('usar a placa pede o editor, com o que já estiver escrito', () => {
    const { world, session, edits } = flatWorld();
    world.setBlock(8, 64, 8, makeState(SIGN), 'player');
    session.writeSign(8, 64, 8, ['casa', 'do', 'joao']);

    aimAt(session, 8, 64, 8);
    session.useHeld();

    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ x: 8, y: 64, z: 8 });
    expect(edits[0].lines).toEqual(['CASA', 'DO', 'JOAO', '']);
  });

  it('placa nunca escrita abre o editor em branco', () => {
    const { world, session, edits } = flatWorld();
    world.setBlock(8, 64, 8, makeState(SIGN), 'player');
    aimAt(session, 8, 64, 8);
    session.useHeld();
    expect(edits[0].lines).toEqual(['', '', '', '']);
  });

  it('quebrar a placa leva o texto junto', () => {
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(SIGN), 'player');
    session.writeSign(8, 64, 8, ['aviso']);
    expect(session.signs.get(8, 64, 8)).not.toBeNull();

    aimAt(session, 8, 64, 8);
    breakAimed(session);

    expect(session.signs.get(8, 64, 8)).toBeNull();
    // E a próxima placa no mesmo lugar nasce em branco, não com o texto antigo.
    world.setBlock(8, 64, 8, makeState(SIGN), 'player');
    expect(session.signs.get(8, 64, 8)).toBeNull();
  });

  it('trocar de dimensão esvazia as placas', () => {
    // A placa é de coordenada, e a coordenada do outro lado é de outro mundo:
    // ela tem de sair junto com baú, mob e item no chão.
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(SIGN), 'player');
    session.writeSign(8, 64, 8, ['aviso']);
    expect(session.signs.size).toBe(1);
    session.enterDimension(1);
    expect(session.signs.size).toBe(0);
  });
});

describe('tampa do baú', () => {
  it('abrir levanta a tampa e fechar a devolve', () => {
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(CHEST), 'player');
    expect(stateBitsOf(world.getBlock(8, 64, 8)) & 1).toBe(0);

    aimAt(session, 8, 64, 8);
    session.useHeld();
    expect(session.openScreen).toBe('chest');
    expect(stateBitsOf(world.getBlock(8, 64, 8)) & 1).toBe(1);

    session.closeScreen();
    expect(stateBitsOf(world.getBlock(8, 64, 8)) & 1).toBe(0);
  });

  it('o bloco continua sendo baú com a tampa levantada', () => {
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(CHEST), 'player');
    aimAt(session, 8, 64, 8);
    session.useHeld();
    expect(blockIdOf(world.getBlock(8, 64, 8))).toBe(CHEST);
  });

  it('baú duplo abre as duas tampas', () => {
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(CHEST), 'player');
    world.setBlock(9, 64, 8, makeState(CHEST), 'player');

    aimAt(session, 8, 64, 8);
    session.useHeld();
    expect(stateBitsOf(world.getBlock(8, 64, 8)) & 1).toBe(1);
    expect(stateBitsOf(world.getBlock(9, 64, 8)) & 1).toBe(1);

    session.closeScreen();
    expect(stateBitsOf(world.getBlock(8, 64, 8)) & 1).toBe(0);
    expect(stateBitsOf(world.getBlock(9, 64, 8)) & 1).toBe(0);
  });

  it('abrir outro baú fecha o primeiro', () => {
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(CHEST), 'player');
    world.setBlock(8, 64, 4, makeState(CHEST), 'player');

    aimAt(session, 8, 64, 8);
    session.useHeld();
    session.closeScreen();
    aimAt(session, 8, 64, 4);
    session.useHeld();

    expect(stateBitsOf(world.getBlock(8, 64, 8)) & 1).toBe(0);
    expect(stateBitsOf(world.getBlock(8, 64, 4)) & 1).toBe(1);
  });

  it('quebrar o baú aberto não deixa bit solto no ar', () => {
    const { world, session } = flatWorld();
    world.setBlock(8, 64, 8, makeState(CHEST), 'player');
    aimAt(session, 8, 64, 8);
    session.useHeld();
    breakAimed(session);
    expect(world.getBlock(8, 64, 8)).toBe(AIR);
    // Fechar depois não pode ressuscitar o baú.
    session.closeScreen();
    expect(world.getBlock(8, 64, 8)).toBe(AIR);
  });
});
