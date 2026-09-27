/**
 * Entrada do pedaço de rede do jogo (M20): o que `game/netgate.ts` baixa
 * quando o jogador abre ou entra numa sala.
 */

import { t, tf } from '../core/i18n';
import { onLeaveRoom, type GameHandles, type RemoteStart } from '../game/netgate';
import type { WorldMeta } from '../save/db';
import { GuestClient } from './guest';
import { HostRoom } from './host';
import { playerName } from './identity';
import { HostPanel, JoinPanel, refusalText } from './roomui';

/** Jogadores na sala, contando o anfitrião (doc 14, M20). */
function maxPlayers(game: GameHandles): number {
  return game.tier === 0 ? 4 : 6;
}

let room: HostRoom | null = null;
let panel: HostPanel | null = null;
let guest: GuestClient | null = null;

/** Gancho do smoke test da sala (`scripts/smoke-room.mjs`): só com `?smoke`. */
if (/[?&]smoke\b/.test(location.search)) {
  (window as unknown as { __craftliteNet?: unknown }).__craftliteNet = { room: () => room, guest: () => guest };
}

export function roomLabel(): string {
  if (room === null || !room.isOpen) return t('net.open_room');
  return tf('net.room_label', room.guests.length);
}

/** Pausa → *Abrir para a rede local*: liga a sala e mostra o painel. */
export function openRoom(game: GameHandles): void {
  if (room === null || !room.isOpen) {
    room = new HostRoom(game, playerName(), maxPlayers(game) - 1, {
      changed: () => panel?.refresh(),
      message: (name) => game.hud.showMessage(`${name} — ${t('net.joined')}`, 80),
    });
    room.start();
    const current = room;
    onLeaveRoom(() => current.close());
  }
  const r = room;
  panel ??= new HostPanel({
    invite: () => r.invite(),
    accept: (answer) => r.accept(answer),
    players: () => r.guests.filter((g) => g.ready).map((g) => ({ netId: g.netId, name: g.name })),
    kick: (netId) => r.kick(netId),
    full: () => r.guests.length >= maxPlayers(game) - 1,
    back: () => {
      panel?.hide();
      game.controls.reset();
    },
    close: () => {
      void r.close();
      panel?.destroy();
      panel = null;
      game.controls.reset();
      game.hud.showMessage(t('net.room_closed'), 80);
    },
  });
  game.controls.mouse.exitLock();
  panel.show();
}

/** Título → *Entrar numa sala*. `start` sobe o jogo como convidado. */
export function joinRoom(start: (meta: WorldMeta, remote: RemoteStart) => void, back: () => void): void {
  let client: GuestClient | null = null;
  const ui: JoinPanel = new JoinPanel({
    answer: async (offer, name) => {
      client?.cancel();
      const made = await GuestClient.answer(offer, name);
      client = made.client;
      const mine = made.client;
      void mine.join().then((outcome) => {
        if (client !== mine) return;
        if (outcome.kind === 'welcome') {
          guest = mine;
          ui.destroy();
          onLeaveRoom(() => mine.leave());
          start(outcome.meta, outcome.remote);
        } else if (outcome.kind === 'refused') {
          ui.fail(refusalText(outcome.reason, outcome.detail));
        } else {
          ui.fail(t('net.failed'));
        }
      });
      return made.answer;
    },
    cancel: () => {
      client?.cancel();
      client = null;
      ui.destroy();
      back();
    },
  });
  ui.show();
}
