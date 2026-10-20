/**
 * Seleção e criação de mundos (doc 08 §3.2–§3.3).
 *
 * É a tela que dá sentido ao save: sem ela, o jogo abria sempre no mesmo mundo
 * vindo da URL e não havia como voltar para o de ontem.
 *
 * A criação segue o doc: nome, seed digitada (texto vira número por hash, então
 * "oi" é uma seed válida; o código curto de `core/seedcode.ts` vale pelo número
 * que guarda), modo e dificuldade. Apagar pede confirmação porque é
 * a única ação irreversível do jogo inteiro.
 *
 * **M32 (interface nova):** a lista com sete botões embaixo — quatro deles
 * cinza enquanto nada estava selecionado — virou uma fileira de **cartões**:
 * tocar no cartão joga, e o resto (copiar seed, exportar, apagar) mora no ⋯
 * do cartão. Criar mundo é um painel próprio, com o modo em dois cartões
 * grandes e a seed e a dificuldade guardadas em "Mais opções".
 */

import { menuRoot, messageOf, textField } from './menu';
import { closeButton, icon } from '../theme';
import type { WorldMeta } from '../../save/db';
import { seedCode } from '../../core/seedcode';
import { decimal, htmlLang, t, tf } from '../../core/i18n';

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

type Mode = 'survival' | 'creative';

export class WorldsScreen {
  private readonly root: HTMLDivElement;
  private readonly cards: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private readonly status: HTMLParagraphElement;
  private readonly createPanel: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private readonly modeCards: Record<Mode, HTMLButtonElement>;
  private readonly difficultyButtons: HTMLButtonElement[] = [];
  private readonly moreBox: HTMLDivElement;
  private readonly callbacks: WorldsCallbacks;

  private worlds: WorldMeta[] = [];
  private mode: Mode = 'survival';
  private difficulty: 0 | 1 | 2 | 3 = 2;
  /** Mundo cujo ⋯ está aberto. */
  private menuFor: WorldMeta | null = null;

