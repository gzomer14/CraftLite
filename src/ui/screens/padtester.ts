/**
 * Teste de controle ao vivo, em Opções → Controle (doc 09 §3.1).
 *
 * Nasceu de um relato que o código não explicava: num DualSense por Bluetooth,
 * `L1` e `R1` não trocavam o item da mão, enquanto todo o resto do controle
 * funcionava. Os dois estão nos índices 4 e 5 do layout padrão, o caminho
 * inteiro tem teste, e mesmo assim o jogador não via nada acontecer — o que
 * sobra é a hipótese de que **o aparelho não manda o que a especificação diz
 * que ele manda**, e isso não se descobre adivinhando.
 *
 * O painel lê `navigator.getGamepads()` **cru**: nenhum perfil, nenhum
 * remapeamento, nenhuma zona morta. É de propósito — um diagnóstico que passa
 * pela camada que se quer diagnosticar não diagnostica nada. Ele também não
 * toca em `Gamepads`, então não rouba borda de subida de ninguém.
 *
 * O "último aperto" fica na tela depois de soltar: apertar um botão e ler a
 * linha ao mesmo tempo é difícil, e num controle sem fio o jogador costuma
 * estar longe do monitor.
 */

import { STANDARD_BUTTONS, profileFor, type PadButton } from '../../data/gamepads';

/** Quantas vezes por segundo o painel se atualiza. Só roda com a tela aberta. */
const HZ = 15;

/** Nome do botão por índice, no layout que este aparelho estiver usando. */
function namesFor(pad: Gamepad): Map<number, PadButton> {
  const out = new Map<number, PadButton>();
  const raw = pad.mapping === 'standard' ? undefined : profileFor(pad.id).rawButtons;
  const table = raw ?? STANDARD_BUTTONS;
  for (const [name, index] of Object.entries(table)) {
    if (typeof index === 'number') out.set(index, name as PadButton);
  }
  return out;
}

export class PadTester {
  readonly element: HTMLDivElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Índice e nome do último botão que foi apertado, para não sumir ao soltar. */
  private lastPress = '';

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'pad-tester';
    this.element.hidden = true;
    injectStyle();
  }

  /** Começa a ler o controle. Chamado quando a tela de opções abre. */
  start(): void {
    if (this.timer !== null) return;
    this.lastPress = '';
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 1000 / HZ);
  }

  /** Para de ler. Sem isto o painel continuaria acordando a aba fechada. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Monta o texto do painel. Exportado como método para o teste poder chamar
   * sem um relógio no meio.
   */
  refresh(): void {
    const pad = firstConnected();
    if (pad === null) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;

    const names = namesFor(pad);
    const pressed: string[] = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      const button = pad.buttons[i];
      if (button === undefined) continue;
      if (!button.pressed && button.value <= 0.35) continue;
      const name = names.get(i);
      pressed.push(name === undefined ? String(i) : `${i} (${name})`);
    }
    if (pressed.length > 0) this.lastPress = pressed.join(', ');

    const axes: string[] = [];
    for (let i = 0; i < pad.axes.length; i++) axes.push((pad.axes[i] ?? 0).toFixed(2));

    const layout = pad.mapping === 'standard'
      ? 'layout normalizado pelo navegador'
      : 'layout NÃO normalizado — os índices vêm da família';

    this.element.textContent =
      `${layout} · ${pad.buttons.length} botões · ${pad.axes.length} eixos\n`
      + `apertado agora: ${pressed.length > 0 ? pressed.join(', ') : '—'}\n`
      + `último aperto: ${this.lastPress === '' ? '—' : this.lastPress}\n`
      + `eixos: ${axes.join('  ')}`;
  }
}

/** O primeiro controle conectado, ou `null`. Cópia local, de propósito: cru. */
function firstConnected(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (pad !== null && pad.connected) return pad;
  }
  return null;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
.pad-tester{white-space:pre-wrap;font:calc(3.5 * var(--px, 3px))/1.5 ui-monospace,
  "Courier New",monospace;background:#0006;padding:calc(2 * var(--px));
  border:1px solid #ffffff26;margin-top:calc(2 * var(--px))}
`;
  document.head.appendChild(css);
}
