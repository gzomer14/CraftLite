/**
 * Telas da sala na rede local (M20): o painel do anfitrião e a entrada do
 * convidado. Mesmo estilo dos menus do jogo (`ui/screens/menu.ts`).
 *
 * O pareamento é o da prova de conexão (M20.0, `net/probe.ts`): o anfitrião
 * mostra um QR e um código; o convidado lê, mostra a resposta; o anfitrião lê a
 * resposta. Só depois disso o convidado entra — direto no mundo, sem tela de
 * "conectados".
 */

import { menuButton, menuPanel, menuRoot, menuRow, textField } from '../ui/screens/menu';
import { t, tf } from '../core/i18n';
import { decodeCode, encodeCode, groupCode } from './base32';
import { encodeQr, paintQr } from './qr';
import { canScan, scanQr } from './scan';
import { decodeSignal, encodeSignal, type Signal } from './signal';
import { MAX_NAME, playerName, setPlayerName } from './identity';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== '') e.textContent = text;
  if (cls !== '') e.className = cls;
  return e;
}

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const css = document.createElement('style');
  css.textContent = `
.net-code{font-size:15px;letter-spacing:1px;word-break:break-all;user-select:all;text-align:center}
.net-qr{display:block;margin:0 auto;max-width:100%;image-rendering:pixelated;border-radius:4px}
.net-video{width:100%;border-radius:6px}
.net-area{width:100%;box-sizing:border-box;font:inherit;padding:8px;background:#151a22;color:#fff;
  border:1px solid #394254;border-radius:6px}
.net-error{color:#ff8a80}
.net-list{display:flex;flex-direction:column;gap:6px}
.net-list .menu-row{align-items:center}
.net-list span{flex:1}
`;
  document.head.appendChild(css);
}

/** QR grande, o código em texto e *Copiar*. */
export function codeView(target: HTMLElement, signal: Signal): void {
  const code = encodeCode(encodeSignal(signal));
  const canvas = el('canvas', '', 'net-qr');
  paintQr(canvas, encodeQr(code), Math.min(320, window.innerWidth - 48));
  const text = el('p', groupCode(code), 'net-code');
  const copied = el('span');
  const copy = menuButton(t('net.copy'), () => {
    void navigator.clipboard?.writeText(groupCode(code)).then(() => { copied.textContent = t('net.copied'); }, () => undefined);
  });
  target.append(canvas, text, menuRow(copy), copied);
}

/**
 * O campo para colar o código e, se o aparelho lê QR, a câmera. `use` recebe o
 * sinal já conferido; erro de digitação fica na tela.
 */
export function codeReader(
  target: HTMLElement, expect: Signal['role'], button: string, use: (signal: Signal) => void,
): void {
  const area = el('textarea', '', 'net-area');
  area.rows = 3;
  area.placeholder = t('net.paste');
  const error = el('p', '', 'net-error');
  const apply = (text: string): void => {
    const bytes = decodeCode(text);
    const signal = bytes === null ? null : decodeSignal(bytes);
    if (signal === null) { error.textContent = t('net.bad_code'); return; }
    if (signal.role !== expect) { error.textContent = t('net.wrong_role'); return; }
    error.textContent = '';
    use(signal);
  };
  const cameraRow = menuRow();
  target.append(cameraRow, area, menuRow(menuButton(button, () => apply(area.value), 'primary')), error);
  void canScan().then((yes) => {
    if (!yes) return;
    const video = el('video', '', 'net-video');
    video.hidden = true;
    const stop = { cancelled: false };
    const cancel = menuButton(t('net.stop_scan'), () => { stop.cancelled = true; });
    cancel.hidden = true;
    const scan = menuButton(t('net.scan'), () => {
      stop.cancelled = false;
      video.hidden = false;
      cancel.hidden = false;
      scan.hidden = true;
      scanQr(video, stop).then((text) => {
        if (text !== null) apply(text);
      }, () => { error.textContent = t('net.camera_error'); }).finally(() => {
        video.hidden = true;
        cancel.hidden = true;
        scan.hidden = false;
      });
    }, 'primary');
    cameraRow.append(scan, cancel);
    cameraRow.after(video);
  });
}

// --- anfitrião ---------------------------------------------------------------------

export interface HostPanelActions {
  invite(): Promise<Signal>;
  accept(answer: Signal): Promise<void>;
  players(): { netId: number; name: string }[];
  kick(netId: number): void;
  close(): void;
  back(): void;
  full(): boolean;
}

