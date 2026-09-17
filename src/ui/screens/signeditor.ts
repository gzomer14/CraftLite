/**
 * Editor de texto da placa (doc 14 — M8).
 *
 * Quatro campos, um por linha, com o mesmo painel das outras telas de menu.
 *
 * **Por que `<input>` de verdade e não um teclado desenhado.** No celular, o
 * teclado virtual é do sistema — ele sabe acento, corretor, idioma e teclado de
 * uma mão, e nada disso se reimplementa em canvas. A regra de nunca deixar o
 * teclado subir sozinho (correção de campo de 2026-09-14) continua valendo e
 * não briga com isto: aqui o jogador **pediu** para escrever, e é o único lugar
 * do jogo em que o foco num campo de texto é o que ele quer.
 *
 * Para quem joga de controle, os quatro campos entram na travessia de foco como
 * qualquer botão; digitar exige teclado, que é a mesma limitação do nome do
 * mundo na tela de criação.
 */

import { SIGN_COLUMNS, SIGN_LINES, sanitizeSignLine } from '../../game/signs';
import { menuButton, menuPanel, menuRoot, menuRow, textField } from './menu';

export interface SignEditorCallbacks {
  /** Texto confirmado. A posição é a mesma que veio em `open`. */
  onDone: (x: number, y: number, z: number, lines: readonly string[]) => void;
  /** Chamado ao fechar, com ou sem confirmação — devolve o jogo ao jogador. */
  onClose: () => void;
}

export class SignEditor {
  private readonly root: HTMLDivElement;
  private readonly inputs: HTMLInputElement[] = [];
  private readonly callbacks: SignEditorCallbacks;

  private x = 0;
  private y = 0;
  private z = 0;
  private open_ = false;

  constructor(callbacks: SignEditorCallbacks) {
    this.callbacks = callbacks;
    this.root = menuRoot('sign-editor');
    const { panel, body } = menuPanel('Escrever na Placa');

    for (let line = 0; line < SIGN_LINES; line++) {
      const field = textField(`Linha ${line + 1}`, '');
      field.input.maxLength = SIGN_COLUMNS;
      field.input.autocomplete = 'off';
      field.input.spellcheck = false;
      // Enter desce uma linha; na última, confirma. É o gesto que quem escreve
      // espera, e evita ter de achar o botão com o teclado aberto por cima.
      field.input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (line + 1 < SIGN_LINES) this.inputs[line + 1].focus();
        else this.confirm();
      });
      this.inputs.push(field.input);
      body.append(field.wrapper);
    }

    const hint = document.createElement('p');
    hint.className = 'menu-hint';
    hint.textContent = `Até ${SIGN_COLUMNS} caracteres por linha, em maiúsculas.`;
    body.append(hint);

    body.append(menuRow(
      menuButton('Pronto', () => this.confirm(), 'primary'),
      menuButton('Cancelar', () => this.close()),
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
    for (let i = 0; i < SIGN_LINES; i++) this.inputs[i].value = lines[i] ?? '';
    this.open_ = true;
    this.root.hidden = false;
    this.inputs[0].focus();
    this.inputs[0].select();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  private confirm(): void {
    const lines = this.inputs.map((input) => sanitizeSignLine(input.value));
    this.callbacks.onDone(this.x, this.y, this.z, lines);
    this.close();
  }
}
