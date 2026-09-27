/**
 * O que o mundo faz depois de um bloco que chegou pela rede (M20).
 *
 * No jogo sozinho, quem muda o bloco chama as reações: a interação recalcula a
 * luz, e o `onBlockBroken`/`onBlockPlaced` da sessão cuida de fluido, baú e
 * placa (`game/session.ts`). O bloco da rede entra direto por
 * `world.setBlock(…, 'network')` e não passa por nenhum desses caminhos — sem
 * isto, o buraco aberto pelo outro jogador ficava **escuro** (defeito achado em
 * aparelho, 2026-09-27) e a água ao lado não corria.
 *
 * Fica de fora, de propósito, o que é de quem quebrou: drop, XP, fome,
 * desgaste da ferramenta, estatística.
 */

import { blockIdOf } from '../data/blocks';
import type { Session } from '../game/session';

/**
 * Reage a um bloco aplicado pela rede. `authority` é o anfitrião: só ele cria
 * contêiner e agenda fluido, porque só ele simula.
 */
export function reactToNetworkBlock(
  session: Session, x: number, y: number, z: number, previous: number, state: number, authority: boolean,
): void {
  if (previous === state) return;
  session.lighting.onBlockChanged(x, y, z, previous, state);
  const before = blockIdOf(previous);
  const after = blockIdOf(state);
  if (before === after) return;
  session.signs.remove(x, y, z);
  if (!authority) return;
  session.removeContainerAt(x, y, z);
  session.tiles.create(x, y, z, after);
  session.fluids.scheduleAround(x, y, z);
}
