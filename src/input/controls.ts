/**
 * Camada única de input: junta teclado, mouse, toque e gamepad em um estado só.
 *
 * O resto do jogo não sabe de onde veio o comando — o que é exatamente o que o
 * doc 09 §4 pede ("todo controle de toque tem equivalente por teclado"), e o
 * que evita espalhar `if (isMobile)` pelo código.
 */

import { clamp, DEG2RAD } from '../core/math';
import { TICK_MS } from '../core/loop';
import type { SettingsStore } from '../game/settings';
import { Gamepads } from './gamepad';
import { Keybinds } from './keybinds';
import { Keyboard } from './keyboard';
import { Mouse } from './mouse';
import { TouchControls } from './touch';
import type { ActionId } from '../data/keybinds';

const PITCH_LIMIT = 89.9 * DEG2RAD;
/** Teto do passo de integração da câmera: um engasgo não vira um giro. */
const MAX_LOOK_STEP_MS = 100;

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
  /** Largar o item da mão: 1 unidade, ou o stack inteiro com Ctrl (doc 08 §3.5). */
  onDropItem: (whole: boolean) => void;
}

export class Controls {
  readonly keyboard: Keyboard;
  readonly mouse: Mouse;
  readonly touch: TouchControls;
  readonly gamepad: Gamepads;
  /** Mapa de teclas do jogador (doc 08 §3.11). */
  readonly keybinds: Keybinds;

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
  private readonly callbacks: ControlsCallbacks;
  private mousePlacing = false;
  private mouseBreaking = false;
  /** Estados de "alternar em vez de segurar" (doc 09 §4). */
  private sprintLatched = false;
  private sneakLatched = false;
  /** Instante do último pulo de controle, para o duplo toque do voo. */
  private lastPadJump = 0;

  constructor(
    canvas: HTMLCanvasElement, settings: SettingsStore, callbacks: ControlsCallbacks,
    keybinds: Keybinds = new Keybinds(), gamepads: Gamepads = new Gamepads(),
  ) {
    this.settings = settings;
    this.keybinds = keybinds;
    /*
     * O controle nasce **antes** do mundo, como as teclas: a tela de título é
     * navegável por gamepad e precisa da mesma instância que o jogo vai usar
     * depois — senão o polling da borda de subida recomeça do zero ao entrar
     * no mundo e o primeiro aperto de botão se perde.
     */
    this.gamepad = gamepads;
    this.callbacks = callbacks;
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
    // Remapear em jogo refaz os binds na hora: a tela de opções fica aberta por
    // cima do mundo, e a tecla nova tem que valer ao fechar.
    keybinds.onChange(() => this.bindKeyboard(callbacks));
  }

  /** Teclas que `bindKeyboard` registrou, para desfazer no remapeamento. */
  private bound: string[] = [];

  private bindKeyboard(callbacks: ControlsCallbacks): void {
    for (const code of this.bound) this.keyboard.unbind(code);
    this.bound = [];

    // `Escape` e os dígitos da hotbar são fixos (ver `data/keybinds.ts`).
    this.keyboard.bind('Escape', (down) => { if (down) callbacks.onPause(); });
    for (let i = 0; i < 9; i++) {
      this.keyboard.bind(`Digit${i + 1}`, (down) => { if (down) callbacks.onHotbarSelect(i); });
    }

    this.bindAction('debug', (down) => { if (down) callbacks.onToggleDebug(); });
    this.bindAction('inventory', (down) => { if (down) callbacks.onInventory(); });
    // Ctrl larga o stack inteiro; sozinho, larga um (doc 08 §3.5).
    this.bindAction('drop', (down) => {
      if (down) callbacks.onDropItem(this.keyboard.isDown(this.keybinds.codeFor('sprint')));
    });

    // Duplo toque no pulo alterna o voo no criativo (doc 06 §9).
    let lastJump = 0;
    this.bindAction('jump', (down) => {
      if (!down) return;
      const now = performance.now();
      if (now - lastJump < 300) callbacks.onToggleFly();
      lastJump = now;
    });
  }

