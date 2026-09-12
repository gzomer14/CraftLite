/**
 * Cama: pular a noite e definir o ponto de renascimento (M5).
 *
 * A regra que interessa aqui é a de justiça: dormir só à noite e só com o
 * abrigo fechado. Sem ela a primeira noite deixa de ser um desafio.
 */
import { describe, expect, it } from 'vitest';
import { NIGHT_FROM, NIGHT_TO, isNight, trySleep } from '../src/game/sleep';
import { TICKS_PER_DAY } from '../src/game/daynight';
import { Session } from '../src/game/session';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { MOB_BY_NAME } from '../src/data/mobs';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
const bed = makeState(BLOCK_BY_NAME.get('bed')!.id);
const ZOMBIE = MOB_BY_NAME.get('zombie')!.id;

function flatWorld(): World {
  const world = new World(31337);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
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
  return world;
}

function harness() {
  const world = flatWorld();
  const player = new Player(8.5, GROUND_Y + 1, 8.5);
  const messages: string[] = [];
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ },
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
    onMessage: (text) => messages.push(text),
  });
  // Cama ao lado, e o jogador olhando para ela.
  world.setBlock(9, GROUND_Y, 8, bed, 'player');
  player.setPosition(9.5, GROUND_Y + 1, 8.5);
  player.pitch = Math.PI / 2 - 0.01;
  session.interaction.updateTarget();
  return { world, player, session, messages };
}

describe('janela da noite', () => {
  it('meio-dia não é noite, meia-noite é', () => {
    expect(isNight(6000)).toBe(false);
    expect(isNight(18000)).toBe(true);
    expect(isNight(NIGHT_FROM)).toBe(true);
    expect(isNight(NIGHT_TO)).toBe(true);
    expect(isNight(NIGHT_FROM - 1)).toBe(false);
    expect(isNight(NIGHT_TO + 1)).toBe(false);
  });

  it('aceita tempo fora da faixa 0..23999', () => {
    expect(isNight(18000 + TICKS_PER_DAY * 3)).toBe(true);
    expect(isNight(-TICKS_PER_DAY + 18000)).toBe(true);
  });
});

describe('permissão para dormir', () => {
  it('de dia recusa', () => {
    const result = trySleep(6000, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('day');
  });

  it('com monstro por perto recusa', () => {
    const result = trySleep(18000, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('monsters');
  });

  it('de noite, sozinho, aceita e acorda de manhã', () => {
    const result = trySleep(18000, 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isNight(result.wakeTime)).toBe(false);
  });
});

describe('cama no mundo', () => {
  it('usar a cama de noite pula para o amanhecer', () => {
    const { session } = harness();
    session.dayNight.time = 18000;

    expect(session.useHeld()).toBe(true);
    expect(isNight(session.dayNight.time)).toBe(false);
  });

  it('usar a cama de dia avisa e não muda a hora', () => {
    const { session, messages } = harness();
    session.dayNight.time = 6000;

    expect(session.useHeld()).toBe(true);
    expect(session.dayNight.time).toBe(6000);
    expect(messages.join(' ')).toContain('noite');
  });

  it('monstro perto impede o sono', () => {
    const { session, messages } = harness();
    session.dayNight.time = 18000;
    session.mobs.spawn(ZOMBIE, 12.5, GROUND_Y + 1, 8.5);

    expect(session.useHeld()).toBe(true);
    expect(session.dayNight.time).toBe(18000);
    expect(messages.join(' ')).toContain('monstros');
  });

  it('monstro longe não impede', () => {
    const { session } = harness();
    session.dayNight.time = 18000;
    session.mobs.spawn(ZOMBIE, 40.5, GROUND_Y + 1, 40.5);

    expect(session.useHeld()).toBe(true);
    expect(isNight(session.dayNight.time)).toBe(false);
  });

  it('a cama vira o ponto de renascimento, mesmo sem dormir', () => {
    const { session, player } = harness();
    session.dayNight.time = 6000; // recusado, mas o spawn é definido

    session.useHeld();
    expect(session.spawnX).toBe(9);
    expect(session.spawnZ).toBe(8);

    player.setPosition(80.5, GROUND_Y + 1, 80.5);
    session.respawn(0, 0);
    expect(Math.floor(player.x)).toBe(9);
    expect(Math.floor(player.z)).toBe(8);
  });

  it('sem cama, renasce no spawn do mundo', () => {
    const { session, player } = harness();
    player.setPosition(80.5, GROUND_Y + 1, 80.5);
    session.respawn(0, 0);
    expect(Math.floor(player.x)).toBe(0);
    expect(Math.floor(player.z)).toBe(0);
  });
});