  constructor(callbacks: WorldsCallbacks) {
    this.callbacks = callbacks;
    this.root = menuRoot('worlds-screen');
    this.root.classList.add('full');
    injectStyle();

    const header = document.createElement('div');
    header.className = 'worlds-header';
    const back = chip(t('worlds.home'), 'back', () => this.callbacks.back());
    back.setAttribute('aria-label', t('opt.back'));
    const title = document.createElement('h1');
    title.textContent = t('worlds.title');
    header.append(back, title);
    /*
     * Levar mundo daqui para lá (M7). O `<input type="file">` fica escondido
     * e é acionado pelo botão: o seletor nativo é a única forma de ler arquivo
     * do disco sem pedir permissão.
     */
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.clw';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.importPicked());
    if (callbacks.importWorld !== undefined) {
      header.appendChild(chip(t('worlds.import'), 'upload', () => this.fileInput.click()));
    }

    this.cards = document.createElement('div');
    this.cards.className = 'world-cards';
    this.cards.setAttribute('role', 'list');

    this.status = document.createElement('p');
    this.status.className = 'worlds-status';
    this.status.hidden = true;
    this.status.setAttribute('role', 'status');

    this.menu = this.buildMenu();

    const create = this.buildCreate();
    this.createPanel = create.panel;
    this.nameInput = create.name;
    this.seedInput = create.seed;
    this.modeCards = create.modes;
    this.moreBox = create.more;

    this.root.append(header, this.cards, this.status, this.menu, this.fileInput, this.createPanel);
    // Tocar fora do ⋯ aberto fecha o menu.
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Abre a tela e recarrega a lista do banco. */
  async show(): Promise<void> {
    this.root.hidden = false;
    this.toggleCreate(false);
    this.closeMenu();
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
    this.renderCards();
  }

  // --- cartões ----------------------------------------------------------------

  private renderCards(): void {
    this.cards.textContent = '';
    for (const url of this.thumbUrls) URL.revokeObjectURL(url);
    this.thumbUrls.length = 0;

    // O primeiro cartão é sempre o de criar: com a lista vazia, é a única coisa a tocar.
    const fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = 'world-card new';
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.appendChild(icon('plus', '#fff', 34));
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = t('worlds.create');
    fresh.append(plus, label);
    fresh.addEventListener('click', () => this.toggleCreate(true));
    this.cards.appendChild(fresh);

    for (const world of this.worlds) this.cards.appendChild(this.worldCard(world));
  }

  private worldCard(world: WorldMeta): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'world-card-wrap';
    wrap.setAttribute('role', 'listitem');

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'world-card';
    /*
     * Miniatura (doc 08 §3.2): carrega sob demanda; o quadro fica com o céu
     * desenhado para o mundo que ainda não foi salvo.
     */
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    void this.fillThumbnail(thumb, world.id);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = world.name;
    const badge = document.createElement('span');
    badge.className = world.gameMode === 'creative' ? 'badge creative' : 'badge';
    badge.textContent = world.gameMode === 'creative' ? t('mode.creative') : t('mode.survival');
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${formatDate(world.lastPlayed)} · ${formatSize(world.sizeBytes)}`;
    const play = document.createElement('span');
    play.className = 'play';
    const playText = document.createElement('span');
    playText.textContent = t('worlds.play');
    play.append(icon('play', '#fff', 16), playText);
    card.append(thumb, name, badge, meta, play);
    card.addEventListener('click', () => this.callbacks.play(world));

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.setAttribute('aria-label', tf('worlds.actions', world.name));
    more.appendChild(icon('dots', '#fff', 20));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMenu(world, more);
    });

    wrap.append(card, more);
    return wrap;
  }

  /**
   * Põe a miniatura do mundo no quadro, se houver uma no banco. As URLs de
   * blob são revogadas na próxima montagem: sem isso, abrir e fechar a tela
   * vinte vezes vazaria vinte imagens.
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
      // Sem miniatura o quadro fica com o céu desenhado.
    }
  }

  /** URLs de blob vivas das miniaturas, para revogar ao redesenhar. */
  private readonly thumbUrls: string[] = [];

  // --- o ⋯ do cartão ------------------------------------------------------------

  private buildMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.className = 'world-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    const item = (label: string, iconName: string, color: string, run: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      const text = document.createElement('span');
      text.textContent = label;
      button.append(icon(iconName, color, 18), text);
      button.addEventListener('click', () => { this.closeMenu(); run(); });
      return button;
    };
    menu.appendChild(item(t('worlds.share_seed'), 'copy', '#9be38b', () => void this.shareMenuWorld()));
    if (this.callbacks.exportWorld !== undefined) {
      menu.appendChild(item(t('worlds.export'), 'download', '#7fc8ff', () => void this.exportMenuWorld()));
    }
    const remove = item(`${t('worlds.delete')}…`, 'trash', '#ff8a8d', () => void this.deleteMenuWorld());
    remove.classList.add('danger');
    menu.appendChild(remove);
    return menu;
  }

  private openMenu(world: WorldMeta, anchor: HTMLElement): void {
    this.menuFor = world;
    this.menu.hidden = false;
    // Abaixo do ⋯, sem sair da tela pela direita.
    const box = anchor.getBoundingClientRect();
    const width = 220;
    this.menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width))}px`;
    this.menu.style.top = `${box.bottom + 6}px`;
    (this.menu.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private closeMenu(): void {
    this.menu.hidden = true;
    this.menuFor = null;
  }

  /** Mensagem curta embaixo dos cartões: o retorno de exportar, importar e copiar. */
  private setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
  }

  private async exportMenuWorld(): Promise<void> {
    const world = this.menuForOrLast();
    if (world === undefined || this.callbacks.exportWorld === undefined) return;
    this.setStatus(t('worlds.packing'));
    try {
      await this.callbacks.exportWorld(world);
      this.setStatus(tf('worlds.exported', world.name));
    } catch (error) {
      this.setStatus(messageOf(error, t('worlds.export_failed')));
    }
  }

  private async importPicked(): Promise<void> {
    const file = this.fileInput.files?.[0];
    // Limpa já: sem isso, escolher o mesmo arquivo duas vezes não dispara nada.
    this.fileInput.value = '';
    if (file === undefined || this.callbacks.importWorld === undefined) return;
    this.setStatus(t('worlds.reading'));
    try {
      const name = await this.callbacks.importWorld(file);
      this.setStatus(tf('worlds.imported', name));
      await this.refresh();
    } catch (error) {
      this.setStatus(messageOf(error, t('worlds.import_failed')));
    }
  }

  /**
   * Copia o código da seed (M17). O texto copiado é **só o código**: é o que o
   * campo de seed do outro lado aceita de volta. Ele aparece escrito na hora,
   * porque a área de transferência pode ficar pendurada numa permissão.
   */
  private async shareMenuWorld(): Promise<void> {
    const world = this.menuForOrLast();
    if (world === undefined) return;
    const code = seedCode(world.seedHash);
    this.setStatus(tf('worlds.seed_shown', code));
    try {
      await navigator.clipboard.writeText(code);
      this.setStatus(tf('worlds.seed_copied', code));
    } catch {
      // Sem permissão: fica o código escrito na tela.
    }
  }

  private async deleteMenuWorld(): Promise<void> {
    const world = this.menuForOrLast();
    if (world === undefined) return;
    // Única ação irreversível do jogo: pede confirmação.
    if (!confirm(tf('worlds.confirm_delete', world.name))) return;
    await this.callbacks.remove(world);
    await this.refresh();
  }

  /** O mundo do ⋯ — guardado antes de `closeMenu` limpar a referência. */
  private lastMenuWorld: WorldMeta | undefined;
  private menuForOrLast(): WorldMeta | undefined {
    if (this.menuFor !== null) this.lastMenuWorld = this.menuFor;
    return this.lastMenuWorld;
  }

  // --- criar mundo ----------------------------------------------------------------

  private buildCreate(): {
    panel: HTMLDivElement; name: HTMLInputElement; seed: HTMLInputElement;
    modes: Record<Mode, HTMLButtonElement>; more: HTMLDivElement;
  } {
    const shade = document.createElement('div');
    shade.className = 'create-shade';
    shade.hidden = true;
    shade.addEventListener('pointerdown', (e) => { if (e.target === shade) this.toggleCreate(false); });

    const panel = document.createElement('div');
    panel.className = 'menu-panel create';
    const heading = document.createElement('h1');
    heading.textContent = t('worlds.new_world');
    const name = textField(t('worlds.name'), '', t('worlds.new_world'));

    const modes = document.createElement('div');
    modes.className = 'modes';
    const modeCard = (mode: Mode, iconName: string, color: string, hint: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mode-card';
      const badge = document.createElement('span');
      badge.className = 'mode-icon';
      badge.appendChild(icon(iconName, color, 30));
      const words = document.createElement('span');
      words.className = 'words';
      const title = document.createElement('strong');
      title.textContent = mode === 'creative' ? t('mode.creative') : t('mode.survival');
      const text = document.createElement('span');
      text.textContent = hint;
      words.append(title, text);
      button.append(badge, words);
      button.addEventListener('click', () => this.setMode(mode));
      return button;
    };
    const survival = modeCard('survival', 'heart', '#ff5a5f', t('mode.survival_hint'));
    const creative = modeCard('creative', 'cube', '#c9a7ff', t('mode.creative_hint'));
    modes.append(survival, creative);

    const more = document.createElement('div');
    more.className = 'more-box';
    more.hidden = true;
    const seed = textField(t('worlds.seed'), '', t('worlds.seed_hint'));
    /*
     * Colar a seed: o botão existe para o celular, onde segurar o dedo num
     * campo pequeno para achar "colar" é a parte difícil.
     */
    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'paste';
    paste.textContent = t('worlds.paste');
    paste.addEventListener('click', () => void this.pasteSeed());
    seed.wrapper.appendChild(paste);
    const difficulty = document.createElement('div');
    difficulty.className = 'menu-field';
    const diffLabel = document.createElement('span');
    diffLabel.textContent = t('opt.difficulty');
    const segment = document.createElement('div');
    segment.className = 'segment';
    const levels: readonly [0 | 1 | 2 | 3, string][] = [
      [0, t('opt.peaceful')], [1, t('opt.easy')], [2, t('opt.normal')], [3, t('opt.hard')],
    ];
    for (const [value, label] of levels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => this.setDifficulty(value));
      this.difficultyButtons.push(button);
      segment.appendChild(button);
    }
    difficulty.append(diffLabel, segment);
    more.append(seed.wrapper, difficulty);

    const footer = document.createElement('div');
    footer.className = 'create-footer';
    const toggleMore = document.createElement('button');
    toggleMore.type = 'button';
    toggleMore.className = 'more-toggle';
    const moreText = document.createElement('span');
    moreText.textContent = t('worlds.more');
    toggleMore.append(icon('dots', '#9fb4d6', 16), moreText);
    toggleMore.addEventListener('click', () => {
      more.hidden = !more.hidden;
      modes.hidden = !more.hidden;
    });
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'primary go';
    const goText = document.createElement('span');
    goText.textContent = t('worlds.create_play');
    go.append(icon('play', '#fff', 18), goText);
    go.addEventListener('click', () => void this.createWorld());
    footer.append(toggleMore, go);

    panel.append(closeButton(() => this.toggleCreate(false)), heading, name.wrapper, modes, more, footer);
    shade.appendChild(panel);
    this.updateChoices(survival, creative);
    return { panel: shade, name: name.input, seed: seed.input, modes: { survival, creative }, more };
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.updateChoices(this.modeCards.survival, this.modeCards.creative);
  }

