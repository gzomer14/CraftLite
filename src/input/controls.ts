/**
 * Camada única de input: junta teclado, mouse, toque e gamepad em um estado só.
 *
 * O resto do jogo não sabe de onde veio o comando — o que é exatamente o que o
 * doc 09 §4 pede ("todo controle de toque tem equivalente por teclado"), e o
 * que evita espalhar `if (isMobile)` pelo código.
 */

import { clamp, DEG2RAD } from '../core/math';
import type { SettingsStore } from '../game/settings';
import { Gamepads } from './gamepad';
import { Keyboard } from './keyboard';
import { Mouse } from './mouse';
import { TouchControls } from './touch';

const PITCH_LIMIT = 89.9 * DEG2RAD;

export interface ActionState {
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  breaking: boolean;
}

export interface ControlsCallbacks {
  onHotbarSelect: (index: number) => void;
  onHotbarScroll: (delta: number) => void;
  onPickBlock: () => void;
  onToggleDebug: () => void;
  onToggleFly: () => void;
  onPause: () => void;
  onInventory: () => void;
}

export class Controls {
  readonly keyboard: Keyboard;
  readonly mouse: Mouse;
  readonly touch: TouchControls;
  readonly gamepad = new Gamepads();

  readonly state: ActionState = {
    forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, breaking: false,
  };

  /** Pedido de colocar bloco neste tick — consumido pelo chamador. */
  private placeRequested = false;
  /** Mira do toque em NDC; quando ausente, mira no centro da tela. */
  hasAim = false;
  aimNdcX = 0;
  aimNdcY = 0;
  /** 0..1 do toque longo carregando, para o anel de progresso. */
  holdProgress = 0;

  private readonly look = new Float32Array(2);
  private readonly touchLook = new Float32Array(2);
  private readonly settings: SettingsStore;
  private mousePlacing = false;
  private mouseBreaking = false;
  /** Estados de "alternar em vez de segurar" (doc 09 §4). */
  private sprintLatched = false;
  private sneakLatched = false;

  constructor(canvas: HTMLCanvasElement, settings: SettingsStore, callbacks: ControlsCallbacks) {
    this.settings = settings;
    this.keyboard = new Keyboard();
    this.mouse = new Mouse(canvas);
    this.touch = new TouchControls(canvas, settings);

    this.mouse.sensitivity = settings.get('lookSensitivity');
    this.mouse.invertY = settings.get('invertY');
    settings.onChange((next) => {
      this.mouse.sensitivity = next.lookSensitivity;
      this.mouse.invertY = next.invertY;
    });

    this.bindKeyboard(callbacks);
    this.bindMouse(canvas, callbacks);
  }

  private bindKeyboard(callbacks: ControlsCallbacks): void {
    this.keyboard.bind('F3', (down) => { if (down) callbacks.onToggleDebug(); });
    this.keyboard.bind('Escape', (down) => { if (down) callbacks.onPause(); });
    this.keyboard.bind('KeyE', (down) => { if (down) callbacks.onInventory(); });
    for (let i = 0; i < 9; i++) {
      this.keyboard.bind(`Digit${i + 1}`, (down) => { if (down) callbacks.onHotbarSelect(i); });
    }

    // Duplo espaço alterna o voo no criativo (doc 06 §9).
    let lastJump = 0;
    this.keyboard.bind('Space', (down) => {
      if (!down) return;
      const now = performance.now();
      if (now - lastJump < 300) callbacks.onToggleFly();
      lastJump = now;
    });
  }

