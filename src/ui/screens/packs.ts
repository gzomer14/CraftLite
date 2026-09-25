/**
 * Tela do pacote de texturas (doc 13 §7).
 *
 * Chega do título, e não das opções, por um motivo concreto: aplicar um pacote
 * recarrega a página, e das opções se chega **de dentro do jogo**, pelo menu de
 * pausa. Recarregar ali custaria o que o jogador fez desde o último autosave.
 *
 * A troca não é automática: importar guarda o pacote no banco e mostra quantas
 * imagens entraram; **quem aperta "recarregar" é o jogador**. Assim ele lê o
 * resultado antes de a tela sumir, e um zip com 3 imagens reconhecidas de 300
 * não vira uma surpresa depois do boot.
 */

import { menuButton, menuPanel, menuRoot, menuRow, messageOf } from './menu';
import { t, tf } from '../../core/i18n';

/** "12 imagens e 3 sons", ou só a metade que existe. */
function describeContents(summary: PackSummary): string {
  const images = tf(summary.accepted === 1 ? 'packs.image' : 'packs.images', summary.accepted);
  const count = summary.sounds ?? 0;
  if (count === 0) return images;
  const sounds = tf(count === 1 ? 'packs.sound' : 'packs.sounds', count);
  return summary.accepted === 0 ? sounds : tf('packs.and', images, sounds);
}

/** Resumo de uma importação, para a tela contar ao jogador. */
export interface PackSummary {
  name: string;
  accepted: number;
  ignored: number;
  /** Amostras de som aceitas. Zero no pacote que só traz arte. */
  sounds?: number;
}

export interface PacksCallbacks {
  /** O pacote instalado, ou `null`. */
  current: () => Promise<PackSummary | null>;
  install: (file: File) => Promise<PackSummary>;
  remove: () => Promise<void>;
  /** Recarrega a página para o pacote entrar. */
  apply: () => void;
  back: () => void;
}

export class PacksScreen {
  private readonly root: HTMLDivElement;
  private readonly current: HTMLParagraphElement;
  private readonly status: HTMLParagraphElement;
  private readonly fileInput: HTMLInputElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly applyButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly callbacks: PacksCallbacks;

  constructor(callbacks: PacksCallbacks) {
    this.callbacks = callbacks;
    this.root = menuRoot('packs-screen');
    const { panel, body } = menuPanel(t('packs.title'));

    const intro = document.createElement('p');
    intro.className = 'menu-empty';
    intro.textContent = t('packs.intro');

    this.current = document.createElement('p');
    this.current.className = 'menu-empty';

    this.status = document.createElement('p');
    this.status.className = 'menu-empty';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');

    /*
     * Mesmo arranjo da tela de mundos: o `<input type="file">` fica escondido
     * atrás de um botão, porque o seletor nativo é o único jeito de ler arquivo
     * do disco sem permissão — e é feio em toda plataforma.
     */
    const choose = menuButton(t('packs.choose'), () => this.fileInput.click(), 'primary');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.zip';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.installPicked());

    this.removeButton = menuButton(t('packs.remove'), () => void this.removePack(), 'danger');
    this.applyButton = menuButton(t('packs.apply'), () => this.callbacks.apply());
    this.applyButton.hidden = true;
    this.backButton = menuButton(t('opt.back'), () => this.callbacks.back());

    body.append(
      intro, this.current, this.status,
      menuRow(choose, this.removeButton),
      menuRow(this.applyButton, this.backButton),
      this.fileInput,
    );
    this.root.appendChild(panel);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.callbacks.back(); }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async show(): Promise<void> {
    this.root.hidden = false;
    this.status.hidden = true;
    this.applyButton.hidden = true;
    this.backButton.focus();
    await this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private async refresh(): Promise<void> {
    let pack: PackSummary | null = null;
    try {
      pack = await this.callbacks.current();
    } catch {
      // Sem banco ou banco quebrado: a tela continua servindo para importar.
    }
    this.current.textContent = pack === null
      ? t('packs.none')
      : tf('packs.current', pack.name, describeContents(pack));
    this.removeButton.hidden = pack === null;
  }

  private async installPicked(): Promise<void> {
    const file = this.fileInput.files?.[0];
    // Limpa já: sem isso, escolher o mesmo arquivo duas vezes não dispara nada.
    this.fileInput.value = '';
    if (file === undefined) return;

    this.setStatus(t('packs.reading'));
    try {
      const summary = await this.callbacks.install(file);
      const ignored = summary.ignored > 0
        ? tf('packs.ignored', summary.ignored)
        : '';
      this.setStatus(tf('packs.accepted', describeContents(summary), ignored));
      this.applyButton.hidden = false;
      this.applyButton.focus();
      await this.refresh();
    } catch (error) {
      this.setStatus(messageOf(error, t('packs.read_failed')));
    }
  }

  private async removePack(): Promise<void> {
    this.setStatus(t('packs.removing'));
    try {
      await this.callbacks.remove();
      this.setStatus(t('packs.removed'));
      this.applyButton.hidden = false;
      await this.refresh();
    } catch (error) {
      this.setStatus(messageOf(error, t('packs.remove_failed')));
    }
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = false;
  }
}