  private setDifficulty(value: 0 | 1 | 2 | 3): void {
    this.difficulty = value;
    this.updateChoices(this.modeCards.survival, this.modeCards.creative);
  }

  /** Ouro no escolhido: o modo e a dificuldade são escolhas, não listas suspensas. */
  private updateChoices(survival: HTMLButtonElement, creative: HTMLButtonElement): void {
    survival.classList.toggle('on', this.mode === 'survival');
    creative.classList.toggle('on', this.mode === 'creative');
    survival.setAttribute('aria-pressed', String(this.mode === 'survival'));
    creative.setAttribute('aria-pressed', String(this.mode === 'creative'));
    this.difficultyButtons.forEach((button, i) => {
      button.classList.toggle('on', i === this.difficulty);
      button.setAttribute('aria-pressed', String(i === this.difficulty));
    });
  }

  private async pasteSeed(): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text !== '') this.seedInput.value = text;
    } catch {
      // Sem permissão de leitura: o teclado do aparelho cola no campo.
    }
    this.seedInput.focus();
  }

  private toggleCreate(open: boolean): void {
    this.createPanel.hidden = !open;
    if (!open) return;
    this.moreBox.hidden = true;
    (this.createPanel.querySelector('.modes') as HTMLElement | null)?.removeAttribute('hidden');
    this.nameInput.focus();
  }

  private async createWorld(): Promise<void> {
    const name = this.nameInput.value.trim() || t('worlds.new_world');
    const meta = await this.callbacks.create(name, this.seedInput.value.trim(), this.mode, this.difficulty);
    this.callbacks.play(meta);
  }
}

