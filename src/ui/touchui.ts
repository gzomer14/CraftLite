/**
 * Camada visual dos controles de toque (doc 09 §2).
 *
 * Botões em DOM, joystick e anel de progresso em um canvas 2D pequeno. O canvas
 * só é redesenhado quando algo muda — desenhar um joystick parado 60 vezes por
 * segundo é desperdício num aparelho que já está no limite.
 *
 * Requisitos duros do doc: alvos ≥ 44×44 px CSS **reais**, opacidade 55% que
 * sobe para 90% no toque, e `env(safe-area-inset-*)` para o notch.
 */

import type { SettingsStore } from '../game/settings';
import type { TouchButtons } from '../input/touch';

/** Alvo mínimo de toque em px CSS (doc 09 §2.3). */
const MIN_TARGET = 44;

export interface TouchUiCallbacks {
  onPause: () => void;
  onInventory: () => void;
  onFlyToggle: () => void;
  /** Modo B: botões dedicados de quebrar e colocar. */
  onBreakDown: (down: boolean) => void;
  onPlace: () => void;
}

export class TouchUi {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g2d: CanvasRenderingContext2D | null;
  private readonly settings: SettingsStore;
  private readonly buttons: TouchButtons;
  private readonly modeBButtons: HTMLElement[] = [];
  /** Só aparece no criativo (doc 09 §3). */
  private flyButton!: HTMLElement;

  /** Última pose desenhada, para pular redesenhos idênticos. */
  private lastKey = '';
  private width = 0;
  private height = 0;

  constructor(settings: SettingsStore, buttons: TouchButtons, callbacks: TouchUiCallbacks) {
    this.settings = settings;
    this.buttons = buttons;
    injectStyle();

    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.hidden = true;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stick';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g2d = this.canvas.getContext('2d');
    this.root.appendChild(this.canvas);

    // --- botões de ação, lado direito ---
    const right = document.createElement('div');
    right.className = 'pad right';
    right.appendChild(this.holdButton('▲', 'Pular', (down) => { buttons.jump = down; }));
    right.appendChild(this.holdButton('▼', 'Agachar', (down) => { buttons.sneak = down; }));
    /*
     * O voo só existe no criativo — `onFlyToggle` devolve cedo em qualquer
     * outro modo. Desenhar o botão sempre dava ao jogador de sobrevivência um
     * controle em posição nobre que não fazia nada e não explicava por quê.
     */
    this.flyButton = this.tapButton('✈', 'Alternar voo', callbacks.onFlyToggle);
    this.flyButton.hidden = true;
    right.appendChild(this.flyButton);

    // --- botões do modo B, acima dos de movimento ---
    const modeB = document.createElement('div');
    modeB.className = 'pad modeb';
    const breakBtn = this.holdButton('⛏', 'Quebrar', callbacks.onBreakDown);
    const placeBtn = this.tapButton('▣', 'Colocar', callbacks.onPlace);
    modeB.append(breakBtn, placeBtn);
    this.modeBButtons.push(modeB);

    // --- canto superior direito ---
    const top = document.createElement('div');
    top.className = 'pad top';
    top.appendChild(this.tapButton('⏸', 'Pausa', callbacks.onPause));
    top.appendChild(this.tapButton('▤', 'Inventário', callbacks.onInventory));

    this.root.append(right, modeB, top);
    document.body.appendChild(this.root);

    this.applyMode();
    settings.onChange(() => this.applyMode());
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.resize();
  }

