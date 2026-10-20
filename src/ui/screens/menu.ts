/**
 * Peças compartilhadas das telas de menu (doc 08 §3.1–§3.3 e §3.11).
 *
 * Título, mundos e opções têm o mesmo painel, os mesmos botões e a mesma
 * navegação por teclado. Ter isso em um módulo evita três cópias do CSS e, mais
 * importante, garante que o alvo de toque de 44 px e o `focus-visible` valham
 * em todas — acessibilidade que se repete à mão é acessibilidade que se perde.
 *
 * Os campos de opção são **declarativos**: a tela descreve o que existe e este
 * módulo cuida de ler, escrever e persistir.
 */

import type { Settings, SettingsStore } from '../../game/settings';
import { KEYBINDS, keyLabel, type ActionId } from '../../data/keybinds';
import type { Keybinds } from '../../input/keybinds';
import { t } from '../../core/i18n';
import { closeButton, injectTheme } from '../theme';

/** Um campo de opção ligado a uma chave de `Settings`. */
export type Field =
  | {
    kind: 'range'; key: keyof Settings; label: string;
    min: number; max: number; step: number;
    /** Texto mostrado ao lado do controle. */
    format?: (value: number) => string;
  }
  | { kind: 'toggle'; key: keyof Settings; label: string }
  | {
    kind: 'choice'; key: keyof Settings; label: string;
    options: readonly { value: string | number; label: string }[];
  };

export function menuRoot(id: string): HTMLDivElement {
  injectMenuStyle();
  const root = document.createElement('div');
  root.id = id;
  root.className = 'menu-screen';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  document.body.appendChild(root);
  return root;
}

/**
 * O painel com título. Com `onClose` (M32), ganha o ✕ do canto — e tocar no
 * escuro em volta do painel faz o mesmo: o jogador não procura um "Voltar"
 * no fim da lista.
 */
export function menuPanel(title: string, onClose?: () => void): {
  panel: HTMLDivElement; body: HTMLDivElement; close: HTMLButtonElement | null;
} {
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'menu-body';
  panel.append(heading, body);
  const close = onClose === undefined ? null : closeButton(onClose);
  if (close !== null) panel.appendChild(close);
  return { panel, body, close };
}

/** Tocar no fundo da tela (fora do painel) chama `onClose` (regra 2 do M32). */
export function closeOnBackdrop(root: HTMLElement, onClose: () => void): void {
  root.addEventListener('pointerdown', (e) => {
    if ((e as Event).target === root) onClose();
  });
}

export function menuButton(
  label: string, onClick: () => void, variant: 'normal' | 'danger' | 'primary' = 'normal',
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.className = variant;
  el.addEventListener('click', onClick);
  return el;
}