/** Botão de cabeçalho: ícone e palavra (regra 5 do M32). */
function chip(label: string, iconName: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  const text = document.createElement('span');
  text.textContent = label;
  button.append(icon(iconName, '#fff', 18), text);
  button.addEventListener('click', onClick);
  return button;
}

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
  return `${mb < 10 ? decimal(mb, 1) : Math.round(mb)} MB`;
}

/** Dia, mês e hora na ordem do idioma: 25/09 em português, 09/25 em inglês. */
function formatDate(timestamp: number): string {
  if (timestamp <= 0) return t('worlds.never_played');
  return new Date(timestamp).toLocaleString(htmlLang(), {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#worlds-screen.full{display:flex;flex-direction:column;place-items:stretch;padding:10px 14px;overflow:hidden;
  background:var(--cl-bg)}
#worlds-screen .worlds-header{display:flex;align-items:center;gap:12px;flex:none}
#worlds-screen .worlds-header h1{flex:1;margin:0;font:900 clamp(20px,5vh,26px)/1.1 var(--cl-font)}
#worlds-screen button.chip{flex:none;display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px}
#worlds-screen .world-cards{flex:1;min-height:0;display:flex;gap:14px;align-items:center;overflow-x:auto;overflow-y:hidden;
  padding:12px 2px 14px;touch-action:pan-x;overscroll-behavior:contain;scroll-snap-type:x proximity}
#worlds-screen .world-card-wrap{position:relative;flex:none;scroll-snap-align:start}
#worlds-screen button.world-card{flex:none;display:flex;flex-direction:column;align-items:flex-start;gap:5px;
  width:clamp(160px,24vw,196px);height:clamp(220px,64vh,258px);padding:0 0 12px;overflow:hidden;border-radius:16px;
  background:#1a2740;text-align:left;font:700 13px/1.2 var(--cl-font)}
#worlds-screen .world-card .thumb{align-self:stretch;flex:1 1 auto;min-height:60px;background-size:cover;background-position:center;
  background-color:#4fae3c;background-image:linear-gradient(#5aa0f0 0%,#a7d6ff 55%,#4fae3c 55%,#4fae3c 70%,#6b4a2c 70%)}
#worlds-screen .world-card .name{padding:0 12px;font:900 16px/1.15 var(--cl-font);max-width:100%;box-sizing:border-box;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#worlds-screen .world-card .badge{margin:0 12px;padding:3px 8px;border-radius:999px;background:#2c5a2f;color:#b9f3b0;
  font:800 11px/1.2 var(--cl-font)}
