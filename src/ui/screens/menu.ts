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

export function menuPanel(title: string): { panel: HTMLDivElement; body: HTMLDivElement } {
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'menu-body';
  panel.append(heading, body);
  return { panel, body };
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
 */
export function buildFields(
  target: HTMLElement, settings: SettingsStore, fields: readonly Field[],
): void {
  for (const field of fields) {
    const wrapper = document.createElement('label');
    wrapper.className = 'menu-field';
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
      input.value = String(settings.get(field.key) as number);
      const show = (): void => {
        const current = Number(input.value);
        value.textContent = field.format?.(current) ?? String(current);
      };
      show();
      input.addEventListener('input', () => {
        settings.set(field.key, Number(input.value) as never);
        show();
      });
      wrapper.append(input, value);
    } else if (field.kind === 'toggle') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings.get(field.key) === true;
      input.addEventListener('change', () => {
        settings.set(field.key, input.checked as never);
      });
      wrapper.appendChild(input);
    } else {
      const select = document.createElement('select');
      for (const option of field.options) {
        const el = document.createElement('option');
        el.value = String(option.value);
        el.textContent = option.label;
        select.appendChild(el);
      }
      select.value = String(settings.get(field.key));
      select.addEventListener('change', () => {
        const current = field.options.find((o) => String(o.value) === select.value);
        if (current === undefined) return;
        settings.set(field.key, current.value as never);
      });
      wrapper.appendChild(select);
    }

    target.appendChild(wrapper);
  }
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
  const css = document.createElement('style');
  css.textContent = `
.menu-screen{position:fixed;inset:0;z-index:16;background:#0b1016e6;
  display:grid;place-items:center;padding:16px;overflow:auto;
  font-family:ui-monospace,"Courier New",monospace;color:#fff}
.menu-panel{width:min(560px,100%);background:#1c2530;border:2px solid #000;
  box-shadow:inset 2px 2px 0 #ffffff26,inset -2px -2px 0 #00000059;padding:18px}
.menu-panel h1{margin:0 0 12px;font-size:clamp(20px,4vw,30px);text-shadow:2px 2px 0 #000;
  text-align:center}
.menu-panel h2{margin:14px 0 6px;font-size:13px;opacity:.7;text-transform:uppercase;
  letter-spacing:1px}
.menu-body{display:flex;flex-direction:column;gap:8px}
.menu-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.menu-screen button{min-height:44px;min-width:120px;padding:10px 16px;flex:1 1 auto;
  background:#6e6e6e;color:#fff;border:2px solid #000;
  box-shadow:inset 2px 2px 0 #ffffff40,inset -2px -2px 0 #00000040;
  font:14px/1 ui-monospace,monospace;cursor:pointer;-webkit-tap-highlight-color:transparent}
.menu-screen button.primary{background:#3f7d3f}
.menu-screen button.danger{background:#7d3f3f}
.menu-screen button:hover,.menu-screen button:focus-visible{background:#7b94c7;
  outline:2px solid #fff}
.menu-screen button:disabled{opacity:.45;cursor:default}
.menu-field{display:flex;align-items:center;gap:10px;min-height:40px;font-size:13px}
.menu-field>span{flex:1 1 auto}
.menu-field input[type=range]{flex:0 0 42%;min-width:140px;accent-color:#7b94c7}
.menu-field input[type=text]{flex:0 0 52%;min-height:36px;background:#0e141b;color:#fff;
  border:2px solid #000;padding:6px 8px;font:13px/1 ui-monospace,monospace}
.menu-field input[type=checkbox]{width:24px;height:24px;accent-color:#7b94c7}
.menu-field select{flex:0 0 42%;min-height:36px;background:#0e141b;color:#fff;
  border:2px solid #000;padding:6px;font:13px/1 ui-monospace,monospace}
.menu-field output{flex:0 0 64px;text-align:right;opacity:.8}
.menu-section{display:flex;flex-direction:column;gap:6px}
.menu-list{display:flex;flex-direction:column;gap:6px;max-height:46vh;overflow:auto;
  margin-bottom:8px}
.menu-list .entry{display:flex;align-items:center;gap:10px;padding:8px 10px;
  background:#0e141b;border:2px solid #000;cursor:pointer;text-align:left;min-height:52px}
.menu-list .entry.selected{border-color:#7b94c7;background:#16202b}
.menu-list .entry .name{font-size:14px}
.menu-list .entry .meta{font-size:11px;opacity:.65}
.menu-list .entry .info{flex:1 1 auto;display:flex;flex-direction:column;gap:2px}
.menu-empty{opacity:.6;font-size:13px;text-align:center;padding:18px 0}
@media (prefers-reduced-motion:reduce){.menu-screen *{transition:none!important}}
`;
  document.head.appendChild(css);
}
