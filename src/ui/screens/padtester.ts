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
/** Quanto um eixo precisa andar para contar como "mexeu". */
const AXIS_MOVE = 0.4;

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
  /** Último eixo que saiu do lugar, e para quanto. */
  private lastAxis = '';
  /** Leitura anterior dos eixos, para saber qual mexeu. */
  private readonly lastAxes: number[] = [];
  /**
   * Última tecla que **a página** recebeu.
   *
   * Num Android, o sistema entrega os botões do controle como tecla, e o
   * navegador fica com alguns antes de a página ver: no Chrome, `L1` e `R1`
   * trocam de aba. É por isso que eles não aparecem como botão nenhum aqui — e
   * esta linha é o que separa "a página recebeu e ignorou" de "a página nunca
   * viu". Sem ela, os dois casos são indistinguíveis de dentro do jogo.
   */
  private lastKey = '';

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
    this.lastAxis = '';
    this.lastKey = '';
    this.lastAxes.length = 0;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 1000 / HZ);
    // `capture` para ver a tecla antes de qualquer tela que a trate.
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey, true);
    }
  }

  /** Para de ler. Sem isto o painel continuaria acordando a aba fechada. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey, true);
    }
  }

  /** Anota a tecla como ela chega, sem interpretar nada. */
  private readonly onKey = (e: KeyboardEvent): void => {
    const code = e.code === '' ? '—' : e.code;
    this.lastKey = `${e.key} · code ${code} · keyCode ${e.keyCode}`;
  };

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
      const label = signalOf(pad.buttons[i], i, names.get(i));
      if (label !== null) pressed.push(label);
    }
    if (pressed.length > 0) this.lastPress = pressed.join(', ');

    /*
     * O eixo que mexeu por último.
     *
     * É a linha que existe por causa de um sintoma sem explicação: `L1` e `R1`
     * de um DualSense não aparecem como botão nenhum, enquanto o resto do
     * controle aparece. Se eles estiverem chegando como **eixo** — um chapéu,
     * ou um controle que reporta ombro analógico —, é aqui que isso fica
     * visível. Sem esta linha, um eixo que muda some no meio de uma fileira de
     * números.
     */
    const axes: string[] = [];
    for (let i = 0; i < pad.axes.length; i++) {
      const value = pad.axes[i] ?? 0;
      axes.push(value.toFixed(2));
      const before = this.lastAxes[i];
      if (before !== undefined && Math.abs(value - before) > AXIS_MOVE) {
        this.lastAxis = `${i} → ${value.toFixed(2)}`;
      }
      this.lastAxes[i] = value;
    }

    const layout = pad.mapping === 'standard'
      ? 'layout normalizado pelo navegador'
      : 'layout NÃO normalizado — os índices vêm da família';

    this.element.textContent =
      `${pad.id}\n`
      + `${layout} · ${pad.buttons.length} botões · ${pad.axes.length} eixos\n`
      + `apertado agora: ${pressed.length > 0 ? pressed.join(', ') : '—'}\n`
      + `último aperto: ${this.lastPress === '' ? '—' : this.lastPress}\n`
      + `último eixo que mexeu: ${this.lastAxis === '' ? '—' : this.lastAxis}\n`
      + `última tecla na página: ${this.lastKey === '' ? '—' : this.lastKey}\n`
      + `eixos: ${axes.join('  ')}`;
  }
}

/**
 * O que este botão está mandando agora, ou `null` se não está mandando nada.
 *
 * Os três sinais aparecem separados de propósito. `pressed` é o caminho comum;
 * `value` sozinho é gatilho analógico ou botão que o driver reporta em meio
 * curso; `touched` sem `pressed` é o que alguns drivers fazem com botões que o
 * navegador não sabe classificar — e era um sinal que o painel **engolia**.
 */
function signalOf(
  button: GamepadButton | undefined, index: number, name: PadButton | undefined,
): string | null {
  if (button === undefined) return null;
  const who = name === undefined ? String(index) : `${index} (${name})`;
  if (button.pressed) return who;
  if (button.value > 0) return `${who} ${button.value.toFixed(2)}`;
  if (button.touched) return `${who} toque`;
  return null;
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
