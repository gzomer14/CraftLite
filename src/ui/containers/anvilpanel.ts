/**
 * O miolo da tela da bigorna (M15): o campo do nome e a frase do que fazer.
 *
 * Os três slots (Item, Material, Resultado) são slots comuns da grade de
 * `screen.ts`, com rótulo embaixo; aqui fica só o que a grade não sabe
 * desenhar. Módulo à parte, como a troca do aldeão (`tradepanel.ts`): a tela
 * de contêiner já é grande.
 *
 * Até 2026-09-24 a linha de baixo só mostrava o custo, e vazia quando não
 * havia resultado — o jogador não sabia o que faltava (relato de campo). A
 * frase agora vem de `game/stationhelp.ts` e diz o próximo passo.
 */

import { t } from '../../core/i18n';
import { MAX_NAME_LENGTH } from '../../data/anvil';

/** O estado da bigorna que o painel mostra. */
export interface AnvilStatus {
  /** A frase do próximo passo, ou o custo quando há resultado. */
  help: string;
  /** true se há resultado mas ele não pode sair (nível, caro demais). */
  blocked: boolean;
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
  private readonly help: HTMLDivElement;
  /** O campo foi editado desde a abertura: não sobrescrever com o nome atual. */
  private edited = false;

  constructor(callbacks: AnvilPanelCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'section anvil';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.maxLength = MAX_NAME_LENGTH;
    this.input.placeholder = 'opcional';
    this.input.id = 'anvil-name';
    // A tecla digitada no campo não pode andar, abrir a mochila nem fechar a tela.
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    this.input.addEventListener('input', () => {
      this.edited = true;
      callbacks.onName(this.input.value);
    });
    const label = document.createElement('label');
    label.className = 'station-note';
    label.htmlFor = 'anvil-name';
    label.textContent = t('anvil.new_name');
    this.help = document.createElement('div');
    this.help.className = 'station-help';
    this.help.setAttribute('role', 'status');
    this.element.append(this.help, label, this.input);
  }

  /** Nova abertura: o campo volta a acompanhar a peça. */
  reset(): void {
    this.edited = false;
    this.input.value = '';
  }

  refresh(status: AnvilStatus): void {
    this.input.disabled = !status.nameable;
    if (!this.edited && document.activeElement !== this.input) this.input.value = status.currentName;
    this.help.textContent = status.help;
    this.help.classList.toggle('blocked', status.blocked);
  }
}
