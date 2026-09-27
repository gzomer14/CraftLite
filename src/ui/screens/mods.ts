/**
 * Tela **Mods** (M21): liga e desliga os mods do catálogo.
 *
 * Chega do título, como a de texturas, e pelo mesmo motivo: aplicar recarrega
 * a página, e de dentro do jogo isso custaria o que foi feito desde o último
 * autosave. A mudança só vale no boot — um mod entra nas tabelas quando elas se
 * montam (`mods/active.ts`) —, então marcar e desmarcar não muda nada até o
 * jogador apertar *Recarregar*.
 */

import { menuButton, menuPanel, menuRoot, menuRow } from './menu';
import { lang, t, tf } from '../../core/i18n';
import { ACTIVE_MODS } from '../../mods/active';
import { MOD_CATALOG, readEnabledMods, writeEnabledMods, type ModInfo } from '../../mods/catalog';

/** Nome do mod no idioma em uso. */
export function modName(info: ModInfo): string {
  return lang() === 'en' ? info.en.display : info.display;
}

export class ModsScreen {
  private readonly root: HTMLDivElement;
  private readonly boxes: HTMLInputElement[] = [];
  private readonly applyButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;

  constructor(back: () => void) {
    this.root = menuRoot('mods-screen');
    const { panel, body } = menuPanel(t('title.mods'));

    const intro = document.createElement('p');
    intro.className = 'menu-empty';
    intro.textContent = t('mods.intro');

    const active = document.createElement('p');
    active.className = 'menu-empty';
    active.textContent = ACTIVE_MODS.length === 0
      ? t('mods.none_active')
      : tf('mods.active', MOD_CATALOG.filter((info) => ACTIVE_MODS.some((m) => m.id === info.id))
        .map(modName).join(', '));

    body.append(intro, active);
    const en = lang() === 'en';
    for (const info of MOD_CATALOG) {
      const label = document.createElement('label');
      label.className = 'menu-field';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.mod = info.id;
      box.addEventListener('change', () => this.refresh());
      this.boxes.push(box);
      const text = document.createElement('span');
      const heavy = info.heavy === true ? ` (${t('mods.heavy')})` : '';
      text.textContent = `${modName(info)} — ${en ? info.en.description : info.description}${heavy}`;
      label.append(box, text);
      body.appendChild(label);
    }

    this.applyButton = menuButton(t('mods.apply'), () => {
      writeEnabledMods(this.checked());
      location.reload();
    }, 'primary');
    this.backButton = menuButton(t('opt.back'), back);
    body.appendChild(menuRow(this.applyButton, this.backButton));
    this.root.appendChild(panel);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); back(); }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    const enabled = readEnabledMods();
    for (const box of this.boxes) box.checked = enabled.includes(box.dataset.mod ?? '');
    this.refresh();
    this.root.hidden = false;
    this.backButton.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private checked(): string[] {
    return this.boxes.filter((box) => box.checked).map((box) => box.dataset.mod ?? '');
  }

  /** *Recarregar* só aparece quando a escolha difere do que está rodando. */
  private refresh(): void {
    const running = ACTIVE_MODS.map((mod) => mod.id).join(',');
    this.applyButton.hidden = this.checked().join(',') === running;
  }
}
