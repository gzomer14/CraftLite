/**
 * Avisos de armazenamento (doc 11 §4; saíram do `main.ts` no M18).
 *
 * Os dois chegam **ao entrar no mundo**, que é o momento em que ainda dá para
 * agir: descobrir que o progresso não seria salvo depois de duas horas de
 * construção é tarde demais.
 */

import { t, tf } from '../core/i18n';
import type { SaveDatabase } from './db';

/** Acima disto de cota usada, o doc 11 §4 manda avisar o jogador. */
const QUOTA_WARN_RATIO = 0.8;

export function warnStorage(
  db: SaveDatabase | null, hud: { showMessage(text: string, ticks?: number): void },
): void {
  if (db === null) {
    hud.showMessage(t('store.none'), 400);
    return;
  }
  void db.estimate().then((estimate) => {
    if (estimate === null || estimate.quota <= 0) return;
    if (estimate.usage / estimate.quota <= QUOTA_WARN_RATIO) return;
    const used = Math.round((estimate.usage / estimate.quota) * 100);
    hud.showMessage(tf('store.almost_full', used), 400);
  });
}
