/**
 * Armazenamento cheio (doc 11 §4, M23).
 *
 * O doc pede, para a gravação que falha com `QuotaExceededError`: *"pausar,
 * mostrar modal explicando e oferecer excluir mundos antigos"*. Até o M23 a
 * falha virava uma linha de HUD por 6 s e o jogo seguia sem salvar — o jogador
 * descobria horas depois, ao voltar e não achar a casa.
 *
 * A tela lista os **outros** mundos com o tamanho (o deste não: apagar o mundo
 * aberto não salva nada), apaga com confirmação e tenta gravar de novo. Quem
 * escolhe continuar sem salvar não é perguntado outra vez a cada autosave: a
 * partir dali a falha volta a ser a linha de HUD, até um save dar certo.
 */

import { t, tf } from '../../core/i18n';
import type { WorldMeta } from '../../save/db';
import { menuButton, menuPanel, menuRoot, menuRow } from './menu';
import { formatSize } from './worlds';

/** O que fazer com uma falha de gravação. */
export type SaveFailureAction = 'modal' | 'message' | 'none';

/**
 * A regra de quando abrir a tela, sem DOM (testável no Node).
 *
 * - falha que não é de espaço: a linha de HUD de sempre;
 * - de espaço com a tela já aberta: nada (o "tentar de novo" falhando é ela);
 * - de espaço depois de "continuar sem salvar": a linha de HUD;
 * - de espaço, primeira vez: a tela.
 */
export class QuotaGate {
  isOpen = false;
  private skipped = false;

  onFailure(quota: boolean): SaveFailureAction {
    if (!quota) return 'message';
    if (this.isOpen) return 'none';
    return this.skipped ? 'message' : 'modal';
  }

  opened(): void { this.isOpen = true; }

  /** Fechou sem resolver ("continuar sem salvar"). */
  skip(): void {
    this.isOpen = false;
    this.skipped = true;
  }

  /** Um save inteiro deu certo: a próxima falha de espaço volta a abrir a tela. */
  saved(): void {
    this.isOpen = false;
    this.skipped = false;
  }
}

export interface StorageFullDeps {
  /** Os mundos do aparelho; a tela tira o aberto da lista. */
  listWorlds: () => Promise<WorldMeta[]>;
  removeWorld: (id: string) => Promise<void>;
  /** `navigator.storage.estimate`, ou `null` sem a API. */
  estimate: () => Promise<{ usage: number; quota: number } | null>;
  /** Grava tudo de novo; `true` se gravou. */
  retry: () => Promise<boolean>;
  /** Para o mundo e solta o ponteiro. */
  pause: () => void;
  resume: () => void;
}

export class StorageFullScreen {
  readonly gate = new QuotaGate();
  private readonly root: HTMLDivElement;
  private readonly usage: HTMLParagraphElement;
  private readonly list: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly deps: StorageFullDeps;
  private readonly worldId: string;

  constructor(worldId: string, deps: StorageFullDeps) {
    this.worldId = worldId;
    this.deps = deps;
    this.root = menuRoot('storage-full');
    const { panel, body } = menuPanel(t('storefull.title'));
    const text = document.createElement('p');
    text.textContent = t('storefull.body');
    this.usage = document.createElement('p');
    const heading = document.createElement('h2');
    heading.textContent = t('storefull.others');
    this.list = document.createElement('div');
    this.status = document.createElement('p');
    this.status.setAttribute('role', 'status');
    this.retryButton = menuButton(t('storefull.retry'), () => { void this.retry(); }, 'primary');
    const later = menuButton(t('storefull.continue'), () => this.dismiss());
    /*
     * As ações vêm antes da lista: num T0 deitado (360 px de altura) a lista
     * empurrava os dois botões para fora da tela, atrás de uma rolagem que
     * ninguém procura num aviso.
     */
    body.append(text, this.usage, this.status, menuRow(this.retryButton, later), heading, this.list);
    this.root.appendChild(panel);
    injectStyle();
  }

  /** Decide e age sobre uma falha. Devolve true se a linha de HUD deve sair. */
  handleFailure(quota: boolean): boolean {
    const action = this.gate.onFailure(quota);
    if (action === 'modal') void this.open();
    return action === 'message';
  }

  private async open(): Promise<void> {
    this.gate.opened();
    this.deps.pause();
    this.status.textContent = '';
    this.root.hidden = false;
    this.retryButton.focus();
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const estimate = await this.deps.estimate();
    this.usage.textContent = estimate === null || estimate.quota <= 0
      ? ''
      : tf('storefull.usage', formatSize(estimate.usage), formatSize(estimate.quota));
    const others = (await this.deps.listWorlds()).filter((w) => w.id !== this.worldId);
    this.list.replaceChildren();
    if (others.length === 0) {
      const none = document.createElement('p');
      none.textContent = t('storefull.none_other');
      this.list.appendChild(none);
      return;
    }
    others.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
    for (const world of others) {
      const label = document.createElement('span');
      label.textContent = `${world.name} · ${formatSize(world.sizeBytes ?? 0)}`;
      const remove = menuButton(t('storefull.delete'), () => { void this.remove(world); }, 'danger');
      this.list.appendChild(menuRow(label, remove));
    }
  }

  private async remove(world: WorldMeta): Promise<void> {
    // Irreversível, como na tela de mundos: pede confirmação.
    if (!confirm(tf('worlds.confirm_delete', world.name))) return;
    await this.deps.removeWorld(world.id);
    await this.refresh();
  }

  private async retry(): Promise<void> {
    this.status.textContent = t('storefull.saving');
    if (await this.deps.retry()) {
      this.gate.saved();
      this.close();
    } else {
      this.status.textContent = t('storefull.still_full');
    }
  }

  private dismiss(): void {
    this.gate.skip();
    this.close();
  }

  private close(): void {
    this.root.hidden = true;
    this.deps.resume();
  }
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#storage-full p{margin:0;font-size:13px;line-height:1.4}
#storage-full p:empty{display:none}
#storage-full .menu-row span{flex:1 1 auto;align-self:center}
#storage-full .menu-row button.danger{flex:0 0 auto}`;
  document.head.appendChild(css);
}
