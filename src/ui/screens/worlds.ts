/**
 * Seleção e criação de mundos (doc 08 §3.2–§3.3).
 *
 * É a tela que dá sentido ao save: sem ela, o jogo abria sempre no mesmo mundo
 * vindo da URL e não havia como voltar para o de ontem.
 *
 * A criação segue o doc: nome, seed digitada (texto vira número por hash, então
 * "oi" é uma seed válida), modo e dificuldade. Apagar pede confirmação porque é
 * a única ação irreversível do jogo inteiro.
 */

import { menuButton, menuPanel, menuRoot, menuRow, messageOf, textField } from './menu';
import type { WorldMeta } from '../../save/db';

export interface WorldsCallbacks {
  /** Lista os mundos salvos, mais recente primeiro. */
  list: () => Promise<WorldMeta[]>;
  play: (meta: WorldMeta) => void;
  create: (
    name: string, seed: string, mode: 'survival' | 'creative', difficulty: 0 | 1 | 2 | 3,
  ) => Promise<WorldMeta>;
  remove: (meta: WorldMeta) => Promise<void>;
  /** Empacota o mundo num arquivo para o jogador guardar (M7). */
  exportWorld?: (meta: WorldMeta) => Promise<void>;
  /** Lê um arquivo e cria o mundo a partir dele; devolve o nome importado. */
  importWorld?: (file: File) => Promise<string>;
  /** Miniatura do mundo em PNG, ou `undefined` se ele ainda não tem uma. */
  thumbnail?: (worldId: string) => Promise<Uint8Array | undefined>;
  back: () => void;
}

export class WorldsScreen {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly status: HTMLParagraphElement;
  private readonly createForm: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly difficultySelect: HTMLSelectElement;
  private readonly callbacks: WorldsCallbacks;

  private worlds: WorldMeta[] = [];
  private selected: string | null = null;

