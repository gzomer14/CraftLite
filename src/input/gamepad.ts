/**
 * Gamepad (doc 09 §3). Polling puro: não custa nada quando não há controle.
 *
 * O módulo não sabe **nada** sobre marca de controle: o que ele conhece é a
 * lista de ações do doc 09 e a tabela de perfis em `data/gamepads.ts`. Trocar
 * de DualSense para Xbox no meio da partida é o perfil sendo relido, e mais
 * nada.
 *
 * Três decisões que valem o comentário:
 *
 * 1. **O layout padrão é o caminho normal.** Quando o navegador reconhece o
 *    aparelho (`mapping === 'standard'`), os índices são os da especificação e
 *    valem para todo controle. O perfil só entra para os **rótulos** — e, se o
 *    navegador não reconhecer, para a ordem crua da família.
 * 2. **Gatilho é analógico.** `LT`/`RT` do Xbox e `L2`/`R2` do DualSense
 *    reportam `value` de 0 a 1, e tratar isso como booleano de `pressed`
 *    perderia o meio curso. O limiar é declarado, não mágico.
 * 3. **A borda de subida é por ação, não por índice de botão.** Com dois
 *    layouts possíveis, guardar o estado anterior por índice faria a troca de
 *    perfil disparar um evento fantasma.
 */

import {
  GENERIC_PROFILE, STANDARD_AXES, STANDARD_BUTTONS, profileFor,
  type PadAction, type PadLabels, type PadProfile,
} from '../data/gamepads';

/** Zona morta do analógico (doc 09 §3). */
export const DEFAULT_DEAD_ZONE = 0.15;
/** A partir de quanto um gatilho analógico conta como apertado. */
const TRIGGER_THRESHOLD = 0.35;
/** Acima disto, o analógico esquerdo faz o papel do direcional na interface. */
const STICK_AS_DPAD = 0.6;

/** Curva quadrática: precisão perto do centro, alcance na ponta (doc 09 §3). */
function curve(value: number, deadZone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < deadZone) return 0;
  const scaled = (magnitude - deadZone) / (1 - deadZone);
  return Math.sign(value) * scaled * scaled;
}

export interface GamepadState {
  forward: number;
  strafe: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  breaking: boolean;
  /** Consumidos uma vez (borda de subida). */
  /** Borda de subida do pulo: é o duplo toque que alterna o voo (doc 06 §9). */
  jumpPressed: boolean;
  placing: boolean;
  using: boolean;
  drop: boolean;
  hotbarPrev: boolean;
  hotbarNext: boolean;
  pause: boolean;
  inventory: boolean;
}

/** O que a navegação de interface lê — direcional mais confirmar/voltar. */
export interface NavState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
}

export class Gamepads {
  readonly state: GamepadState = {
    forward: 0, strafe: 0, lookX: 0, lookY: 0,
    jump: false, sneak: false, sprint: false, breaking: false,
    jumpPressed: false, placing: false, using: false, drop: false,
    hotbarPrev: false, hotbarNext: false, pause: false, inventory: false,
  };

  /**
   * Estado **contínuo** do direcional, para a navegação de interface. Ela tem
   * repetição própria (segurar anda de item em item), então precisa do botão
   * segurado e não da borda.
   */
  readonly nav: NavState = {
    up: false, down: false, left: false, right: false, confirm: false, cancel: false,
  };

  connected = false;
  /** Perfil do controle ligado agora. */
  profile: PadProfile = GENERIC_PROFILE;
  /** Perfil forçado nas opções, ou `null` para detectar sozinho. */
  forcedProfile: PadProfile | null = null;
  /** Id do controle, como o navegador o reporta — a tela de opções mostra. */
  padId = '';
  /** true quando o navegador **não** normalizou o layout (rede de segurança). */
  nonStandard = false;

  /** Zona morta, das opções. */
  deadZone = DEFAULT_DEAD_ZONE;
  /** Vibração ligada, das opções. */
  vibration = true;
  /**
   * A interface está com a palavra: o movimento e a câmera do controle ficam
   * zerados enquanto uma tela estiver aberta.
   *
   * Sem isto, o mesmo analógico que escolhe o botão no menu também anda com o
   * jogador no mundo por baixo — o inventário não pausa o mundo (doc 08 §4.2).
   */
  uiCapture = false;

