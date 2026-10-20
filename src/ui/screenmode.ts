/**
 * Tela cheia, trava de orientação e aviso de retrato (doc 09 §2.3).
 *
 * Tudo aqui falha silenciosamente de propósito: `requestFullscreen` exige gesto
 * do usuário, `orientation.lock` não existe no iOS, e nenhum dos dois pode
 * derrubar o jogo. Quando a trava não funciona, o aviso "gire o aparelho" cobre
 * a diferença.
 *
 * **É só aqui que a paisagem é pedida** — desvio do doc 11 §7, que a punha no
 * manifesto. Com `"orientation": "landscape"` no manifesto, o app instalado
 * não abria no Android 8 ("CraftLite parou", J7 Metal, 2026-09-28): a tela de
 * abertura do WebAPK é translúcida, e o Android 8 derruba a atividade
 * translúcida que fixa orientação.
 *
 * **Desde a abertura** (pedido de 2026-10-20): antes o aviso só nascia ao
 * entrar no mundo, e título, opções e criar mundo abriam em pé — onde as
 * telas do M32, desenhadas para o celular deitado, cortavam texto. Agora o
 * `boot` cria esta peça antes da tela de carregamento, e o primeiro toque em
 * qualquer tela (menus inclusive) já pede a tela cheia e a trava.
 */
import { t } from '../core/i18n';
import { icon, injectTheme } from './theme';

export class ScreenMode {
  private readonly warning: HTMLDivElement;
  private requested = false;

  constructor() {
    injectTheme();
    injectStyle();
    this.warning = document.createElement('div');
    this.warning.id = 'rotate-warning';
    this.warning.setAttribute('role', 'alert');
    // Um celular desenhado que deita: a figura diz o que fazer antes do texto.
    const phone = icon('phone', 'currentColor', 72);
    phone.classList.add('phone');
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = t('hud.rotate');
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = t('hud.rotate_hint');
    this.warning.append(phone, title, hint);
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
   * O primeiro toque em qualquer tela pede tela cheia e paisagem (precisa de
   * gesto). No Android isso já gira a tela sozinho; onde a trava não existe,
   * o aviso fica até o jogador deitar o aparelho.
   */
  enterOnFirstTouch(): void {
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;
      document.removeEventListener('pointerdown', onDown, true);
      this.enter();
    };
    document.addEventListener('pointerdown', onDown, true);
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
/* Acima de tudo, inclusive da tela de carregamento e dos menus. */
#rotate-warning{position:fixed;inset:0;z-index:40;display:grid;place-content:center;gap:10px;justify-items:center;
  background:radial-gradient(ellipse at center,#1a2a47 0%,var(--cl-bg,#101a2b) 70%);color:var(--cl-ink,#f4f7fb);
  font-family:var(--cl-font,system-ui,sans-serif);text-align:center;padding:24px;touch-action:none}
#rotate-warning[hidden]{display:none}
#rotate-warning .phone{color:var(--cl-gold,#ffc83d);margin-bottom:8px;animation:rotate-hint 2.4s ease-in-out infinite}
#rotate-warning .title{margin:0;font:900 22px/1.2 var(--cl-font,system-ui,sans-serif)}
#rotate-warning .hint{margin:0;max-width:260px;color:var(--cl-muted,#a9b6cc);font:600 14px/1.4 var(--cl-font,system-ui,sans-serif)}
@keyframes rotate-hint{0%,20%{transform:rotate(0)}55%,80%{transform:rotate(-90deg)}100%{transform:rotate(0)}}
@media (prefers-reduced-motion:reduce){#rotate-warning .phone{animation:none;transform:rotate(-90deg)}}
`;
  document.head.appendChild(css);
}
