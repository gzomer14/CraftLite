/**
 * A linguagem visual única da interface (marco M32, "interface nova").
 *
 * Até aqui cada tela tinha o próprio CSS — a mochila cinza de bordas em
 * relevo, o título azul-ardósia, as opções com outra paleta —, e cada uma
 * resolvia "fechar" do seu jeito, quase sempre com um botão "Fechar" grande.
 * Este módulo é o lugar das peças comuns: as cores, o painel, o botão de
 * bloco com relevo, a aba, o ✕ do canto e o balão de dica que aparece uma vez.
 *
 * As sete regras (aprovadas no canvas da proposta, 2026-10-20):
 * 1. nada rola em 640×360 nem em 844×390 — só listas longas, dentro da caixa;
 * 2. sem botão "Fechar": ✕ no canto, toque fora, o mesmo botão que abriu;
 * 3. uma ação principal por tela, verde;
 * 4. nada desabilitado à vista;
 * 5. ícone e palavra em todo botão;
 * 6. dica uma vez, em balão;
 * 7. o mesmo visual do título ao baú.
 *
 * Só a fonte do sistema: fonte baixada é asset de terceiros, e o projeto não
 * os aceita (CLAUDE.md). Os ícones são traços SVG escritos aqui.
 */

import { t } from '../core/i18n';