#worlds-screen .world-card .badge.creative{background:#5b3b8c;color:#e1cfff}
#worlds-screen .world-card .meta{padding:0 12px;color:var(--cl-muted);font:600 11px/1.2 var(--cl-font)}
#worlds-screen .world-card .play{align-self:stretch;margin:4px 12px 0;min-height:38px;border-radius:10px;background:var(--cl-green);
  display:flex;align-items:center;justify-content:center;gap:8px;font:900 15px/1 var(--cl-font);
  box-shadow:0 4px 0 var(--cl-green-low)}
#worlds-screen button.world-card.new{align-items:center;justify-content:center;gap:12px;padding:0;background:rgba(63,191,74,.08);
  box-shadow:inset 0 0 0 3px var(--cl-green)}
#worlds-screen .world-card.new .plus{width:64px;height:64px;border-radius:18px;background:var(--cl-green);display:grid;
  place-items:center;box-shadow:0 5px 0 var(--cl-green-low)}
#worlds-screen .world-card.new .name{white-space:normal;text-align:center}
#worlds-screen button.more{position:absolute;top:8px;right:8px;width:40px;height:40px;min-height:40px;padding:0;flex:none;
  display:grid;place-items:center;border-radius:10px;background:rgba(8,14,28,.66)}
#worlds-screen .worlds-status{flex:none;margin:0;text-align:center;color:var(--cl-muted);font:600 13px/1.3 var(--cl-font)}
#worlds-screen .world-menu{position:fixed;z-index:3;width:220px;padding:8px;border-radius:14px;background:#24365a;
  box-shadow:0 12px 30px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px}
#worlds-screen .world-menu[hidden]{display:none}
#worlds-screen .world-menu button{flex:none;justify-content:flex-start;display:flex;align-items:center;gap:10px;min-height:42px;
  background:transparent;box-shadow:none;font:700 14px/1 var(--cl-font)}
#worlds-screen .world-menu button.danger{color:#ff8a8d}
#worlds-screen .create-shade{position:fixed;inset:0;z-index:4;background:var(--cl-dim);display:grid;place-items:center;padding:10px}
#worlds-screen .create-shade[hidden]{display:none}
#worlds-screen .menu-panel.create{width:min(640px,100%);display:flex;flex-direction:column;gap:12px;max-height:100%;
  box-sizing:border-box}
#worlds-screen .menu-panel.create h1{margin-bottom:0}
#worlds-screen .modes{display:flex;gap:12px}
#worlds-screen .modes[hidden]{display:none}
#worlds-screen button.mode-card{flex:1;display:flex;align-items:center;gap:12px;min-height:clamp(84px,26vh,118px);padding:0 14px;
  text-align:left;border-radius:14px;background:#1a2740;box-shadow:0 4px 0 var(--cl-raise-low),inset 0 0 0 3px #2a3c5e}
#worlds-screen button.mode-card.on{box-shadow:0 4px 0 var(--cl-raise-low),inset 0 0 0 3px var(--cl-gold),0 0 0 3px rgba(255,200,61,.25)}
#worlds-screen .mode-card .mode-icon{flex:none;width:52px;height:52px;border-radius:14px;background:#0d1626;display:grid;place-items:center}
#worlds-screen .mode-card .words{display:flex;flex-direction:column;gap:4px}
#worlds-screen .mode-card strong{font:900 17px/1.1 var(--cl-font)}
#worlds-screen .mode-card .words span{color:#b8c6dc;font:600 12px/1.25 var(--cl-font)}
#worlds-screen .more-box{display:flex;flex-direction:column;gap:8px}
#worlds-screen .more-box[hidden]{display:none}
#worlds-screen button.paste{flex:none;min-height:38px}
#worlds-screen .segment{display:flex;gap:3px;padding:3px;border-radius:11px;background:#0d1626}
#worlds-screen .segment button{flex:none;min-height:34px;padding:0 10px;border-radius:9px;background:transparent;box-shadow:none;
  color:#a9b6cc;font:800 13px/1 var(--cl-font)}
#worlds-screen .segment button.on{background:var(--cl-gold);color:#1a1406}
#worlds-screen .create-footer{display:flex;align-items:center;gap:12px;margin-top:2px}
#worlds-screen button.more-toggle{flex:none;display:flex;align-items:center;gap:8px;background:transparent;box-shadow:none;
  color:#9fb4d6;font:800 13px/1.2 var(--cl-font);padding:0 6px}
#worlds-screen button.go{margin-left:auto;flex:none;display:flex;align-items:center;gap:10px;min-height:54px;padding:0 26px;
  font:900 19px/1 var(--cl-font)}
`;
  document.head.appendChild(css);
}
