/**
 * Tela cheia, trava de orientação e aviso de retrato (doc 09 §2.3).
 *
 * Tudo aqui falha silenciosamente de propósito: `requestFullscreen` exige gesto
 * do usuário, `orientation.lock` não existe no iOS, e nenhum dos dois pode
 * derrubar o jogo. Quando a trava não funciona, o aviso "gire o aparelho" cobre
 * a diferença.
 */
import { t } from '../core/i18n';

export class ScreenMode {
  private readonly warning: HTMLDivElement;
  private requested = false;

  constructor() {
    injectStyle();
    this.warning = document.createElement('div');
    this.warning.id = 'rotate-warning';
    this.warning.setAttribute('role', 'alert');
    this.warning.innerHTML = `<span>⟳</span><p>${t('hud.rotate')}</p>`;
    this.warning.hidden = true;
    document.body.appendChild(this.warning);

    const update = (): void => this.updateWarning();
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });
    this.updateWarning();
  }

  /** true se o aparelho está em retrato e é de toque. */
  get isPortrait(): boolean {
    return matchMedia('(pointer: coarse)').matches
      && window.innerHeight > window.innerWidth;
  }

  private updateWarning(): void {
    this.warning.hidden = !this.isPortrait;
  }

  /**
   * Entra em tela cheia e tenta travar em paisagem. Só pode ser chamado a
   * partir de um gesto do usuário — daí ser disparado no primeiro toque.
   */
  enter(): void {
    if (this.requested) return;
    this.requested = true;

    const root = document.documentElement;
    const request = root.requestFullscreen
      ?? (root as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
    if (request !== undefined) {
      void Promise.resolve(request.call(root, { navigationUI: 'hide' } as FullscreenOptions))
        .then(() => this.lockLandscape())
        .catch(() => {
          // Recusado (iOS, ou sem gesto): segue sem tela cheia.
          this.requested = false;
        });
    }
  }

  private lockLandscape(): void {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    if (orientation?.lock === undefined) return;
    void orientation.lock('landscape').catch(() => {
      // iOS e alguns Android recusam; o aviso de retrato cobre o caso.
    });
  }

  /** Sai da tela cheia, ao pausar. */
  exit(): void {
    this.requested = false;
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
  }
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#rotate-warning{position:fixed;inset:0;z-index:30;display:grid;place-content:center;
  gap:16px;justify-items:center;background:#0b0d12;color:#fff;
  font:14px/1.4 ui-monospace,"Courier New",monospace;text-align:center;padding:24px}
#rotate-warning span{font-size:56px;display:block;animation:rotate-hint 2s ease-in-out infinite}
#rotate-warning p{margin:0;opacity:.75}
@keyframes rotate-hint{0%,100%{transform:rotate(0)}50%{transform:rotate(90deg)}}
@media (prefers-reduced-motion:reduce){#rotate-warning span{animation:none}}
`;
  document.head.appendChild(css);
}