  private bindMouse(canvas: HTMLCanvasElement, callbacks: ControlsCallbacks): void {
    // Sem isto o cursor do sistema fica por cima do jogo e a câmera não gira.
    // O pointer lock **só** pode ser pedido a partir de um gesto do usuário.
    //
    // **Só o mouse pede lock.** Um toque curto também dispara `click`, e no
    // celular pedir pointer lock a partir dele é fatal: com o ponteiro travado
    // a spec manda congelar `clientX`/`clientY`, então todo dedo passa a
    // reportar o mesmo ponto. O joystick nasce no canto da tela, nunca sai do
    // raio morto e nenhum toque é mais classificado como "olhar" — ou seja,
    // andar e colocar bloco morrem juntos. Era o que acontecia ao colocar um
    // bloco no Modo A: arrastar o joystick não gera `click` (passa do limiar de
    // arraste), mas o toque curto de colocar gera.
    canvas.addEventListener('click', (e) => {
      if (!isMouseClick(e)) return;
      this.mouse.requestLock();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.mouse.locked) return;
      if (e.button === 0) this.mouseBreaking = true;
      if (e.button === 2) this.mousePlacing = true;
      if (e.button === 1) {
        e.preventDefault();
        callbacks.onPickBlock();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseBreaking = false;
      if (e.button === 2) this.mousePlacing = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (!this.mouse.locked) return;
      e.preventDefault();
      callbacks.onHotbarScroll(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }

  /**
   * Consolida tudo. Chamado uma vez por tick, antes de usar `state`.
   * Devolve o delta de câmera já aplicado a `yaw`/`pitch` do jogador.
   */
  update(applyLook: (yawDelta: number, pitchDelta: number) => void): void {
    this.touch.update();
    this.gamepad.poll();

    // --- câmera: mouse + arraste de toque + analógico direito ---
    this.mouse.consume(this.look);
    this.touch.consumeLook(this.touchLook);
    // O analógico entrega −1..1 por tick, não pixels: a escala é outra.
    const padSens = this.settings.get('lookSensitivity') * 22;
    const yawDelta = this.look[0] + this.touchLook[0] - this.gamepad.state.lookX * padSens;
    const pitchDelta = this.look[1] + this.touchLook[1]
      + (this.settings.get('invertY') ? -1 : 1) * this.gamepad.state.lookY * padSens;
    applyLook(yawDelta, pitchDelta);

    // --- movimento: teclado, joystick e analógico esquerdo somam ---
    const keyForward = this.keyboard.axis('KeyS', 'KeyW');
    const keyStrafe = this.keyboard.axis('KeyA', 'KeyD');
    const t = this.touch.state;
    const g = this.gamepad.state;

    let forward = keyForward + t.forward + g.forward;
    let strafe = keyStrafe + t.strafe + g.strafe;
    const length = Math.hypot(forward, strafe);
    if (length > 1) {
      forward /= length;
      strafe /= length;
    }
    this.state.forward = forward;
    this.state.strafe = strafe;

    // --- botões ---
    const jumpHeld = this.keyboard.isDown('Space') || this.touch.buttons.jump || g.jump;
    const sneakHeld = this.keyboard.isDown('ShiftLeft') || this.touch.buttons.sneak || g.sneak;
    const sprintHeld = this.keyboard.isDown('ControlLeft') || t.sprint > 0;

    this.state.jump = jumpHeld;
    this.state.sneak = this.settings.get('toggleSneak')
      ? this.latch('sneakLatched', sneakHeld) : sneakHeld;
    this.state.sprint = this.settings.get('toggleSprint')
      ? this.latch('sprintLatched', sprintHeld) : sprintHeld;

    this.state.breaking = (this.mouse.locked && this.mouseBreaking) || t.breaking || g.breaking;

    if (this.mouse.locked && this.mousePlacing) this.placeRequested = true;
    if (this.touch.consumePlace()) this.placeRequested = true;
    if (g.placing) this.placeRequested = true;

    // --- mira ---
    this.hasAim = t.hasAim;
    this.aimNdcX = t.aimNdcX;
    this.aimNdcY = t.aimNdcY;
    this.holdProgress = t.holdProgress;
  }

  /** "Alternar em vez de segurar": a borda de subida inverte o estado. */
  private latch(field: 'sprintLatched' | 'sneakLatched', held: boolean): boolean {
    const key = field === 'sprintLatched' ? 'sprintEdge' : 'sneakEdge';
    const edges = this.edges;
    if (held && edges[key] !== true) this[field] = !this[field];
    edges[key] = held;
    return this[field];
  }

  private readonly edges: Record<string, boolean> = {};

  /** Consome o pedido de colocar bloco. */
  consumePlace(): boolean {
    if (!this.placeRequested) return false;
    this.placeRequested = false;
    return true;
  }

  /** Limita o pitch e normaliza o yaw — usado por quem aplica o look. */
  static applyLookTo(target: { yaw: number; pitch: number }, yawDelta: number, pitchDelta: number): void {
    target.yaw = wrapAngle(target.yaw + yawDelta);
    target.pitch = clamp(target.pitch + pitchDelta, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Solta tudo — usado ao pausar, perder foco ou esconder a aba. */
  reset(): void {
    this.touch.reset();
    this.mouseBreaking = false;
    this.mousePlacing = false;
    this.state.forward = 0;
    this.state.strafe = 0;
    this.state.breaking = false;
  }
}

/**
 * true quando o `click` veio de um mouse de verdade.
 *
 * `click` é um `PointerEvent` nos navegadores atuais: toque reporta `'touch'`,
 * caneta `'pen'` e o mouse `'mouse'`. String vazia é o clique sintetizado pelo
 * teclado (Enter no elemento focado), que segue valendo lock.
 */
function isMouseClick(e: Event): boolean {
  const pointerType = (e as PointerEvent).pointerType;
  if (pointerType === undefined || pointerType === '') return true;
  return pointerType === 'mouse';
}

function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let v = a % twoPi;
  if (v > Math.PI) v -= twoPi;
  if (v < -Math.PI) v += twoPi;
  return v;
}