export function menuRow(...children: HTMLElement[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'menu-row';
  row.append(...children);
  return row;
}

export function textField(label: string, value: string, placeholder = ''): {
  wrapper: HTMLLabelElement; input: HTMLInputElement;
} {
  const wrapper = document.createElement('label');
  wrapper.className = 'menu-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  wrapper.append(span, input);
  return { wrapper, input };
}

/**
 * Monta os campos e os liga ao `SettingsStore`.
 *
 * A escrita é imediata: não existe botão "aplicar", porque o jogador precisa
 * ouvir o volume e ver a distância de render enquanto mexe no controle.
 *
 * **M32:** liga/desliga é um interruptor e escolha curta é um segmento com
 * todas as opções à vista (o `<select>` escondia as alternativas atrás de um
 * toque). Só a escolha de rótulos longos continua `<select>`. Devolve, para
 * cada campo, como reler o valor — "Restaurar esta aba" e o atalho de
 * gráficos (que escreve nuvens e partículas juntas) mudam valores por fora.
 */
export function buildFields(
  target: HTMLElement, settings: SettingsStore, fields: readonly Field[],
): (() => void)[] {
  const syncs: (() => void)[] = [];
  for (const field of fields) {
    const segmented = field.kind === 'choice' && fitsSegment(field.options);
    const wrapper = document.createElement(segmented ? 'div' : 'label');
    // Segmento que não cabe ao lado do rótulo desce para a linha de baixo,
    // inteiro, em vez de cortar as opções em "B…" (fonte larga, CI do M32).
    wrapper.className = segmented ? 'menu-field has-segment' : 'menu-field';
    const span = document.createElement('span');
    span.textContent = field.label;
    wrapper.appendChild(span);

    if (field.kind === 'range') {
      const input = document.createElement('input');
      const value = document.createElement('output');
      input.type = 'range';
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      const show = (): void => {
        const current = Number(input.value);
        value.textContent = field.format?.(current) ?? String(current);
      };
      input.addEventListener('input', () => {
        settings.set(field.key, Number(input.value) as never);
        show();
      });
      syncs.push(() => { input.value = String(settings.get(field.key) as number); show(); });
      wrapper.append(input, value);
    } else if (field.kind === 'toggle') {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'switch';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', field.label);
      const sync = (): void => toggle.setAttribute('aria-checked', String(settings.get(field.key) === true));
      toggle.addEventListener('click', () => {
        settings.set(field.key, (settings.get(field.key) !== true) as never);
        sync();
      });
      syncs.push(sync);
      wrapper.appendChild(toggle);
    } else if (segmented) {
      const segment = document.createElement('div');
      segment.className = 'segment';
      segment.setAttribute('role', 'radiogroup');
      segment.setAttribute('aria-label', field.label);
      const buttons: HTMLButtonElement[] = [];
      for (const option of field.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => { settings.set(field.key, option.value as never); sync(); });
        buttons.push(button);
        segment.appendChild(button);
      }
      const sync = (): void => {
        const current = String(settings.get(field.key));
        for (let i = 0; i < buttons.length; i++) {
          const on = String(field.options[i].value) === current;
          buttons[i].classList.toggle('on', on);
          buttons[i].setAttribute('aria-checked', String(on));
        }
      };
      syncs.push(sync);
      wrapper.appendChild(segment);
    } else {
      const select = document.createElement('select');
      for (const option of field.options) {
        const el = document.createElement('option');
        el.value = String(option.value);
        el.textContent = option.label;
        select.appendChild(el);
      }
      select.addEventListener('change', () => {
        const current = field.options.find((o) => String(o.value) === select.value);
        if (current === undefined) return;
        settings.set(field.key, current.value as never);
      });
      syncs.push(() => { select.value = String(settings.get(field.key)); });
      wrapper.appendChild(select);
    }

    target.appendChild(wrapper);
  }
  for (const sync of syncs) sync();
  return syncs;
}

/**
 * Segmento só quando cabe ao lado do rótulo num celular deitado: até quatro
 * opções e rótulos curtos. O resto ("DualSense (PS5)"…) fica no `<select>`.
 */
function fitsSegment(options: readonly { label: string }[]): boolean {
  if (options.length > 4) return false;
  let chars = 0;
  for (const option of options) chars += option.label.length;
  return chars <= 30;
}

/**
 * Lista de teclas remapeáveis (doc 08 §3.11: "clicar → pressionar tecla;
 * conflito fica em vermelho").
 *
 * Não é um `Field`: o controle não é um input do HTML, é um botão que entra em
 * modo de escuta e captura o próximo `keydown` **antes** de qualquer outro
 * ouvinte — inclusive o do jogo, que está por baixo da tela e continuaria
 * agachando enquanto o jogador escolhe a tecla de agachar.
 */
