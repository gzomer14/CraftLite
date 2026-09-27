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
 * O que o convidado ainda não faz nesta primeira versão — e diz na tela:
 * abrir baú, fornalha e afins (o conteúdo mora no anfitrião), dormir (a noite
 * é do anfitrião) e atravessar portal (a sala é na superfície).
 */

import { blockIdOf } from '../data/blocks';
import { isContainerBlock } from '../game/tiles';
import { applyStructures } from '../game/sessionwiring';
import { isBedAt } from '../world/multiblock';
import { t } from '../core/i18n';
import type { Session } from '../game/session';
import type { ChunkColumn } from '../world/chunk';

const noop = (): void => undefined;

export function makeFollower(session: Session, message: (text: string) => void): void {
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

  const open = session.workbench.open.bind(session.workbench);
  session.workbench.open = (x: number, y: number, z: number): boolean => {
    if (isContainerBlock(blockIdOf(session.world.getBlock(x, y, z)))) {
      message(t('net.no_containers'));
      return true;
    }
    return open(x, y, z);
  };

  const bed = session.blockUse.bed.bind(session.blockUse);
  session.blockUse.bed = (x: number, y: number, z: number): boolean => {
    if (!isBedAt(session.world, x, y, z)) return bed(x, y, z);
    session.spawnX = x;
    session.spawnY = y + 1;
    session.spawnZ = z;
    message(t('net.no_sleep'));
    return true;
  };
}
