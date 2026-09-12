/**
 * Gamepad (doc 09 §3). É bônus barato: a API é polling puro, então cabe em
 * pouco código e não custa nada quando não há controle conectado.
 */

/** Zona morta do analógico, com curva quadrática para precisão perto do centro. */
const DEAD_ZONE = 0.15;

function curve(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < DEAD_ZONE) return 0;
  const scaled = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(value) * scaled * scaled;
}

export interface GamepadState {
  forward: number;
  strafe: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  sneak: boolean;
  breaking: boolean;
  placing: boolean;
  /** Consumidos uma vez. */
  hotbarPrev: boolean;
  hotbarNext: boolean;
  pause: boolean;
  inventory: boolean;
}

export class Gamepads {
  readonly state: GamepadState = {
    forward: 0, strafe: 0, lookX: 0, lookY: 0,
    jump: false, sneak: false, breaking: false, placing: false,
    hotbarPrev: false, hotbarNext: false, pause: false, inventory: false,
  };

  connected = false;
  /** Botões do frame anterior, para detectar a borda de subida. */
  private readonly previous = new Uint8Array(20);

  /** Faz o polling. Chamado uma vez por tick. */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate !== null && candidate.connected) { pad = candidate; break; }
    }
    this.connected = pad !== null;
    if (pad === null) {
      this.state.forward = 0;
      this.state.strafe = 0;
      return;
    }

    const axes = pad.axes;
    const s = this.state;
    s.strafe = curve(axes[0] ?? 0);
    s.forward = -curve(axes[1] ?? 0);
    s.lookX = curve(axes[2] ?? 0);
    s.lookY = curve(axes[3] ?? 0);

    const pressed = (index: number): boolean => pad.buttons[index]?.pressed === true;
    const rising = (index: number): boolean => {
      const now = pressed(index) ? 1 : 0;
      const was = this.previous[index];
      this.previous[index] = now;
      return now === 1 && was === 0;
    };

    s.jump = pressed(0);          // A
    s.sneak = pressed(1);         // B
    s.breaking = pressed(7);      // RT
    s.placing = rising(2);        // X
    s.hotbarPrev = rising(4);     // LB
    s.hotbarNext = rising(5);     // RB
    s.pause = rising(9);          // Start
    s.inventory = rising(8);      // Select
  }

  /** Vibração leve ao quebrar bloco, quando o controle suportar. */
  rumble(ms = 40, strength = 0.35): void {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      const actuator = (pad as Gamepad & {
        vibrationActuator?: { playEffect: (type: string, options: object) => Promise<unknown> };
      })?.vibrationActuator;
      if (actuator === undefined) continue;
      void actuator.playEffect('dual-rumble', {
        duration: ms, strongMagnitude: strength, weakMagnitude: strength,
      }).catch(() => { /* controle sem suporte */ });
      return;
    }
  }
}
