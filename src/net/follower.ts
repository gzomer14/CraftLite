/**
 * O convidado como seguidor (M20): a sessão dele desenha o mundo, mas não o
 * simula.
 *
 * Quem roda fluidos, fogo, crescimento, circuito, fornalha, funil, mobs e
 * spawn é o anfitrião; o convidado recebe o resultado como blocos e mobs
 * (`net/guest.ts`, `net/mobsync.ts`). Se os dois simulassem, cada um chegaria
 * a um mundo diferente em segundos.
 *
 * Como os mods do M21, as trocas são feitas **na instância** desta sessão: a
 * classe `Session` não ganha um `if (convidado)` em lugar nenhum, e quem joga
 * sozinho roda exatamente o código de antes.
 *
 * O que o convidado ainda não faz: atravessar portal (a sala é na
 * superfície). Baú e fornalha passam pelo anfitrião (`net/containersync.ts`),
 * e a cama pela sala (`net/sleepsync.ts`).
 */

import { applyStructures } from '../game/sessionwiring';
import type { Session } from '../game/session';
import type { ChunkColumn } from '../world/chunk';

const noop = (): void => undefined;

export function makeFollower(session: Session): void {
  // `systems` é privado na `Session` (fluidos, fogo, crescimento, areia): a
  // única porta de fora, e só aqui.
  (session as unknown as { systems: { tick(raining: boolean): void } }).systems.tick = noop;
  session.redstone.tick = noop;
  session.tiles.tick = noop;
  session.dragonFight.tick = noop;
  session.itemFlow.tick = noop;
  session.spawners.tick = noop;
  session.spawner.tick = noop;
  session.mobs.tick = noop;
  session.travel.tick = () => false;

  // Chunk novo: as estruturas saem da seed igual nos dois aparelhos, e a luz
  // costura; bicho e aldeão, não — eles chegam do anfitrião.
  session.onChunkLoaded = (chunk: ChunkColumn) => {
    applyStructures(session, chunk);
    session.lighting.stitchColumn(chunk.cx, chunk.cz);
  };
}
