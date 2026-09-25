/**
 * A barra de vida do chefe (M16): o dragão do End, no alto da tela.
 *
 * Só existe no End com o dragão vivo; a luta (`game/dragonfight.ts`) diz a
 * fração da vida, e aqui só se mexe no DOM quando ela muda de verdade — um
 * `style` por quadro seria layout à toa (doc 08 §4.6).
 */

export class BossBar {
  readonly element: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private shown = -2;

  constructor(title: string) {
    injectStyle();
    this.element = document.createElement('div');
    this.element.className = 'boss-bar';
    this.element.hidden = true;
    this.element.setAttribute('role', 'progressbar');
    this.element.setAttribute('aria-label', title);
    const label = document.createElement('div');
    label.className = 'boss-title';
    label.textContent = title;
    const track = document.createElement('div');
    track.className = 'boss-track';
    this.fill = document.createElement('div');
    this.fill.className = 'boss-fill';
    track.appendChild(this.fill);
    this.element.append(label, track);
  }

  /** `fraction` 0..1, ou negativo para esconder. */
  update(fraction: number): void {
    // Uma casa de porcentagem basta: a barra tem ~300 px.
    const rounded = fraction < 0 ? -1 : Math.round(fraction * 200) / 200;
    if (rounded === this.shown) return;
    this.shown = rounded;
    this.element.hidden = rounded < 0;
    if (rounded < 0) return;
    this.fill.style.transform = `scaleX(${rounded})`;
    this.element.setAttribute('aria-valuenow', String(Math.round(rounded * 100)));
  }
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#hud .boss-bar{position:absolute;top:8px;left:50%;transform:translateX(-50%);
  width:min(60vw,360px);text-align:center;pointer-events:none;
  font:12px/1.2 ui-monospace,monospace;color:#fff;text-shadow:1px 1px 0 #000}
#hud .boss-track{margin-top:3px;height:6px;background:#2a0f33;border:1px solid #000;overflow:hidden}
#hud .boss-fill{height:100%;background:#c23bd6;transform-origin:left center}
`;
  document.head.appendChild(css);
}
