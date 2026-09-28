/**
 * Uma ligação direta entre dois aparelhos na mesma rede (M20, doc 12 §2).
 *
 * `RTCPeerConnection` com `iceServers: []`: sem STUN e sem TURN, o navegador só
 * conhece os próprios endereços da rede local, e a ligação só fecha se o outro
 * aparelho alcançar um deles. Nenhum servidor participa — nem para
 * sinalização, que passa pela tela (`net/signal.ts`).
 *
 * Dois canais de dados, negociados pelos dois lados com o mesmo id (sem troca
 * de anúncio):
 * - `reliable` (id 0): ordenado e com garantia — blocos, inventário, chat;
 * - `fast` (id 1): sem ordem e sem retransmissão — posição, onde um pacote
 *   velho não vale nada.
 *
 * Quem abre a sala é o anfitrião (oferta); quem entra, o convidado (resposta).
 */

import {
  midOf, sdpFromSignal, signalFromSdp, type CandidateKind, type Signal,
} from './signal';
import { LinkHealth } from './linkhealth';

/** Quanto esperar os candidatos. Na rede local, eles chegam em milissegundos. */
const GATHER_TIMEOUT_MS = 4000;
/** Sem candidato novo por este tempo, a coleta está pronta. */
const GATHER_QUIET_MS = 600;
/**
 * Acima disto na fila do canal rápido, a posição nova é jogada fora: ela
 * envelhece na fila, e a fila cheia é o que o Chrome derruba.
 */
const FAST_BUFFER_LIMIT = 256 * 1024;

export interface CandidateInfo {
  type: string;
  /** `hidden`: o navegador não conta o endereço (candidato mDNS). */
  kind: CandidateKind | 'hidden' | 'unknown';
  /** Endereço com o fim escondido (`192.168.x.x`): vai para o relatório. */
  masked: string;
  protocol: string;
}

export interface PairInfo {
  local: CandidateInfo;
  remote: CandidateInfo;
  rttMs: number | null;
}

export class Link {
  readonly pc: RTCPeerConnection;
  readonly reliable: RTCDataChannel;
  readonly fast: RTCDataChannel;
  /**
   * Cada mudança de estado, com o tempo desde a criação. Nos termos do WebRTC,
   * em inglês: vai para o relatório da prova de conexão.
   */
  readonly log: string[] = [];
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /**
   * A ligação ficou instável (`true`) ou voltou (`false`): a sala avisa e
   * espera, em vez de derrubar (`net/linkhealth.ts`).
   */
  onUnstable: ((unstable: boolean) => void) | null = null;
  /** Por que caiu — vazio enquanto está de pé. */
  get closeReason(): string {
    return this.health.reason;
  }
  private readonly health = new LinkHealth();
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  onMessage: ((data: ArrayBuffer, reliable: boolean) => void) | null = null;
  private readonly born = performance.now();
  private localMid = '0';
  private opened = false;