  /** Mostra os controles só em aparelho de toque. */
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    /*
     * Os pads ficam nos cantos e o HUD corre a tela toda: sem reservar, o botão
     * de pular passava por cima do fim da barra de fome. Publica a largura
     * ocupada para o `#hud` se encolher — em vez de o HUD chutar um número que
     * a escala de botão do jogador desmentiria.
     */
    document.documentElement.style.setProperty(
      '--touch-pad', visible ? `calc(16px + 56px * ${this.settings.get('touchButtonScale')})` : '0px',
    );
    if (visible) this.resize();
  }

  /** O botão de voar só faz sentido no criativo (doc 09 §3). */
  setCreative(creative: boolean): void {
    this.flyButton.hidden = !creative;
  }

  private applyMode(): void {
    const isModeB = this.settings.get('touchMode') === 'B';
    for (const el of this.modeBButtons) el.hidden = !isModeB;
    this.root.style.setProperty('--btn-scale', String(this.settings.get('touchButtonScale')));
    this.root.classList.toggle('left-handed', this.settings.get('leftHanded'));
    if (!this.root.hidden) this.setVisible(true);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (this.g2d !== null) this.g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.lastKey = '';
  }

  /**
   * Redesenha o joystick e o anel de progresso do toque longo.
   * `holdProgress` em 0..1; `aim` em px CSS.
   */
  draw(
    joystick: { active: boolean; originX: number; originY: number; x: number; y: number; sprinting: boolean },
    holdProgress: number, aimX: number, aimY: number,
  ): void {
    const g = this.g2d;
    if (g === null || this.root.hidden) return;

    // Chave de estado: sem mudança, sem redesenho.
    const key = joystick.active
      ? `${joystick.originX | 0},${joystick.originY | 0},${joystick.x | 0},${joystick.y | 0},${joystick.sprinting ? 1 : 0},${holdProgress.toFixed(2)},${aimX | 0},${aimY | 0}`
      : `off,${holdProgress.toFixed(2)},${aimX | 0},${aimY | 0}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    g.clearRect(0, 0, this.width, this.height);

    if (joystick.active) {
      const dx = joystick.x - joystick.originX;
      const dy = joystick.y - joystick.originY;
      const distance = Math.hypot(dx, dy);
      const clamped = Math.min(distance, 60);
      const nx = distance === 0 ? 0 : (dx / distance) * clamped;
      const ny = distance === 0 ? 0 : (dy / distance) * clamped;

      // O joystick precisa ser legível tanto sobre grama clara quanto sobre
      // caverna escura, então tudo leva um contorno escuro por baixo do traço
      // branco — sem isso ele some no terreno iluminado.
      const ring = (x: number, y: number, radius: number, width: number, color: string): void => {
        g.beginPath();
        g.arc(x, y, radius, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = width + 3;
        g.stroke();
        g.beginPath();
        g.arc(x, y, radius, 0, Math.PI * 2);
        g.strokeStyle = color;
        g.lineWidth = width;
        g.stroke();
      };

      // Anel externo — dourado quando correndo (doc 09 §2.1).
      ring(joystick.originX, joystick.originY, 60,
        joystick.sprinting ? 4 : 3,
        joystick.sprinting ? 'rgba(245, 205, 95, 0.95)' : 'rgba(255,255,255,0.55)');

      // Manopla.
      g.beginPath();
      g.arc(joystick.originX + nx, joystick.originY + ny, 24, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fill();
      ring(joystick.originX + nx, joystick.originY + ny, 24, 2, 'rgba(255,255,255,0.85)');
    }

    if (holdProgress > 0 && holdProgress < 1) {
      // Anel de progresso no ponto do dedo, enquanto o toque longo carrega.
      const sweep = -Math.PI / 2 + holdProgress * Math.PI * 2;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(aimX, aimY, 26, -Math.PI / 2, sweep);
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 7;
      g.stroke();
      g.beginPath();
      g.arc(aimX, aimY, 26, -Math.PI / 2, sweep);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 4;
      g.stroke();
    }
  }

  /** Botão que reporta pressionado/solto (pular, agachar, quebrar). */
  private holdButton(glyph: string, label: string, onChange: (down: boolean) => void): HTMLElement {
    const el = this.makeButton(glyph, label);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('down');
      onChange(true);
    });
    const release = (e: Event): void => {
      e.stopPropagation();
      el.classList.remove('down');
      onChange(false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    return el;
  }

  /** Botão de disparo único. */
  private tapButton(glyph: string, label: string, onTap: () => void): HTMLElement {
    const el = this.makeButton(glyph, label);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('down');
      onTap();
    });
    const release = (e: Event): void => {
      e.stopPropagation();
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    return el;
  }

  private makeButton(glyph: string, label: string): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tbtn';
    el.textContent = glyph;
    el.setAttribute('aria-label', label);
    return el;
  }

  /** Usado pelos testes e pela tela de opções para conferir o alvo mínimo. */
  static get minTargetPx(): number {
    return MIN_TARGET;
  }

  dispose(): void {
    this.root.remove();
    void this.buttons;
  }
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#touch{position:fixed;inset:0;z-index:6;pointer-events:none;--btn-scale:1;
  --btn:calc(56px * var(--btn-scale))}
#touch .stick{position:absolute;inset:0;pointer-events:none}
#touch .pad{position:absolute;display:flex;gap:12px;pointer-events:none}
#touch .tbtn{pointer-events:auto;width:var(--btn);height:var(--btn);
  min-width:${MIN_TARGET}px;min-height:${MIN_TARGET}px;
  border:2px solid rgba(255,255,255,.55);border-radius:8px;
  background:rgba(20,22,28,.45);color:#fff;font-size:calc(var(--btn) * .42);
  line-height:1;display:grid;place-items:center;opacity:.55;
  touch-action:none;-webkit-tap-highlight-color:transparent;user-select:none;
  transition:opacity .1s,transform .1s;padding:0}
#touch .tbtn.down{opacity:.9;transform:scale(.94)}
#touch .right{right:calc(16px + env(safe-area-inset-right,0px));
  bottom:calc(84px + env(safe-area-inset-bottom,0px));flex-direction:column-reverse}
#touch .modeb{left:calc(16px + env(safe-area-inset-left,0px));
  bottom:calc(84px + env(safe-area-inset-bottom,0px));flex-direction:column-reverse}
#touch .top{right:calc(16px + env(safe-area-inset-right,0px));
  top:calc(12px + env(safe-area-inset-top,0px))}
#touch.left-handed .right{right:auto;left:calc(16px + env(safe-area-inset-left,0px))}
#touch.left-handed .modeb{left:auto;right:calc(16px + env(safe-area-inset-right,0px))}
@media (prefers-reduced-motion:reduce){#touch .tbtn{transition:none}}
`;
  document.head.appendChild(css);
}
