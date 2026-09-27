/**
 * Sistemas de tick dos mods (M21).
 *
 * Com algum mod de tick ligado, o `tick` **desta instância** da `Session` vira
 * o do jogo seguido dos mods. Sem nenhum, não se toca em nada: o método que
 * roda é o do protótipo, o mesmo de antes do M21 — não existe lista vazia sendo
 * percorrida a cada tick nem `if (mod)` no caminho quente.
 */

import { ACTIVE_MODS } from './active';
import type { ModContext } from './types';

export function attachModSystems(session: ModContext & { tick(): void }): void {
  const ticks: ((ctx: ModContext) => void)[] = [];
  for (const mod of ACTIVE_MODS) {
    if (mod.tick !== undefined) ticks.push(mod.tick);
  }
  if (ticks.length === 0) return;
  const base = session.tick.bind(session);
  session.tick = (): void => {
    base();
    for (let i = 0; i < ticks.length; i++) ticks[i](session);
  };
}
