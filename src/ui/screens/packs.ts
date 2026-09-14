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

/** "12 imagens e 3 sons", ou só a metade que existe. */
function describeContents(summary: PackSummary): string {
  const images = `${summary.accepted} ${summary.accepted === 1 ? 'imagem' : 'imagens'}`;
  const count = summary.sounds ?? 0;
  if (count === 0) return images;
  const sounds = `${count} ${count === 1 ? 'som' : 'sons'}`;
  return summary.accepted === 0 ? sounds : `${images} e ${sounds}`;
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
    const { panel, body } = menuPanel('Pacote de texturas');

    const intro = document.createElement('p');
    intro.className = 'menu-empty';
    intro.textContent = 'O jogo desenha tudo por código. Um pacote troca essa arte '
      + 'pela sua: um .zip com PNGs em block/, item/ e entity/ — por exemplo '
      + 'block/stone.png, item/diamond.png, entity/zombie.png. Os nomes são os '
      + 'internos, em inglês, e o que não bater é ignorado. O arquivo fica só '
      + 'neste aparelho: nada é enviado para lugar nenhum.';

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
    const choose = menuButton('Escolher .zip', () => this.fileInput.click(), 'primary');
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.zip';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.installPicked());

    this.removeButton = menuButton('Remover', () => void this.removePack(), 'danger');
    this.applyButton = menuButton('Recarregar para aplicar', () => this.callbacks.apply());
    this.applyButton.hidden = true;
    this.backButton = menuButton('Voltar', () => this.callbacks.back());

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
      ? 'Nenhum pacote — o jogo está usando a arte que ele mesmo gera.'
      : `Pacote atual: "${pack.name}", ${describeContents(pack)}.`;
    this.removeButton.hidden = pack === null;
  }

  private async installPicked(): Promise<void> {
    const file = this.fileInput.files?.[0];
    // Limpa já: sem isso, escolher o mesmo arquivo duas vezes não dispara nada.
    this.fileInput.value = '';
    if (file === undefined) return;

    this.setStatus('Lendo o pacote…');
    try {
      const summary = await this.callbacks.install(file);
      const ignored = summary.ignored > 0
        ? ` ${summary.ignored} ignoradas (nome sem correspondente no jogo).`
        : '';
      this.setStatus(`${describeContents(summary)} aceitos.${ignored}`);
      this.applyButton.hidden = false;
      this.applyButton.focus();
      await this.refresh();
    } catch (error) {
      this.setStatus(messageOf(error, 'Não deu para ler o pacote.'));
    }
  }

  private async removePack(): Promise<void> {
    this.setStatus('Removendo…');
    try {
      await this.callbacks.remove();
      this.setStatus('Pacote removido.');
      this.applyButton.hidden = false;
      await this.refresh();
    } catch (error) {
      this.setStatus(messageOf(error, 'Não deu para remover.'));
    }
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = false;
  }
}
