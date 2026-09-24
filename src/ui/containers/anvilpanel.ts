/**
 * O miolo da tela da bigorna (M15): o campo do nome e o custo.
 *
 * Os três slots (peça, material, resultado) são slots comuns da grade de
 * `screen.ts`; aqui fica só o que a grade não sabe desenhar. Módulo à parte,
 * como a troca do aldeão (`tradepanel.ts`): a tela de contêiner já é grande.
 */

import { MAX_NAME_LENGTH } from '../../data/anvil';

/** O estado da bigorna que o painel mostra. */
export interface AnvilStatus {
  /** Níveis que o resultado custa; 0 sem resultado. */
  cost: number;
  blocker: 'ok' | 'nothing' | 'expensive' | 'no-level';
  /** Nome atual da peça da esquerda, para o campo começar com ele. */
  currentName: string;
  /** true se a peça aceita nome (item que não empilha). */
  nameable: boolean;
}

export interface AnvilPanelCallbacks {
  /** O jogador mexeu no nome. */
  onName(name: string): void;
}

export class AnvilPanel {
  readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly cost: HTMLDivElement;
  /** O campo foi editado desde a abertura: não sobrescrever com o nome atual. */
  private edited = false;

  constructor(callbacks: AnvilPanelCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'section anvil';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.maxLength = MAX_NAME_LENGTH;
    this.input.placeholder = 'Nome';
    this.input.setAttribute('aria-label', 'Nome do item');
    // A tecla digitada no campo não pode andar, abrir a mochila nem fechar a tela.
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    this.input.addEventListener('input', () => {
      this.edited = true;
      callbacks.onName(this.input.value);
    });
    this.cost = document.createElement('div');
    this.cost.className = 'anvil-cost';
    this.element.append(this.input, this.cost);
  }

  /** Nova abertura: o campo volta a acompanhar a peça. */
  reset(): void {
    this.edited = false;
    this.input.value = '';
  }

  refresh(status: AnvilStatus): void {
    this.input.disabled = !status.nameable;
    if (!this.edited && document.activeElement !== this.input) this.input.value = status.currentName;
    const messages: Record<AnvilStatus['blocker'], string> = {
      ok: `Custo: ${status.cost} ${status.cost === 1 ? 'nível' : 'níveis'}`,
      nothing: '',
      expensive: 'Caro demais!',
      'no-level': `Custo: ${status.cost} níveis — faltam níveis`,
    };
    this.cost.textContent = messages[status.blocker];
    this.cost.classList.toggle('blocked', status.blocker === 'expensive' || status.blocker === 'no-level');
  }
}
