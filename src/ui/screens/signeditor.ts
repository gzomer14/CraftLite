/**
 * Editor de texto da placa (doc 14 — M8).
 *
 * **Um campo só, e não quatro.** A primeira versão tinha um campo por linha, e
 * isso obriga quem escreve a pensar em linhas antes de pensar na frase —
 * relato de campo: *"essa divisão por linhas também ficou horrorosa para
 * digitar na placa"*. Agora é um `<textarea>`: escreve-se corrido, `Enter`
 * quebra onde o jogador quiser, e `wrapSignText` distribui o resto pelas quatro
 * linhas da placa.
 *
 * **Com pré-visualização, e não com o campo sendo reescrito.** Reescrever o
 * texto digitado para a forma quebrada exigiria devolver o cursor ao lugar
 * certo a cada tecla, e a quebra por palavra come o espaço do ponto de quebra —
 * o cursor pularia. Em vez disso o campo guarda o que foi digitado e, embaixo,
 * quatro linhas mostram **exatamente** o que a placa vai dizer, na mesma
 * largura de 15 colunas. Quem vê a prévia não precisa adivinhar a regra.
 *
 * **Por que `<textarea>` de verdade e não um teclado desenhado.** No celular, o
 * teclado virtual é do sistema — ele sabe acento, corretor, idioma e teclado de
 * uma mão, e nada disso se reimplementa em canvas. A regra de nunca deixar o
 * teclado subir sozinho (correção de campo de 2026-09-14) continua valendo e
 * não briga com isto: aqui o jogador **pediu** para escrever.
 */

import {
  SIGN_COLUMNS, SIGN_LINES, signTextToInput, wrapSignText,
} from '../../game/signs';
import { menuButton, menuPanel, menuRoot, menuRow } from './menu';
import { t, tf } from '../../core/i18n';

/** Teto do que se aceita digitar: quatro linhas cheias, com folga para espaços. */
const MAX_INPUT = SIGN_LINES * SIGN_COLUMNS * 2;

export interface SignEditorCallbacks {
  /** Texto confirmado, já quebrado nas quatro linhas da placa. */
  onDone: (x: number, y: number, z: number, lines: readonly string[]) => void;
  /** Chamado ao fechar, com ou sem confirmação — devolve o jogo ao jogador. */
  onClose: () => void;
}

export class SignEditor {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly preview: HTMLDivElement;
  private readonly previewLines: HTMLSpanElement[] = [];
  private readonly overflow: HTMLParagraphElement;
  private readonly callbacks: SignEditorCallbacks;

  private x = 0;
  private y = 0;
  private z = 0;
  private open_ = false;

  constructor(callbacks: SignEditorCallbacks) {
    this.callbacks = callbacks;
    injectStyle();
    this.root = menuRoot('sign-editor');
    const { panel, body } = menuPanel(t('sign.title'));

    this.input = document.createElement('textarea');
    this.input.className = 'sign-input';
    this.input.rows = SIGN_LINES;
    this.input.maxLength = MAX_INPUT;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', t('sign.aria'));
    this.input.addEventListener('input', () => this.refresh());
    // Ctrl+Enter confirma: `Enter` sozinho é quebra de linha, que é o ponto
    // de ter um campo só.
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.confirm();
      }
    });

    this.preview = document.createElement('div');
    this.preview.className = 'sign-preview';
    this.preview.setAttribute('aria-live', 'polite');
    for (let line = 0; line < SIGN_LINES; line++) {
      const span = document.createElement('span');
      this.previewLines.push(span);
      this.preview.append(span);
    }

    const hint = document.createElement('p');
    hint.className = 'menu-hint';
    hint.textContent = tf('sign.hint', SIGN_LINES, SIGN_COLUMNS);

    this.overflow = document.createElement('p');
    this.overflow.className = 'menu-hint sign-overflow';
    this.overflow.hidden = true;
    this.overflow.textContent = t('sign.overflow');

    body.append(this.input, hint, this.preview, this.overflow);
    body.append(menuRow(
      menuButton(t('common.done'), () => this.confirm(), 'primary'),
      menuButton(t('common.cancel'), () => this.close()),
    ));

    this.root.append(panel);
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Abre o editor de uma placa, já com o que estiver escrito nela. */
  open(x: number, y: number, z: number, lines: readonly string[]): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.input.value = signTextToInput(lines);
    this.refresh();
    this.open_ = true;
    this.root.hidden = false;
    this.input.focus();
    // Cursor no fim: reabrir uma placa escrita é quase sempre para acrescentar.
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  /** As quatro linhas como a placa vai escrevê-las. Exposto para teste. */
  get lines(): readonly string[] {
    return wrapSignText(this.input.value);
  }

  /** Redesenha a prévia a partir do que está digitado. */
  private refresh(): void {
    const lines = wrapSignText(this.input.value);
    for (let i = 0; i < SIGN_LINES; i++) {
      // Espaço fino no lugar da linha vazia, senão ela some do layout.
      this.previewLines[i].textContent = lines[i].length > 0 ? lines[i] : ' ';
    }
    // Sobrou texto? Comparar o que entra com o que sai é a forma honesta de
    // saber: `wrapSignText` já descartou o excesso.
    const kept = lines.join('').replace(/\s/g, '').length;
    const typed = this.input.value.replace(/\s/g, '').length;
    this.overflow.hidden = typed <= kept;
  }

  private confirm(): void {
    this.callbacks.onDone(this.x, this.y, this.z, wrapSignText(this.input.value));
    this.close();
  }
}

let styled = false;

function injectStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  /*
   * A prévia usa a mesma largura de 15 colunas da placa, em monoespaçada: é o
   * que faz o jogador ver a quebra acontecer onde ela vai acontecer de verdade.
   * A cor imita a tábua e a tinta (`data/textures.ts` e `render/signtext.ts`).
   */
  style.textContent = `
.sign-input{width:100%;min-height:96px;resize:none;background:#0e141b;color:#fff;
  border:2px solid #000;padding:8px;font:14px/1.4 ui-monospace,monospace;
  text-transform:uppercase}
.sign-preview{display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:10px 6px;background:#c4aa76;border:2px solid #846a3e;
  font:16px/1.25 ui-monospace,monospace;color:#22170d;letter-spacing:1px;
  white-space:pre;overflow-x:auto}
.sign-overflow{color:#f2c14e}`;
  document.head.appendChild(style);
}
