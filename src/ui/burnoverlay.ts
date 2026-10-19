/**
 * Borda de fogo na tela enquanto o jogador arde (M23).
 *
 * Até o M23 pegar fogo só aparecia como o coração descendo: nada dizia "você
 * está em chamas, procure água". É uma camada de CSS por cima do mundo, criada
 * na primeira vez que o jogador queima e mexida só quando o estado muda — o
 * quadro comum não toca o DOM.
 */

export class BurnOverlay {
  private el: HTMLDivElement | null = null;
  private shown = false;

  update(burning: boolean): void {
    if (burning === this.shown) return;
    this.shown = burning;
    if (burning && this.el === null) this.el = create();
    if (this.el !== null) this.el.classList.toggle('on', burning);
  }
}

function create(): HTMLDivElement {
  const css = document.createElement('style');
  /*
   * Gradiente de baixo para cima, como chama subindo pelo corpo, e um tremor
   * de opacidade. Fica embaixo do HUD (z-index 4) para não cobrir a vida, que é
   * justamente o que o jogador precisa ver ardendo.
   */
  css.textContent = `#burn{position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;
  transition:opacity .25s;background:linear-gradient(to top,#ff6a00b3 0%,#ff3d0066 18%,
  #ff8a0026 38%,transparent 60%)}
#burn.on{opacity:1;animation:burn-flicker .4s steps(2) infinite alternate}
@keyframes burn-flicker{from{opacity:.85}to{opacity:1}}
@media (prefers-reduced-motion:reduce){#burn.on{animation:none}}`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'burn';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
}