  private constructor() {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.reliable = this.pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
    this.fast = this.pc.createDataChannel('f', {
      negotiated: true, id: 1, ordered: false, maxRetransmits: 0,
    });
    for (const channel of [this.reliable, this.fast]) {
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => this.checkOpen();
      channel.onclose = () => {
        this.note(`channel ${channel.label}: closed`);
        if (this.opened) {
          this.health.channelClosed(channel.label);
          this.fireClose();
        }
      };
      channel.onmessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) this.onMessage?.(e.data, channel === this.reliable);
      };
    }
    this.pc.onicegatheringstatechange = () => this.note(`gathering: ${this.pc.iceGatheringState}`);
    this.pc.oniceconnectionstatechange = () => this.note(`ice: ${this.pc.iceConnectionState}`);
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.note(`connection: ${s}`);
      // Antes de abrir, `disconnected` é só a negociação: quem espera é o pareamento.
      if (!this.opened && s === 'disconnected') return;
      const before = this.health.state;
      const now = this.health.observe(s, performance.now());
      if (now === 'dead') {
        this.fireClose();
      } else if (now === 'unstable' && before === 'ok') {
        this.onUnstable?.(true);
        this.healthTimer = setInterval(() => {
          if (this.health.check(performance.now()) === 'dead') this.fireClose();
        }, 1000);
      } else if (now === 'ok' && before === 'unstable') {
        clearInterval(this.healthTimer);
        this.onUnstable?.(false);
      }
    };
  }

  /** Anfitrião: cria a oferta e espera os candidatos. */
  static async host(): Promise<{ link: Link; offer: Signal }> {
    const link = new Link();
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await link.gathered();
    const sdp = link.pc.localDescription?.sdp ?? '';
    link.localMid = midOf(sdp);
    return { link, offer: signalFromSdp(sdp, 'offer') };
  }

  /** Convidado: aplica a oferta lida e cria a resposta. */
  static async guest(offer: Signal): Promise<{ link: Link; answer: Signal }> {
    const link = new Link();
    await link.pc.setRemoteDescription({ type: 'offer', sdp: sdpFromSignal(offer, '0') });
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await link.gathered();
    return { link, answer: signalFromSdp(link.pc.localDescription?.sdp ?? '', 'answer') };
  }

  /** Anfitrião: aplica a resposta do convidado. A ligação começa a fechar aqui. */
  async accept(answer: Signal): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: sdpFromSignal(answer, this.localMid) });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  send(data: ArrayBuffer | Uint8Array, reliable: boolean): void {
    const channel = reliable ? this.reliable : this.fast;
    if (channel.readyState !== 'open') return;
    // Rede lenta (ou instável): posição velha não vale nada; a fila, sim.
    if (!reliable && channel.bufferedAmount > FAST_BUFFER_LIMIT) return;
    try {
      channel.send(data as ArrayBuffer);
    } catch {
      // Fila cheia no confiável: o que devia chegar não chega mais.
      if (reliable && this.opened) {
        this.health.channelClosed(`${channel.label} (send)`);
        this.fireClose();
      }
    }
  }

  close(): void {
    clearInterval(this.healthTimer);
    this.pc.close();
  }

  /** Avisa uma vez só: fecha por qualquer caminho que chegue primeiro. */
  private fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.healthTimer);
    this.note(`closed: ${this.health.reason}`);
    this.onClose?.();
  }

  /** O par de candidatos que venceu: por onde os dados estão passando. */
  async pair(): Promise<PairInfo | null> {
    const stats = await this.pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    stats.forEach((r: Record<string, unknown>) => byId.set(r.id as string, r));
    let pair: Record<string, unknown> | undefined;
    for (const r of byId.values()) {
      if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') {
        pair = byId.get(r.selectedCandidatePairId);
      }
    }
    if (pair === undefined) {
      for (const r of byId.values()) {
        if (r.type === 'candidate-pair' && (r.selected === true || (r.nominated === true && r.state === 'succeeded'))) {
          pair = r;
        }
      }
    }
    if (pair === undefined) return null;
    const info = (id: unknown): CandidateInfo => describe(byId.get(id as string));
    const rtt = typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null;
    return { local: info(pair.localCandidateId), remote: info(pair.remoteCandidateId), rttMs: rtt };
  }

  private checkOpen(): void {
    if (this.opened || this.reliable.readyState !== 'open' || this.fast.readyState !== 'open') return;
    this.opened = true;
    this.note('channels: open');
    this.onOpen?.();
  }

  private note(text: string): void {
    this.log.push(`${Math.round(performance.now() - this.born)} ms — ${text}`);
  }

  /**
   * Espera os candidatos. O estado `complete` pode demorar segundos (o Chrome
   * espera interfaces que nunca respondem); na rede local, o que importa chega
   * em milissegundos. Então: um candidato UDP e `GATHER_QUIET_MS` sem outro
   * novo bastam. `GATHER_TIMEOUT_MS` é só a rede de segurança.
   */
  private gathered(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const done = (why: string): void => {
        clearTimeout(timer);
        clearTimeout(quiet);
        this.pc.removeEventListener('icegatheringstatechange', check);
        this.pc.removeEventListener('icecandidate', onCandidate);
        this.note(`gathering: ${why}`);
        resolve();
      };
      const check = (): void => {
        if (this.pc.iceGatheringState === 'complete') done('complete');
      };
      const onCandidate = (e: RTCPeerConnectionIceEvent): void => {
        if (e.candidate === null) {
          done('complete');
          return;
        }
        if (!/ udp /i.test(e.candidate.candidate)) return;
        clearTimeout(quiet);
        quiet = setTimeout(() => done('quiet'), GATHER_QUIET_MS);
      };
      const timer = setTimeout(() => done('timeout, using what arrived'), GATHER_TIMEOUT_MS);
      this.pc.addEventListener('icegatheringstatechange', check);
      this.pc.addEventListener('icecandidate', onCandidate);
    });
  }
}

function describe(report: Record<string, unknown> | undefined): CandidateInfo {
  if (report === undefined) return { type: '?', kind: 'unknown', masked: '?', protocol: '?' };
  const address = String(report.address ?? report.ip ?? '');
  return {
    type: String(report.candidateType ?? '?'),
    kind: kindOfAddress(address),
    masked: maskAddress(address),
    protocol: String(report.protocol ?? '?'),
  };
}

function kindOfAddress(address: string): CandidateKind | 'hidden' | 'unknown' {
  if (address === '') return 'hidden';
  if (address.endsWith('.local')) return 'mdns';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'ipv4';
  if (address.includes(':')) return 'ipv6';
  return 'unknown';
}

/** `192.168.x.x`, `fe80:…`, `….local`: o bastante para saber o tipo de rede. */
export function maskAddress(address: string): string {
  if (address.endsWith('.local')) return '….local';
  const v4 = address.split('.');
  if (v4.length === 4) return `${v4[0]}.${v4[1]}.x.x`;
  if (address.includes(':')) return `${address.split(':')[0]}:…`;
  return address === '' ? '?' : '…';
}