  constructor(callbacks: WorldsCallbacks) {
    this.callbacks = callbacks;
    this.root = menuRoot('worlds-screen');
    const { panel, body } = menuPanel('Seus mundos');

    this.list = document.createElement('div');
    this.list.className = 'menu-list';
    this.list.setAttribute('role', 'listbox');

    this.playButton = menuButton('Jogar', () => this.playSelected(), 'primary');
    this.deleteButton = menuButton('Apagar', () => void this.deleteSelected(), 'danger');
    const newButton = menuButton('Criar novo', () => this.toggleCreate(true));
    const back = menuButton('Voltar', () => this.callbacks.back());

    /*
     * Levar mundo daqui para lá (M7).
     *
     * O `<input type="file">` fica escondido e é acionado pelo botão: o
     * seletor nativo do navegador é a única forma de ler arquivo do disco sem
     * pedir permissão, e o dele é feio em toda plataforma.
     */
    this.exportButton = menuButton('Exportar', () => void this.exportSelected());
    const importButton = menuButton('Importar', () => this.fileInput.click());
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.clw';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.importPicked());

    this.status = document.createElement('p');
    this.status.className = 'menu-empty';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');

    this.createForm = document.createElement('div');
    this.createForm.className = 'menu-section';
    this.createForm.hidden = true;

    const name = textField('Nome', '', 'Novo Mundo');
    const seed = textField('Seed', '', 'deixe vazio para sortear');
    this.nameInput = name.input;
    this.seedInput = seed.input;

    this.modeSelect = select([
      { value: 'survival', label: 'Sobrevivência' },
      { value: 'creative', label: 'Criativo' },
    ]);
    this.difficultySelect = select([
      { value: '0', label: 'Pacífico' },
      { value: '1', label: 'Fácil' },
      { value: '2', label: 'Normal' },
      { value: '3', label: 'Difícil' },
    ]);
    this.difficultySelect.value = '2';

    this.createForm.append(
      name.wrapper,
      seed.wrapper,
      labelled('Modo', this.modeSelect),
      labelled('Dificuldade', this.difficultySelect),
      menuRow(
        menuButton('Criar e jogar', () => void this.createWorld(), 'primary'),
        menuButton('Cancelar', () => this.toggleCreate(false)),
      ),
    );

    body.append(
      this.list,
      menuRow(this.playButton, newButton),
      menuRow(this.deleteButton, back),
      menuRow(this.exportButton, importButton),
      this.status,
      this.fileInput,
      this.createForm,
    );
    this.root.appendChild(panel);
    this.updateButtons();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Abre a tela e recarrega a lista do banco. */
  async show(): Promise<void> {
    this.root.hidden = false;
    this.toggleCreate(false);
    await this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
  }

  async refresh(): Promise<void> {
    try {
      this.worlds = await this.callbacks.list();
    } catch {
      this.worlds = [];
    }
    this.worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
    if (this.worlds.every((w) => w.id !== this.selected)) {
      this.selected = this.worlds.length > 0 ? this.worlds[0].id : null;
    }
    this.renderList();
  }

  private renderList(): void {
    this.list.textContent = '';
    for (const url of this.thumbUrls) URL.revokeObjectURL(url);
    this.thumbUrls.length = 0;
    if (this.worlds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'menu-empty';
      empty.textContent = 'Nenhum mundo ainda. Crie o primeiro.';
      this.list.appendChild(empty);
      this.updateButtons();
      return;
    }

    for (const world of this.worlds) {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'entry';
      entry.setAttribute('role', 'option');
      entry.setAttribute('aria-selected', String(world.id === this.selected));
      if (world.id === this.selected) entry.classList.add('selected');

      /*
       * Miniatura (doc 08 §3.2). O store `thumbs` existia desde o M4 e estava
       * **vazio**: a tela listava três mundos com o mesmo texto cinza e nenhum
       * jeito de saber qual era qual sem entrar. Carrega sob demanda, uma por
       * entrada, e o quadro vazio fica para o mundo que ainda não foi salvo.
       */
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      entry.appendChild(thumb);
      void this.fillThumbnail(thumb, world.id);

      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = world.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${world.gameMode === 'creative' ? 'Criativo' : 'Sobrevivência'}`
        + ` · seed ${world.seed || world.seedHash}`
        + ` · ${formatDate(world.lastPlayed)}`
        + ` · ${formatSize(world.sizeBytes)}`;
      info.append(name, meta);
      entry.appendChild(info);

      entry.addEventListener('click', () => {
        this.selected = world.id;
        this.renderList();
      });
      entry.addEventListener('dblclick', () => this.callbacks.play(world));
      this.list.appendChild(entry);
    }
    this.updateButtons();
  }

  /**
   * Põe a miniatura do mundo no quadro, se houver uma no banco.
   *
   * As URLs de blob criadas aqui são revogadas na próxima montagem da lista:
   * sem isso, abrir e fechar a tela vinte vezes vazaria vinte imagens.
   */
  private async fillThumbnail(target: HTMLElement, worldId: string): Promise<void> {
    const load = this.callbacks.thumbnail;
    if (load === undefined) return;
    try {
      const png = await load(worldId);
      if (png === undefined) return;
      const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
      this.thumbUrls.push(url);
      target.style.backgroundImage = `url(${url})`;
      target.classList.add('has-image');
    } catch {
      // Sem miniatura a entrada fica com o quadro vazio, que é o que era.
    }
  }

  /** URLs de blob vivas das miniaturas, para revogar ao redesenhar. */
  private readonly thumbUrls: string[] = [];

  private updateButtons(): void {
    const has = this.selected !== null;
    this.playButton.disabled = !has;
    this.deleteButton.disabled = !has;
    this.exportButton.disabled = !has || this.callbacks.exportWorld === undefined;
  }

  /** Mensagem curta abaixo dos botões: é o retorno de exportar e importar. */
  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
  }

  private async exportSelected(): Promise<void> {
    const world = this.worlds.find((w) => w.id === this.selected);
    if (world === undefined || this.callbacks.exportWorld === undefined) return;
    this.setStatus('Empacotando…');
    try {
      await this.callbacks.exportWorld(world);
      this.setStatus(`"${world.name}" exportado.`);
    } catch (error) {
      this.setStatus(messageOf(error, 'Não deu para exportar.'));
    }
  }

  private async importPicked(): Promise<void> {
    const file = this.fileInput.files?.[0];
    // Limpa já: sem isso, escolher o mesmo arquivo duas vezes não dispara nada.
    this.fileInput.value = '';
    if (file === undefined || this.callbacks.importWorld === undefined) return;

    this.setStatus('Lendo o arquivo…');
    try {
      const name = await this.callbacks.importWorld(file);
      this.setStatus(`"${name}" importado.`);
      await this.refresh();
    } catch (error) {
      this.setStatus(messageOf(error, 'Não deu para importar.'));
    }
  }

  private toggleCreate(open: boolean): void {
    this.createForm.hidden = !open;
    if (open) this.nameInput.focus();
  }

  private playSelected(): void {
    const world = this.worlds.find((w) => w.id === this.selected);
    if (world !== undefined) this.callbacks.play(world);
  }

  private async deleteSelected(): Promise<void> {
    const world = this.worlds.find((w) => w.id === this.selected);
    if (world === undefined) return;
    // Única ação irreversível do jogo: pede confirmação.
    if (!confirm(`Apagar "${world.name}" para sempre?`)) return;
    await this.callbacks.remove(world);
    this.selected = null;
    await this.refresh();
  }

  private async createWorld(): Promise<void> {
    const name = this.nameInput.value.trim() || 'Novo Mundo';
    const mode = this.modeSelect.value === 'creative' ? 'creative' : 'survival';
    const difficulty = Number(this.difficultySelect.value) as 0 | 1 | 2 | 3;
    const meta = await this.callbacks.create(name, this.seedInput.value.trim(), mode, difficulty);
    this.callbacks.play(meta);
  }
}

function select(options: readonly { value: string; label: string }[]): HTMLSelectElement {
  const el = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    el.appendChild(item);
  }
  return el;
}

function labelled(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'menu-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrapper.append(span, control);
  return wrapper;
}

/** Mensagem de erro legível, com um fallback para o que não é `Error`. */
/**
 * Tamanho do mundo em disco (doc 11 §5).
 *
 * "—" enquanto ele nunca foi medido, que é o caso de um mundo recém-criado: o
 * número só existe depois do primeiro `saveAll`.
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB`;
}

function formatDate(timestamp: number): string {
  if (timestamp <= 0) return 'nunca jogado';
  const date = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