  private bindAction(id: ActionId, action: (down: boolean) => void): void {
    const code = this.keybinds.codeFor(id);
    if (code === '') return;
    this.bound.push(code);
    this.keyboard.bind(code, action);
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
   * A câmera, **uma vez por quadro desenhado** e não por tick.
   *
   * É a única parte do input que não roda a 20 Hz, e o motivo é visível: a
   * rotação não é interpolada no render — `camera.yaw` recebe `player.yaw`
   * direto —, então girar a 20 Hz num display de 60 ou 120 Hz mostra o mesmo
   * ângulo por dois ou seis quadros seguidos e depois pula. O jogo roda liso e
   * a câmera anda "de quadro em quadro, como movimento por teclado" (relato de
   * campo 2026-09-14).
   *
   * Interpolar a rotação como se interpola a posição não resolveria: a posição
   * é simulada e tem estado anterior de verdade, enquanto a câmera é **input**.
   * Interpolar input só adiciona um tick de atraso e continua entregando a
   * velocidade em degraus, porque o passo ainda seria de 50 ms. Ler o mouse
   * quando se desenha é o que todo jogo de primeira pessoa faz.
   *
   * `dtMs` é a duração do quadro. Mouse e dedo entregam **pixels acumulados**
   * desde a última leitura e não são escalados; o analógico entrega
   * **velocidade** (−1..1) e é multiplicado pelo tempo, senão girar mais rápido
   * dependeria do FPS.
   */
  updateLook(dtMs: number, applyLook: (yawDelta: number, pitchDelta: number) => void): void {
    this.mouse.consume(this.look);
    this.touch.consumeLook(this.touchLook);
    // O analógico tem multiplicador próprio — mão no mouse e polegar no
    // analógico não querem a mesma sensibilidade.
    /*
     * `dtMs` é a duração do **quadro anterior**, que é o que se tem na hora de
     * desenhar o atual — é a conta padrão de integração por quadro. Ela vem
     * limitada: zero no primeiro quadro, e um engasgo de 250 ms faria o
     * analógico girar cinco vezes mais de uma vez só.
     */
    const step = Math.min(Math.max(dtMs, 1), MAX_LOOK_STEP_MS) / TICK_MS;
    const padSens = this.settings.get('lookSensitivity') * 22
      * this.settings.get('padSensitivity') * step;
    const yawDelta = this.look[0] + this.touchLook[0] - this.gamepad.state.lookX * padSens;
    const pitchDelta = this.look[1] + this.touchLook[1]
      + (this.settings.get('invertY') ? -1 : 1) * this.gamepad.state.lookY * padSens;
    if (yawDelta === 0 && pitchDelta === 0) return;
    applyLook(yawDelta, pitchDelta);
  }

  /**
   * Consolida o resto. Chamado uma vez por tick, antes de usar `state`.
   *
   * A câmera **não** sai daqui: ela é por quadro, em `updateLook`.
   */
  update(): void {
    this.touch.update();
    this.gamepad.poll();

    // --- movimento: teclado, joystick e analógico esquerdo somam ---
    const keys = this.keybinds;
    const keyForward = this.keyboard.axis(keys.codeFor('back'), keys.codeFor('forward'));
    const keyStrafe = this.keyboard.axis(keys.codeFor('left'), keys.codeFor('right'));
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
    const jumpHeld = this.keyboard.isDown(keys.codeFor('jump')) || this.touch.buttons.jump || g.jump;
    const sneakHeld = this.keyboard.isDown(keys.codeFor('sneak'))
      || this.touch.buttons.sneak || g.sneak;
    const sprintHeld = this.keyboard.isDown(keys.codeFor('sprint')) || t.sprint > 0 || g.sprint;

    this.state.jump = jumpHeld;
    this.state.sneak = this.settings.get('toggleSneak')
      ? this.latch('sneakLatched', sneakHeld) : sneakHeld;
    this.state.sprint = this.settings.get('toggleSprint')
      ? this.latch('sprintLatched', sprintHeld) : sprintHeld;

    this.state.breaking = (this.mouse.locked && this.mouseBreaking) || t.breaking || g.breaking;

    if (this.mouse.locked && this.mousePlacing) this.placeRequested = true;
    if (this.touch.consumePlace()) this.placeRequested = true;
    // Um caminho só: o gatilho esquerdo (doc 09 §3). Ele era dois — o □ também
    // colocava —, e a duplicata foi desfeita quando o □ virou o botão da
    // mochila.
    if (g.placing) this.placeRequested = true;

    /*
     * As ações de borda do controle, que até aqui eram **calculadas e jogadas
     * fora**: pausa, inventário e rolagem de hotbar existiam em `GamepadState`
     * desde o M3 e nada as consumia. Na prática, quem jogasse de controle
     * andava, olhava, pulava e quebrava — e não conseguia abrir a mochila nem
     * pausar o jogo.
     */
    const cb = this.callbacks;
    /*
     * Duplo toque no pulo alterna o voo no criativo (doc 06 §9) — a mesma
     * regra do teclado. Sem isto, quem joga de controle no criativo não voa,
     * e voar é metade do modo.
     */
    if (g.jumpPressed) {
      const now = performance.now();
      if (now - this.lastPadJump < 300) cb.onToggleFly();
      this.lastPadJump = now;
    }
    if (g.pause) cb.onPause();
    if (g.inventory) cb.onInventory();
    if (g.hotbarPrev) cb.onHotbarScroll(-1);
    if (g.hotbarNext) cb.onHotbarScroll(1);
    if (g.drop) cb.onDropItem(false);

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
    // Perder o foco com o gatilho apertado deixaria o jogador quebrando o
    // mundo sozinho ao voltar — e a borda de subida guardada faria o primeiro
    // aperto de volta ser engolido.
    this.gamepad.reset();
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