  /**
   * Avisados quando um controle é ligado ou trocado.
   *
   * Lista e não campo único, como `SettingsStore.onChange` e
   * `Keybinds.onChange`: a dica da tela e o aviso do HUD querem os dois saber,
   * e com um campo só o segundo a registrar apagaria o primeiro.
   */
  private readonly listeners: ((profile: PadProfile, id: string) => void)[] = [];

  /** Registra um ouvinte de conexão; devolve como cancelar. */
  onConnect(fn: (profile: PadProfile, id: string) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Estado anterior **por ação**, para a borda de subida. */
  private readonly previous = new Map<PadAction, boolean>();
  private lastId = '';

  /** Rótulos do controle ligado (ou do genérico). */
  get labels(): PadLabels {
    return (this.forcedProfile ?? this.profile).labels;
  }

  /**
   * Polling completo: eixos, botões segurados e **bordas de subida**. Chamado
   * uma vez por tick de jogo, e só de lá.
   *
   * A borda é consumida aqui: quem chamar duas vezes no mesmo tick vê o
   * segundo aperto como "já estava apertado". É por isso que o laço de
   * navegação de interface usa `pollNav`, que não toca em borda nenhuma.
   */
  poll(): void {
    const pad = this.acquire();
    if (pad === null) {
      this.reset();
      return;
    }

    const profile = this.forcedProfile ?? this.profile;
    const axes = this.axesFor(profile);
    const s = this.state;

    const raw = (index: number): number => pad.axes[index] ?? 0;
    s.strafe = curve(raw(axes.moveX), this.deadZone);
    // O eixo Y do analógico cresce para baixo; "frente" é para cima. A negação
    // vai na **entrada** e não na saída: negar o resultado de um eixo parado
    // produz `-0`, que passa despercebido na conta e aparece na tela um dia.
    s.forward = curve(-raw(axes.moveY), this.deadZone);
    s.lookX = curve(raw(axes.lookX), this.deadZone);
    s.lookY = curve(raw(axes.lookY), this.deadZone);

    s.jump = this.held(pad, profile, 'jump');
    s.jumpPressed = this.rising(pad, profile, 'jump');
    s.sneak = this.held(pad, profile, 'sneak');
    s.sprint = this.held(pad, profile, 'sprint');
    s.breaking = this.held(pad, profile, 'break');
    s.placing = this.rising(pad, profile, 'place');
    s.using = this.rising(pad, profile, 'use');
    s.drop = this.rising(pad, profile, 'drop');
    s.hotbarPrev = this.rising(pad, profile, 'hotbarPrev');
    s.hotbarNext = this.rising(pad, profile, 'hotbarNext');
    s.pause = this.rising(pad, profile, 'start');
    s.inventory = this.rising(pad, profile, 'select');

    /*
     * Com uma tela aberta, o controle mexe na tela e não no mundo.
     *
     * `pause` e `inventory` **sobrevivem** de propósito: são justamente os
     * botões que fecham a tela aberta. Zerá-los junto prenderia o jogador
     * dentro do inventário sem nenhuma forma de sair pelo controle.
     */
    if (this.uiCapture) {
      s.forward = 0; s.strafe = 0; s.lookX = 0; s.lookY = 0;
      s.jump = false; s.sneak = false; s.sprint = false; s.breaking = false;
      s.jumpPressed = false; s.placing = false; s.using = false; s.drop = false;
    }
  }

  /**
   * Polling **só do direcional**, para a navegação de interface.
   *
   * Existe separado porque os dois laços têm relógios diferentes: a interface
   * é navegável desde a tela de título, muito antes de existir um tick de
   * jogo. Ele lê apenas estado segurado — nenhuma borda é consumida aqui, e
   * por isso os dois podem rodar no mesmo quadro sem roubar aperto um do
   * outro.
   */
  pollNav(): void {
    const pad = this.acquire();
    const n = this.nav;
    if (pad === null) {
      n.up = false; n.down = false; n.left = false; n.right = false;
      n.confirm = false; n.cancel = false;
      return;
    }
    const profile = this.forcedProfile ?? this.profile;
    const axes = this.axesFor(profile);
    const raw = (index: number): number => pad.axes[index] ?? 0;

    /*
     * Direcional **ou** analógico esquerdo. O analógico entra porque é onde o
     * polegar já está, e porque nem todo controle genérico reporta o
     * direcional nos índices 12–15.
     */
    n.up = this.held(pad, profile, 'dpadUp') || raw(axes.moveY) < -STICK_AS_DPAD;
    n.down = this.held(pad, profile, 'dpadDown') || raw(axes.moveY) > STICK_AS_DPAD;
    n.left = this.held(pad, profile, 'dpadLeft') || raw(axes.moveX) < -STICK_AS_DPAD;
    n.right = this.held(pad, profile, 'dpadRight') || raw(axes.moveX) > STICK_AS_DPAD;
    n.confirm = this.held(pad, profile, 'jump');
    n.cancel = this.held(pad, profile, 'sneak');
  }

  /** O controle ligado, já com perfil resolvido. `null` se não há nenhum. */
  private acquire(): Gamepad | null {
    const pad = firstConnected();
    this.connected = pad !== null;
    if (pad === null) return null;

    if (pad.id !== this.lastId) {
      this.lastId = pad.id;
      this.padId = pad.id;
      this.profile = profileFor(pad.id);
      this.previous.clear();
      const profile = this.forcedProfile ?? this.profile;
      for (const fn of this.listeners) fn(profile, pad.id);
    }
    // `mapping` vazio = o navegador não reconheceu o aparelho.
    this.nonStandard = pad.mapping !== 'standard';
    return pad;
  }

  /** Eixos do layout em vigor. */
  private axesFor(profile: PadProfile): typeof STANDARD_AXES {
    return this.nonStandard ? { ...STANDARD_AXES, ...profile.rawAxes } : STANDARD_AXES;
  }

  /**
   * Índice de um botão no layout em vigor.
   *
   * No layout padrão é sempre o da especificação. Fora dele, a família manda —
   * e o que ela não declarar cai no índice padrão, que é o melhor palpite
   * disponível e continua melhor que nada.
   */
  private indexOf(profile: PadProfile, action: PadAction): number {
    if (this.nonStandard) return profile.rawButtons?.[action] ?? STANDARD_BUTTONS[action];
    return STANDARD_BUTTONS[action];
  }

  /** Botão segurado agora. Gatilho analógico passa pelo limiar. */
  private held(pad: Gamepad, profile: PadProfile, action: PadAction): boolean {
    const button = pad.buttons[this.indexOf(profile, action)];
    if (button === undefined) return false;
    return button.pressed || button.value > TRIGGER_THRESHOLD;
  }

  /** Borda de subida da ação, consumida nesta chamada. */
  private rising(pad: Gamepad, profile: PadProfile, action: PadAction): boolean {
    const now = this.held(pad, profile, action);
    const was = this.previous.get(action) === true;
    this.previous.set(action, now);
    return now && !was;
  }

  /** Zera tudo — controle desligado, ou aba perdendo o foco. */
  reset(): void {
    const s = this.state;
    s.forward = 0; s.strafe = 0; s.lookX = 0; s.lookY = 0;
    s.jump = false; s.sneak = false; s.sprint = false; s.breaking = false;
    s.jumpPressed = false; s.placing = false; s.using = false; s.drop = false;
    s.hotbarPrev = false; s.hotbarNext = false; s.pause = false; s.inventory = false;
    const n = this.nav;
    n.up = false; n.down = false; n.left = false; n.right = false;
    n.confirm = false; n.cancel = false;
    this.previous.clear();
  }

  /** Vibração leve ao quebrar bloco (doc 09 §3), quando o controle suportar. */
  rumble(ms = 40, strength = 0.35): void {
    if (!this.vibration) return;
    const pad = firstConnected();
    const actuator = (pad as (Gamepad & {
      vibrationActuator?: { playEffect: (type: string, options: object) => Promise<unknown> };
    }) | null)?.vibrationActuator;
    if (actuator === undefined) return;
    void actuator.playEffect('dual-rumble', {
      duration: ms, strongMagnitude: strength, weakMagnitude: strength,
    }).catch(() => { /* controle sem suporte a esse efeito */ });
  }
}

/** O primeiro controle conectado, ou `null`. */
function firstConnected(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const pad of pads) {
    if (pad !== null && pad.connected) return pad;
  }
  return null;
}