export function buildKeybinds(target: HTMLElement, keybinds: Keybinds): void {
  const buttons = new Map<ActionId, HTMLButtonElement>();
  /** Ação em escuta, e como parar de escutar. */
  let listening: ActionId | null = null;
  let stopListening: (() => void) | null = null;

  const refresh = (): void => {
    for (const [id, button] of buttons) {
      const conflicted = keybinds.conflicts(id).length > 0;
      button.textContent = id === listening ? t('menu.press_key') : keyLabel(keybinds.codeFor(id));
      button.classList.toggle('conflict', conflicted && id !== listening);
      button.classList.toggle('listening', id === listening);
      button.setAttribute(
        'aria-label',
        `${KEYBINDS.find((b) => b.id === id)?.label ?? id}: ${keyLabel(keybinds.codeFor(id))}`
        + (conflicted ? t('menu.in_conflict') : ''),
      );
    }
  };

  const cancel = (): void => {
    stopListening?.();
    stopListening = null;
    listening = null;
    refresh();
  };

  const listen = (id: ActionId): void => {
    cancel();
    listening = id;
    const onKey = (e: KeyboardEvent): void => {
      // Sempre engole a tecla: ela é a escolha do jogador, não um comando.
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') keybinds.set(id, e.code);
      cancel();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    stopListening = () => window.removeEventListener('keydown', onKey, { capture: true });
    refresh();
  };

  for (const bind of KEYBINDS) {
    const row = document.createElement('div');
    row.className = 'menu-field';
    const span = document.createElement('span');
    span.textContent = bind.label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'keybind';
    button.addEventListener('click', () => listen(bind.id));
    buttons.set(bind.id, button);
    row.append(span, button);
    target.appendChild(row);
  }

  const reset = menuButton(t('menu.reset_keys'), () => { cancel(); keybinds.reset(); }, 'normal');
  target.appendChild(menuRow(reset));

  keybinds.onChange(refresh);
  refresh();
}

/** Seção com título dentro de um painel. */
export function menuSection(title: string): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'menu-section';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

let styleInjected = false;
function injectMenuStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  injectTheme();
  const css = document.createElement('style');
  css.textContent = `
/* M32: o painel azul-noite e os botões de bloco de \`ui/theme.ts\`. */
/* A coluna da grade não cresce com o conteúdo (minmax(0,1fr)): com uma fonte larga, o painel
   largo esticava a coluna e o próprio \`width:100%\` junto, e passava da borda (CI do M32). */
.menu-screen{position:fixed;inset:0;z-index:16;background:rgba(8,13,24,.94);
  display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:12px;overflow:auto;box-sizing:border-box;
  touch-action:pan-y;overscroll-behavior:contain;font:600 14px/1.3 var(--cl-font);color:var(--cl-ink)}
.menu-panel{position:relative;margin-block:auto;width:min(620px,100%);box-sizing:border-box;background:var(--cl-panel);
  border-radius:20px;box-shadow:0 0 0 3px var(--cl-edge),0 18px 40px rgba(0,0,0,.55);padding:16px 20px 20px}
.menu-panel h1{margin:0 56px 12px 0;font:900 clamp(20px,4vw,28px)/1.1 var(--cl-font)}
.menu-panel h2{margin:12px 0 6px;font:800 12px/1.2 var(--cl-font);color:#9fb4d6;text-transform:uppercase;
  letter-spacing:.08em}
.menu-panel>.cl-close{position:absolute;top:12px;right:12px}
.menu-screen button.cl-close{flex:none;width:44px;min-height:44px;padding:0}
.menu-body{display:flex;flex-direction:column;gap:10px}
.menu-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.menu-screen button{min-height:44px;padding:0 18px;flex:1 1 auto;border:0;border-radius:12px;
  background:var(--cl-raise);color:var(--cl-ink);font:800 15px/1.1 var(--cl-font);cursor:pointer;
  box-shadow:0 4px 0 var(--cl-raise-low),inset 0 2px 0 rgba(255,255,255,.12);-webkit-tap-highlight-color:transparent}
.menu-screen button:active{transform:translateY(3px);box-shadow:0 1px 0 var(--cl-raise-low)}
.menu-screen button.primary{background:var(--cl-green);color:#fff;
  box-shadow:0 5px 0 var(--cl-green-low),inset 0 2px 0 rgba(255,255,255,.3)}
.menu-screen button.danger{background:transparent;color:#ffb4b6;box-shadow:inset 0 0 0 2px #5a3448}
.menu-screen button:hover,.menu-screen button:focus-visible{filter:brightness(1.12);outline:none}
.menu-screen button:focus-visible{box-shadow:0 4px 0 var(--cl-raise-low),0 0 0 3px var(--cl-gold)}
.menu-screen button[hidden]{display:none}
.menu-screen button>.cl-icon{display:inline-block;vertical-align:-4px;margin-right:8px}
.menu-screen button:disabled{opacity:.45;cursor:default}
.menu-field{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 12px;border-radius:12px;
  background:#1a2740;font:700 14px/1.2 var(--cl-font)}
.menu-field>span{flex:1 1 auto;min-width:0}
.menu-field input[type=range]{flex:0 0 40%;min-width:140px;accent-color:var(--cl-green)}
.menu-field input[type=text]{flex:0 0 52%;min-height:38px;border:0;border-radius:10px;background:#0d1626;color:#fff;
  box-shadow:0 0 0 2px var(--cl-edge);padding:0 12px;font:700 15px/1 var(--cl-font)}
.menu-field input[type=checkbox]{width:26px;height:26px;accent-color:var(--cl-green)}
.menu-screen button.switch{flex:none;position:relative;width:52px;min-height:30px;height:30px;padding:0;border-radius:15px;
  background:#33415c;box-shadow:inset 0 2px 4px rgba(0,0,0,.35)}
.menu-screen button.switch::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:12px;
  background:#fff;box-shadow:0 2px 0 rgba(0,0,0,.3);transition:left .15s}
.menu-screen button.switch[aria-checked=true]{background:var(--cl-green)}
.menu-screen button.switch[aria-checked=true]::after{left:25px}
.menu-field.has-segment{flex-wrap:wrap;row-gap:6px;padding-block:6px}
.menu-field .segment{flex:0 1 auto;min-width:0;margin-left:auto;display:flex;gap:3px;padding:3px;border-radius:11px;background:#0d1626}
.menu-screen .segment button{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  min-height:34px;padding:0 10px;border-radius:9px;background:transparent;
  color:var(--cl-muted);font:800 13px/1 var(--cl-font);box-shadow:none}
.menu-screen .segment button.on{background:var(--cl-gold);color:#1a1406}
.menu-field select{flex:0 0 42%;min-height:38px;border:0;border-radius:10px;background:#0d1626;color:#fff;
  box-shadow:0 0 0 2px var(--cl-edge);padding:0 10px;font:700 14px/1 var(--cl-font)}
.menu-field output{flex:0 0 64px;text-align:right;color:#ffd75a;font-weight:800}
.menu-hint{margin:2px 0 6px;font-size:12px;color:var(--cl-muted)}
.menu-screen button.keybind{flex:0 0 42%;min-width:120px;min-height:38px;padding:0 8px;background:#0d1626;font-size:13px;
  box-shadow:0 0 0 2px var(--cl-edge)}
.menu-screen button.keybind.listening{background:#7d6a2f;color:#fff}
.menu-screen button.keybind.conflict{background:#5a2430;box-shadow:0 0 0 2px #ff9a9a}
.menu-section{display:flex;flex-direction:column;gap:8px}
.menu-list{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto;margin-bottom:8px}
.menu-list .entry{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#1a2740;
  cursor:pointer;text-align:left;min-height:52px}
.menu-list .entry.selected{box-shadow:0 0 0 3px var(--cl-gold)}
.menu-list .entry .name{font-size:14px}
.menu-list .entry .meta{font-size:11px;color:var(--cl-muted)}
.menu-list .entry .info{flex:1 1 auto;display:flex;flex-direction:column;gap:2px}
.menu-list .entry .thumb{flex:0 0 auto;width:64px;aspect-ratio:16/9;border-radius:8px;background:#050a0f;
  background-size:cover;background-position:center;image-rendering:auto}
.menu-empty{color:var(--cl-muted);font-size:13px;text-align:center;padding:12px 0}
@media (prefers-reduced-motion:reduce){.menu-screen *{transition:none!important}}
`;
  document.head.appendChild(css);
}

/** Mensagem de erro legível, ou o texto de reserva. Usada pelas telas de menu. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}
