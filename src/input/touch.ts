/**
 * Controles de toque (doc 09 §2).
 *
 * O celular antigo é o alvo principal, não uma adaptação — então o multitoque
 * tem que ser real: andar, olhar e pular ao mesmo tempo precisa funcionar. Cada
 * dedo é rastreado por `pointerId` em um `Map`, e `pointercancel` (chamada,
 * notificação) reseta só aquele dedo.
 *
 * Dois modos de interação, com o **A como padrão**:
 *  - **A** — toque curto coloca, toque longo quebra, e o raycast parte da
 *    posição do dedo, não do centro da tela.
 *  - **B** — botões dedicados de quebrar/colocar, mira fixa no centro.
 */

import type { Settings, SettingsStore } from '../game/settings';

/** Raio morto e raio máximo do joystick, em px CSS (doc 09 §2.1). */
const DEAD_RADIUS = 8;
const MAX_RADIUS = 60;
/** Empurrar até o limite por este tempo ativa a corrida. */
const SPRINT_HOLD_MS = 300;
/**
 * Folga do **toque curto**, em px CSS: acima disso o gesto foi um arraste de
 * câmera e não um toque.
 *
 * Eram 10 px, medidos desde o ponto inicial. Num celular na mão, com o outro
 * polegar mexendo o joystick, 10 px de deriva acontecem em quase todo toque —
 * e o resultado era o jogo "não detectar" que o jogador tocou (relato de campo
 * 2026-09-14). Dezesseis é a folga que os navegadores usam para o próprio
 * `click`.
 */
const TAP_SLOP = 16;
/**
 * Folga do **toque longo**. Maior que a do toque curto de propósito: o dedo
 * parado ainda escorrega enquanto o aparelho balança na mão, e cancelar a
 * quebra por isso é o que fazia segurar não funcionar.
 *
 * Sair desta folga não cancela nada: apenas **reinicia a contagem** a partir da
 * posição nova, que é como todo toque longo com folga funciona.
 */
const HOLD_SLOP = 28;
/** Multiplicador do arraste sobre a sensibilidade base — ver `onMove`. */
const TOUCH_LOOK_SCALE = 2.0;

/** Um dedo ativo e o papel que assumiu. */
interface Finger {
  role: 'move' | 'look' | 'none';
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
  /** Maior distância já percorrida desde o início — decide o toque curto. */
  maxDistance: number;
  /**
   * Âncora do toque longo e o instante em que ela foi posta.
   *
   * Sair de `HOLD_SLOP` reancora aqui e reinicia a contagem, em vez de cancelar
   * a quebra para sempre.
   */
  anchorX: number;
  anchorY: number;
  anchorTime: number;
  /** A quebra já começou: deriva não cancela mais, e o dedo para de girar a câmera. */
  breaking: boolean;
  /** Já está no limite do joystick desde este instante (para a corrida). */
  atLimitSince: number;
}

export interface TouchState {
  /** −1..1, prontos para virar `PlayerInput`. */
  forward: number;
  strafe: number;
  sprint: number;
  /** Quebrando neste frame (modo A: toque longo; modo B: botão). */
  breaking: boolean;
  /** Pediu para colocar neste frame — consumido uma vez. */
  placeRequested: boolean;
  /** Ponto do dedo que está interagindo, em NDC. `null` = usar o centro. */
  aimNdcX: number;
  aimNdcY: number;
  hasAim: boolean;
  /** 0..1 do toque longo, para o anel de progresso. */
  holdProgress: number;
}

export interface TouchButtons {
  jump: boolean;
  sneak: boolean;
  /** Alterna voo — consumido uma vez. */
  flyToggleRequested: boolean;
}

export class TouchControls {
  private readonly canvas: HTMLElement;
  private readonly settings: SettingsStore;
  private readonly fingers = new Map<number, Finger>();

