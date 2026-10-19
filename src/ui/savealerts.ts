/**
 * Avisos do save no jogo (M23): falha de gravação, cota cheia e coluna
 * corrompida. Fica fora do `main.ts`, que está no teto de tamanho.
 *
 * O `SaveGame` nasce antes do fluxo de pausa, então as opções saem daqui já
 * prontas e a pausa entra depois, por `connect`.
 */

import { t, tf } from '../core/i18n';
import { STORE_WORLDS, type SaveDatabase, type WorldMeta } from '../save/db';
import type { SaveGameOptions } from '../game/savegame';
import { later } from './lategate';
import type { StorageFullDeps, StorageFullScreen } from './screens/storagefull';

interface Hudlike { showMessage(text: string, ticks?: number): void }
interface Pausable { paused: boolean }
interface Releasable { reset(): void; mouse: { exitLock(): void } }

export interface SaveAlerts {
  options: Pick<SaveGameOptions, 'onError' | 'onCorrupt' | 'onSaved'>;
  /** Grava tudo; `false` se alguma gravação falhou no caminho. */
  trySave(save: { saveAll(): Promise<void> }): Promise<boolean>;
  /** Liga a tela de cota cheia ao save e à pausa, quando os dois existirem. */
  connect(save: { saveAll(): Promise<void> }, flow: Pausable, controls: Releasable): void;
}

export function saveAlerts(db: SaveDatabase | null, worldId: string, hud: Hudlike): SaveAlerts {
  let screen: StorageFullScreen | null = null;
  let failed = false;
  const trySave = async (save: { saveAll(): Promise<void> }): Promise<boolean> => {
    failed = false;
    await save.saveAll();
    return !failed;
  };
  /** A pausa de antes da tela: aberta por cima da pausa, fechar não solta o mundo. */
  let wasPaused = false;
  /** Como montar a tela; existe depois do `connect`. A tela só nasce na primeira falta de espaço. */
  let build: (() => Promise<StorageFullScreen>) | null = null;
  /**
   * A tela vem do pedaço "depois" (M25): a primeira falta de espaço espera o
   * download (do cache, em instantes) e só então decide entre tela e aviso.
   */
  const firstQuota = (message: string): void => {
    const pending = build;
    if (pending === null) return;
    build = null;
    void pending().then((made) => {
      screen = made;
      if (made.handleFailure(true)) hud.showMessage(t('storefull.later'), 120);
    }, () => hud.showMessage(tf('store.save_failed', message), 120));
  };
  return {
    trySave,
    options: {
      onError: (message, quota) => {
        failed = true;
        if (quota && screen === null && build !== null) { firstQuota(message); return; }
        if (screen !== null && !screen.handleFailure(quota)) return;
        hud.showMessage(quota && screen !== null ? t('storefull.later') : tf('store.save_failed', message), 120);
      },
      onCorrupt: (cx, cz) => hud.showMessage(tf('store.corrupt', cx * 16, cz * 16), 200),
      onSaved: () => { if (screen !== null && !screen.gate.isOpen) screen.gate.saved(); },
    },
    connect(save, flow, controls) {
      if (db === null) return;
      const deps: StorageFullDeps = {
        listWorlds: () => db.getAll<WorldMeta>(STORE_WORLDS),
        removeWorld: (id) => db.deleteWorld(id),
        estimate: () => db.estimate(),
        retry: () => trySave(save),
        pause: () => {
          wasPaused = flow.paused;
          flow.paused = true;
          controls.reset();
          controls.mouse.exitLock();
        },
        resume: () => { flow.paused = wasPaused; },
      };
      build = async () => new (await later()).StorageFullScreen(worldId, deps);
    },
  };
}