export class HostPanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly invitation: HTMLDivElement;
  private waiting: ReturnType<typeof setTimeout> | undefined;
  private known = 0;

  constructor(private readonly actions: HostPanelActions) {
    injectStyle();
    this.root = menuRoot('room-screen');
    const { panel, body } = menuPanel(t('net.room_title'));
    this.body = body;
    this.list = el('div', '', 'net-list');
    this.invitation = el('div');
    body.append(el('p', t('net.host_intro'), 'menu-empty'), this.invitation, el('h2', t('net.players')), this.list,
      menuRow(menuButton(t('net.back_to_game'), () => actions.back()),
        menuButton(t('net.close_room'), () => actions.close(), 'danger')));
    this.root.appendChild(panel);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); actions.back(); }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.refresh();
    if (this.invitation.childElementCount === 0) void this.newInvite();
  }

  hide(): void {
    this.root.hidden = true;
  }

  destroy(): void {
    clearTimeout(this.waiting);
    this.root.remove();
  }

  /** A lista mudou: quem entrou tira o convite da tela. */
  refresh(): void {
    const players = this.actions.players();
    this.list.textContent = '';
    if (players.length === 0) this.list.append(el('p', t('net.nobody'), 'menu-empty'));
    for (const p of players) {
      this.list.append(menuRow(el('span', p.name), menuButton(t('net.kick'), () => this.actions.kick(p.netId), 'danger')));
    }
    if (players.length > this.known) {
      clearTimeout(this.waiting);
      this.showInviteButton();
    }
    this.known = players.length;
  }

  private showInviteButton(): void {
    this.invitation.textContent = '';
    if (this.actions.full()) {
      this.invitation.append(el('p', t('net.refused_full'), 'menu-empty'));
      return;
    }
    this.invitation.append(menuRow(menuButton(t('net.invite'), () => void this.newInvite(), 'primary')));
  }

  private async newInvite(): Promise<void> {
    this.invitation.textContent = '';
    const status = el('p', t('net.preparing'), 'menu-empty');
    this.invitation.append(status);
    let offer: Signal;
    try {
      offer = await this.actions.invite();
    } catch (e) {
      status.textContent = String(e);
      return;
    }
    status.remove();
    codeView(this.invitation, offer);
    this.invitation.append(el('p', t('net.read_answer')));
    codeReader(this.invitation, 'answer', t('net.connect'), (answer) => {
      this.invitation.textContent = '';
      this.invitation.append(el('p', t('net.connecting'), 'menu-empty'));
      this.actions.accept(answer).catch(() => this.failed());
      clearTimeout(this.waiting);
      this.waiting = setTimeout(() => this.failed(), 20000);
    });
    this.body.scrollTop = 0;
  }

  private failed(): void {
    this.invitation.textContent = '';
    this.invitation.append(el('p', t('net.failed'), 'net-error'));
    this.showInviteButtonBelow();
  }

  private showInviteButtonBelow(): void {
    this.invitation.append(menuRow(menuButton(t('net.invite'), () => void this.newInvite(), 'primary')));
  }
}

// --- convidado ---------------------------------------------------------------------

export interface JoinPanelActions {
  /** O código do anfitrião foi lido: devolve a resposta para mostrar. */
  answer(offer: Signal, name: string): Promise<Signal>;
  cancel(): void;
}

export class JoinPanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLParagraphElement;

  constructor(private readonly actions: JoinPanelActions) {
    injectStyle();
    this.root = menuRoot('join-screen');
    const { panel, body } = menuPanel(t('net.join_title'));
    this.body = body;
    this.status = el('p', '', 'net-error');
    this.root.appendChild(panel);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); actions.cancel(); }
    });
    this.first();
  }

  show(): void {
    this.root.hidden = false;
  }

  destroy(): void {
    this.root.remove();
  }

  /** Mensagem de fim (recusa, falha) e volta ao primeiro passo. */
  fail(text: string): void {
    this.first();
    this.status.textContent = text;
  }

  private first(): void {
    this.body.textContent = '';
    const name = textField(t('net.name'), playerName());
    name.input.maxLength = MAX_NAME;
    this.body.append(name.wrapper, el('p', t('net.join_intro'), 'menu-empty'));
    codeReader(this.body, 'offer', t('net.continue'), (offer) => {
      setPlayerName(name.input.value);
      void this.second(offer, playerName());
    });
    this.body.append(this.status, menuRow(menuButton(t('net.cancel'), () => this.actions.cancel())));
  }

  private async second(offer: Signal, name: string): Promise<void> {
    this.body.textContent = '';
    this.status.textContent = '';
    const preparing = el('p', t('net.preparing'), 'menu-empty');
    this.body.append(preparing);
    let answer: Signal;
    try {
      answer = await this.actions.answer(offer, name);
    } catch (e) {
      this.fail(String(e));
      return;
    }
    preparing.remove();
    this.body.append(el('p', t('net.show_answer')));
    codeView(this.body, answer);
    this.body.append(el('p', t('net.waiting'), 'menu-empty'), this.status,
      menuRow(menuButton(t('net.cancel'), () => this.actions.cancel())));
  }
}

/** A razão da recusa, em texto. */
export function refusalText(reason: number, detail: string): string {
  switch (reason) {
    case 1: return t('net.refused_version');
    case 2: return t('net.refused_full');
    case 3: return tf('net.refused_mods', detail === '' ? t('net.no_mods') : detail);
    case 5: return t('net.refused_kicked');
    default: return t('net.refused_closed');
  }
}