  /** Delta de câmera acumulado entre ticks. */
  private lookX = 0;
  private lookY = 0;
  /** Onde o último toque curto pediu para colocar, em px CSS. */
  private pendingPlaceX = 0;
  private pendingPlaceY = 0;

  readonly state: TouchState = {
    forward: 0, strafe: 0, sprint: 0,
    breaking: false, placeRequested: false,
    aimNdcX: 0, aimNdcY: 0, hasAim: false, holdProgress: 0,
  };

  readonly buttons: TouchButtons = { jump: false, sneak: false, flyToggleRequested: false };

  /** Estado visual do joystick, lido pela camada de UI. */
  readonly joystick = { active: false, originX: 0, originY: 0, x: 0, y: 0, sprinting: false };

  /** true quando algum dedo tocou a tela — habilita fullscreen e áudio. */
  everTouched = false;

  /** Disparado no primeiro toque, para fullscreen e lock de orientação. */
  onFirstTouch: (() => void) | null = null;

  constructor(canvas: HTMLElement, settings: SettingsStore) {
    this.canvas = canvas;
    this.settings = settings;

    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    /*
     * **`pointerleave` não conta como soltar o dedo.**
     *
     * Ele dispara quando o ponteiro sai da área do elemento — e um dedo que
     * encosta na borda da tela, ou que passa por cima de um botão do HUD,
     * gerava um "soltou" falso. Num toque curto isso **coloca um bloco** que
     * ninguém pediu; num toque longo, cancela a quebra no meio. Era uma das
     * fontes do "vira e mexe ela falha" relatado em campo (2026-09-14).
     *
     * A rede de segurança contra dedo perdido é ouvir no `window`: se a captura
     * de ponteiro falhar e o `pointerup` não vier no canvas, ele vem aqui.
     */
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    }
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return; // o mouse tem caminho próprio
    e.preventDefault();
    if (!this.everTouched) {
      this.everTouched = true;
      this.onFirstTouch?.();
    }
    // `setPointerCapture` garante que o dedo continue reportando mesmo se sair
    // do elemento — sem isso o joystick trava ao arrastar para fora.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Alguns navegadores recusam captura em pointers já liberados.
    }

    const role = this.roleFor(e.clientX);
    const now = performance.now();
    const finger: Finger = {
      role,
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,
      startTime: now,
      maxDistance: 0,
      anchorX: e.clientX, anchorY: e.clientY, anchorTime: now,
      breaking: false,
      atLimitSince: 0,
    };
    this.fingers.set(e.pointerId, finger);

    if (role === 'move') {
      this.joystick.active = true;
      this.joystick.originX = e.clientX;
      this.joystick.originY = e.clientY;
      this.joystick.x = e.clientX;
      this.joystick.y = e.clientY;
      this.joystick.sprinting = false;
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    const finger = this.fingers.get(e.pointerId);
    if (finger === undefined) return;
    e.preventDefault();

    const dx = e.clientX - finger.x;
    const dy = e.clientY - finger.y;
    finger.x = e.clientX;
    finger.y = e.clientY;

    const fromStart = Math.hypot(e.clientX - finger.startX, e.clientY - finger.startY);
    if (fromStart > finger.maxDistance) finger.maxDistance = fromStart;

    // Saiu da folga do toque longo: reancora e recomeça a contar.
    if (Math.hypot(e.clientX - finger.anchorX, e.clientY - finger.anchorY) > HOLD_SLOP) {
      finger.anchorX = e.clientX;
      finger.anchorY = e.clientY;
      finger.anchorTime = performance.now();
    }

    /*
     * Um dedo que está quebrando **não gira mais a câmera**.
     *
     * Ele é o mesmo polegar que mira: deixar a deriva dele girar a cena tirava
     * o alvo de baixo do dedo no meio da quebra, e a barra de progresso voltava
     * do zero sozinha. Quem quer virar solta e vira.
     */
    if (finger.role === 'look' && !finger.breaking) {
      /*
       * Escala do arraste sobre a sensibilidade base (rad por pixel de mouse).
       *
       * O dedo percorre muito menos distância que o mouse, então precisa de
       * mais rotação por pixel — mas só um pouco. Com 2.0 e a sensibilidade
       * padrão dá 0,0044 rad/px ≈ 0,25°/px: arrastar meia tela (~400 px) gira
       * cerca de 100°, que é o que a mão espera.
       *
       * O valor anterior era 55, herdado de uma leitura errada do doc — dava
       * 6,9° por pixel e tornava a câmera incontrolável no celular.
       */
      const sens = this.settings.get('lookSensitivity') * TOUCH_LOOK_SCALE;
      this.lookX -= dx * sens;
      this.lookY += (this.settings.get('invertY') ? -dy : dy) * sens;
    } else if (finger.role === 'move') {
      this.joystick.x = e.clientX;
      this.joystick.y = e.clientY;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    const finger = this.fingers.get(e.pointerId);
    if (finger === undefined) return;
    this.fingers.delete(e.pointerId);

    if (finger.role === 'move') {
      this.joystick.active = false;
      this.joystick.sprinting = false;
      this.state.forward = 0;
      this.state.strafe = 0;
      this.state.sprint = 0;
    } else if (finger.role === 'look' && this.settings.get('touchMode') === 'A') {
      const held = performance.now() - finger.startTime;
      /*
       * Toque curto e parado = colocar bloco (doc 09 §2.2).
       *
       * A mira vai para `pendingPlace` e **não** direto para `state`: o
       * `update()` do tick seguinte roda antes de alguém ler `state.hasAim`, e
       * limpava a mira que este toque acabou de definir. O efeito era colocar
       * bloco sempre no centro da tela enquanto quebrar usava o dedo — os dois
       * gestos com alvos diferentes, que é exatamente a confusão relatada em
       * campo (2026-09-14).
       */
      if (!finger.breaking && finger.maxDistance <= TAP_SLOP
        && held < this.settings.get('longPressMs')) {
        this.state.placeRequested = true;
        this.pendingPlaceX = finger.x;
        this.pendingPlaceY = finger.y;
      }
    }
  };

  /** Qual papel um toque assume, conforme a metade da tela e a mão dominante. */
  private roleFor(clientX: number): Finger['role'] {
    const half = this.canvas.clientWidth / 2;
    const isLeftSide = clientX < half;
    const moveOnLeft = !this.settings.get('leftHanded');
    return isLeftSide === moveOnLeft ? 'move' : 'look';
  }

  /**
   * Recalcula o estado derivado. Chamado uma vez por tick, antes de ler
   * `state` — é aqui que o joystick vira `forward`/`strafe` e o toque longo
   * vira `breaking`.
   */
  update(): void {
    const now = performance.now();
    const settings = this.settings.current;

    this.updateJoystick(now);
    this.updateInteraction(now, settings);
  }

  private updateJoystick(now: number): void {
    if (!this.joystick.active) return;
    const dx = this.joystick.x - this.joystick.originX;
    const dy = this.joystick.y - this.joystick.originY;
    const distance = Math.hypot(dx, dy);

    if (distance <= DEAD_RADIUS) {
      this.state.forward = 0;
      this.state.strafe = 0;
      this.state.sprint = 0;
      this.joystick.sprinting = false;
      return;
    }

    const clamped = Math.min(distance, MAX_RADIUS);
    const magnitude = (clamped - DEAD_RADIUS) / (MAX_RADIUS - DEAD_RADIUS);
    // Y da tela cresce para baixo; para frente é o negativo.
    this.state.forward = (-dy / distance) * magnitude;
    this.state.strafe = (dx / distance) * magnitude;

    // Empurrar até o limite por 300 ms ativa a corrida (doc 09 §2.1).
    const atLimit = distance >= MAX_RADIUS * 0.95;
    const finger = this.moveFinger();
    if (finger !== undefined) {
      if (atLimit) {
        if (finger.atLimitSince === 0) finger.atLimitSince = now;
        else if (now - finger.atLimitSince >= SPRINT_HOLD_MS) this.joystick.sprinting = true;
      } else {
        finger.atLimitSince = 0;
        this.joystick.sprinting = false;
      }
    }
    this.state.sprint = this.joystick.sprinting ? 1 : 0;
  }

  private updateInteraction(now: number, settings: Readonly<Settings>): void {
    if (settings.touchMode !== 'A') {
      // No modo B quem controla quebrar/colocar são os botões dedicados.
      this.state.holdProgress = 0;
      return;
    }

    this.state.breaking = false;
    this.state.holdProgress = 0;

    for (const finger of this.fingers.values()) {
      if (finger.role !== 'look') continue;
      // A contagem é a partir da **âncora**, que a deriva reinicia; quem já
      // está quebrando não é mais cancelado por deriva nenhuma.
      const held = now - finger.anchorTime;
      const progress = held / settings.longPressMs;
      if (finger.breaking || progress >= 1) {
        finger.breaking = true;
        this.state.breaking = true;
        this.setAim(finger.x, finger.y);
        this.state.holdProgress = 1;
      } else {
        this.state.holdProgress = Math.max(this.state.holdProgress, progress);
      }
    }

    /*
     * A mira do toque curto sobrevive até alguém consumir o pedido.
     *
     * Ela é posta no `pointerup`, que acontece **entre** ticks; sem guardá-la
     * aqui, este mesmo método a apagaria antes de o jogo ler — e o bloco ia
     * para o centro da tela.
     */
    if (!this.state.breaking && this.state.placeRequested) {
      this.setAim(this.pendingPlaceX, this.pendingPlaceY);
    } else if (!this.state.breaking && this.state.holdProgress === 0) {
      this.state.hasAim = false;
    }
  }

  private moveFinger(): Finger | undefined {
    for (const finger of this.fingers.values()) {
      if (finger.role === 'move') return finger;
    }
    return undefined;
  }

  private setAim(clientX: number, clientY: number): void {
    this.state.aimNdcX = (clientX / this.canvas.clientWidth) * 2 - 1;
    this.state.aimNdcY = 1 - (clientY / this.canvas.clientHeight) * 2;
    this.state.hasAim = true;
  }

  /** Consome o delta de câmera acumulado. Escreve em `out` (2 elementos). */
  consumeLook(out: Float32Array): void {
    out[0] = this.lookX;
    out[1] = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Consome o pedido de colocar, se houver. */
  consumePlace(): boolean {
    if (!this.state.placeRequested) return false;
    this.state.placeRequested = false;
    return true;
  }

  consumeFlyToggle(): boolean {
    if (!this.buttons.flyToggleRequested) return false;
    this.buttons.flyToggleRequested = false;
    return true;
  }

  /** Quantos dedos estão na tela — o gesto de 3 dedos abre o debug. */
  get fingerCount(): number {
    return this.fingers.size;
  }

  /** Solta tudo. Usado ao pausar ou perder o foco. */
  reset(): void {
    this.fingers.clear();
    this.joystick.active = false;
    // Zerar a origem também: um joystick meio-preso ressuscitava no canto da
    // tela ao voltar da pausa, com a origem do toque anterior.
    this.joystick.originX = 0;
    this.joystick.originY = 0;
    this.joystick.x = 0;
    this.joystick.y = 0;
    this.state.placeRequested = false;
    this.state.hasAim = false;
    this.state.forward = 0;
    this.state.strafe = 0;
    this.state.sprint = 0;
    this.state.breaking = false;
    this.state.holdProgress = 0;
    this.buttons.jump = false;
    this.buttons.sneak = false;
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onUp);
  }
}
