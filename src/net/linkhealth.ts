/**
 * Quando uma ligação caiu de verdade (M20, relato de campo de 2026-09-28).
 *
 * O WebRTC confere a ligação a cada poucos segundos, e marca `disconnected`
 * quando as respostas atrasam — **um estado passageiro**, que volta sozinho a
 * `connected` quando o Wi-Fi acorda. A primeira versão tratava `disconnected`
 * como o fim: com um J7 Metal de anfitrião (economia de energia do Wi-Fi de
 * celular antigo), o convidado caía a cada 2 ou 3 minutos. Agora
 * `disconnected` é "instável": a sala avisa e espera `GRACE_MS`; só `failed`,
 * `closed`, um canal fechado, ou a espera esgotada, derrubam.
 *
 * Função pura sobre o estado e o relógio: é o que o teste confere, sem WebRTC.
 */

/** Quanto esperar uma ligação instável voltar. */
export const GRACE_MS = 20000;

export type Health = 'ok' | 'unstable' | 'dead';

export class LinkHealth {
  private since = -1;
  /** Por que caiu, em termos do WebRTC (vai para a tela e para o chat). */
  reason = '';

  constructor(private readonly graceMs = GRACE_MS) {}

  get state(): Health {
    if (this.reason !== '') return 'dead';
    return this.since >= 0 ? 'unstable' : 'ok';
  }

  /** Um estado novo de `connectionState` (ou `iceConnectionState`). */
  observe(connection: string, now: number): Health {
    if (this.reason !== '') return 'dead';
    if (connection === 'failed' || connection === 'closed') {
      this.reason = connection;
    } else if (connection === 'disconnected') {
      if (this.since < 0) this.since = now;
    } else if (connection === 'connected' || connection === 'completed') {
      this.since = -1;
    }
    return this.check(now);
  }

  /** Um canal de dados fechou: sem ele, a sala não anda. */
  channelClosed(label: string): Health {
    if (this.reason === '') this.reason = `channel ${label} closed`;
    return 'dead';
  }

  /** O relógio andou: a espera esgotou? */
  check(now: number): Health {
    if (this.reason === '' && this.since >= 0 && now - this.since >= this.graceMs) {
      this.reason = `disconnected for ${Math.round((now - this.since) / 1000)} s`;
    }
    return this.state;
  }
}
