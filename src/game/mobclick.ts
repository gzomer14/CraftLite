/**
 * Clique direito mirando um mob (saiu de `session.ts` no M18): conversa com o
 * aldeão, ação de item no bicho, domar e dar comida.
 */

import { t } from '../core/i18n';
import { itemDef } from '../data/items';
import { FLAG_TRADING } from '../entity/mobstore';
import type { Session, SessionEvents } from './session';

/**
 * Clique direito mirando um mob: doma com o item certo (doc 07 §2).
 * Devolve true se o mob consumiu o clique.
 */
export function useOnMob(
  s: Session, events: SessionEvents, dx: number, dy: number, dz: number,
): boolean {
  const eyeY = s.player.y + s.player.eyeHeight;
  const index = s.mobs.pickTarget(
    s.player.x, eyeY, s.player.z, dx, dy, dz, s.player.reach,
  );
  if (index < 0) return false;
  // Aldeão: clique direito é conversa, com ou sem item na mão (M9).
  if (s.villages.isVillager(index)) return talkTo(s, events, index);

  const held = s.inventory.held;
  if (held === null) return false;
  const name = itemDef(held.item)?.name;
  if (name === undefined) return false;

  // Ações de item em bicho (tesoura, balde na vaca, corante na ovelha).
  if (s.itemUser.onMob(held, index)) return true;

  const tame = s.mobs.tryTame(index, name);
  if (tame !== 'none') {
    if (s.player.mode === 'survival') s.inventory.consumeHeld();
    events.onMessage?.(tame === 'tamed' ? t('msg.tamed') : t('msg.not_tamed'));
    return true;
  }

  const feed = s.mobs.tryFeed(index, name);
  if (feed === 'none') return false;
  // Quem acabou de cruzar não come de novo: o item não some à toa.
  if (feed === 'wait') return true;
  if (s.player.mode === 'survival') s.inventory.consumeHeld();
  s.achievements.event('breed');
  return true;
}

/** Abre a troca com o aldeão, se a aldeia dele ainda aceita o jogador. */
function talkTo(s: Session, events: SessionEvents, index: number): boolean {
  const store = s.mobs.store;
  if (s.villages.isBanned(index)) {
    events.onMessage?.(t('msg.no_trade'));
    events.onSound?.('mob/villager_hurt', store.x[index], store.centerY(index), store.z[index]);
    return true;
  }
  s.villages.stopTrading();
  store.setFlag(index, FLAG_TRADING, true);
  s.workbench.setScreen('trading', null);
  return true;
}