/** Ícones de traço, 24×24. `fill` marca os que são preenchidos. */
const ICONS: Record<string, { d: string; fill?: boolean }> = {
  close: { d: 'M6 6l12 12M18 6L6 18' },
  back: { d: 'M15 5l-7 7 7 7' },
  play: { d: 'M7 4.5v15l12-7.5z', fill: true },
  bag: { d: 'M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2' },
  book: { d: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5' },
  globe: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18' },
  people: { d: 'M8 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM16 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM2.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M10.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5' },
  gear: { d: 'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' },
  puzzle: { d: 'M9 3h6v4a2 2 0 1 0 4 0h2v6h-3a2 2 0 1 0 0 4h3v4H3V3h6z' },
  trophy: { d: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 20h8' },
  chart: { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  exit: { d: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10' },
  plus: { d: 'M12 5v14M5 12h14' },
  dots: { d: 'M5 12h.01M12 12h.01M19 12h.01' },
  search: { d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4' },
  upload: { d: 'M12 15V3M7 8l5-5 5 5M4 15v5h16v-5' },
  download: { d: 'M12 3v12M7 10l5 5 5-5M4 15v5h16v-5' },
  copy: { d: 'M8 8h12v12H8zM16 8V4H4v12h4' },
  trash: { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' },
  palette: { d: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 2-1 3-1a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7h.01M14.5 7h.01' },
  screen: { d: 'M3 5h18v12H3zM8 21h8M12 17v4' },
  sound: { d: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' },
  pad: { d: 'M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zM7 10v4M5 12h4M16 11h.01M18 13h.01' },
  heart: { d: 'M12 21s-7.5-4.6-9.3-9.2C1.4 8.3 3.6 5 7 5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.8C19.5 16.4 12 21 12 21z' },
  access: { d: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM4 9l8 2 8-2M12 11v4l-3 6M12 15l3 6' },
  cube: { d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  pick: { d: 'M4 9c4.5-4.5 11.5-4.5 16 0M12 6.5V21' },
  sword: { d: 'M19 3h2v2L9.5 16.5 7.5 14.5zM6 13l5 5M4 20l2.5-2.5' },
  apple: { d: 'M12 7.5c-2.6-1.8-7-.6-7 4.5 0 4 2.8 8 5 8 .9 0 1.3-.5 2-.5s1.1.5 2 .5c2.2 0 5-4 5-8 0-5.1-4.4-6.3-7-4.5zM12 7.5c0-2 1-3.5 3-4.5' },
  gem: { d: 'M7 4h10l4 5-9 11L3 9zM3 9h18M10 4 8.5 9 12 20M14 4l1.5 5L12 20' },
  phone: { d: 'M8.5 2.5h7a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM10.5 18.5h3' },
  undo: { d: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11' },
  pencil: { d: 'M4 20h4L19 9l-4-4L4 16z' },
};

/** Um ícone como SVG inline, decorativo (o rótulo vem do texto ao lado). */
export function icon(name: keyof typeof ICONS | string, color = 'currentColor', size = 20): SVGSVGElement {
  const spec = ICONS[name] ?? ICONS.dots;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('cl-icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', spec.d);
  if (spec.fill === true) {
    path.setAttribute('fill', color);
  } else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

/** O ✕ do canto (regra 2): quadrado de 44 px, com nome para o leitor de tela. */
export function closeButton(onClose: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cl-close';
  button.setAttribute('aria-label', t('common.close'));
  button.appendChild(icon('close', '#fff', 20));
  button.addEventListener('click', onClose);
  return button;
}

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

/** Botão de bloco com relevo, com ícone e palavra (regra 5). */
export function themedButton(
  label: string, onClick: () => void, kind: ButtonKind = 'secondary', iconName?: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `cl-btn ${kind}`;
  if (iconName !== undefined) button.appendChild(icon(iconName));
  const text = document.createElement('span');
  text.textContent = label;
  button.appendChild(text);
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Balão de dica que aparece **uma vez** (regra 6) e some no "Entendi". A
 * lembrança fica no `localStorage`; sem ele (aba privada), o balão volta a
 * cada sessão, que é melhor que nunca aparecer.
 */
export function coachOnce(
  key: string, text: string, parent: HTMLElement, onDone?: () => void,
): HTMLElement | null {
  const storageKey = `craftlite.coach.${key}`;
  try {
    if (localStorage.getItem(storageKey) === '1') return null;
  } catch {
    // Sem armazenamento: mostra.
  }
  const bubble = document.createElement('div');
  bubble.className = 'cl-coach';
  bubble.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = text;
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = t('common.got_it');
  ok.addEventListener('click', (e) => {
    e.stopPropagation();
    bubble.remove();
    try { localStorage.setItem(storageKey, '1'); } catch { /* sem armazenamento */ }
    onDone?.();
  });
  bubble.append(span, ok);
  parent.appendChild(bubble);
  return bubble;
}

let injected = false;

/** As cores e as peças comuns, uma vez por página. */
export function injectTheme(): void {
  if (injected) return;
  injected = true;
  const css = document.createElement('style');
  css.textContent = `
:root{--cl-bg:#101a2b;--cl-panel:#15223a;--cl-edge:#2a3c5e;--cl-raise:#22324f;--cl-raise-low:#0b1220;
  --cl-ink:#f4f7fb;--cl-muted:#a9b6cc;--cl-green:#3fbf4a;--cl-green-low:#1f7a28;--cl-gold:#ffc83d;
  --cl-gold-low:#a3790f;--cl-red:#e5484d;--cl-slot:#0c1524;--cl-slot-edge:#2b3d5f;--cl-dim:rgba(4,8,16,.62);
  --cl-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.cl-icon{flex:none;display:block}
.cl-close{width:44px;height:44px;flex:none;border:0;border-radius:12px;background:var(--cl-raise);
  display:grid;place-items:center;cursor:pointer;box-shadow:0 4px 0 var(--cl-raise-low),inset 0 2px 0 rgba(255,255,255,.12)}
.cl-close:hover,.cl-close:focus-visible{background:#2d4166;outline:none}
.cl-close:active{transform:translateY(3px);box-shadow:0 1px 0 var(--cl-raise-low)}
.cl-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:44px;padding:0 18px;
  border:0;border-radius:12px;font:800 15px/1.1 var(--cl-font);color:var(--cl-ink);cursor:pointer;
  background:var(--cl-raise);box-shadow:0 4px 0 var(--cl-raise-low),inset 0 2px 0 rgba(255,255,255,.12)}
.cl-btn:active{transform:translateY(3px);box-shadow:0 1px 0 var(--cl-raise-low)}
.cl-btn:hover,.cl-btn:focus-visible{filter:brightness(1.12);outline:none}
.cl-btn:focus-visible{box-shadow:0 4px 0 var(--cl-raise-low),0 0 0 3px var(--cl-gold)}
.cl-btn.primary{background:var(--cl-green);color:#fff;box-shadow:0 5px 0 var(--cl-green-low),inset 0 2px 0 rgba(255,255,255,.3)}
.cl-btn.primary:active{box-shadow:0 2px 0 var(--cl-green-low)}
.cl-btn.danger{background:transparent;color:#ffb4b6;box-shadow:inset 0 0 0 2px #5a3448}
.cl-btn.ghost{background:transparent;color:#9fb4d6;box-shadow:none}
.cl-btn[hidden]{display:none}
.cl-tab{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border:0;border-radius:12px;
  font:800 14px/1 var(--cl-font);cursor:pointer;background:var(--cl-raise);color:#e9eef7;
  box-shadow:0 4px 0 var(--cl-raise-low)}
.cl-tab.on{background:var(--cl-gold);color:#1a1406;box-shadow:0 4px 0 var(--cl-gold-low)}
.cl-tab .badge{min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--cl-green);color:#fff;
  font-size:12px;display:inline-grid;place-items:center}
.cl-tab[hidden],.cl-tab .badge[hidden]{display:none}
.cl-coach{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;
  gap:12px;max-width:min(92vw,560px);padding:10px 12px 10px 14px;border-radius:12px;background:var(--cl-gold);
  color:#1a1406;font:700 13px/1.3 var(--cl-font);box-shadow:0 6px 18px rgba(0,0,0,.4)}
.cl-coach.inline{position:static;transform:none;max-width:none;box-shadow:none}
.cl-coach button{flex:none;min-height:36px;padding:0 12px;border:0;border-radius:9px;background:#1a1406;
  color:var(--cl-gold);font:900 13px var(--cl-font);cursor:pointer}
@media (prefers-reduced-motion:reduce){.cl-btn,.cl-close,.cl-tab{transition:none}}
`;
  document.head.appendChild(css);
}
