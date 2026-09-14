/**
 * Gamepad (doc 09 §3). Polling puro: não custa nada quando não há controle.
 *
 * O módulo não sabe **nada** sobre marca de controle nem sobre qual botão faz
 * o quê: o que ele conhece é a lista de intenções do doc 09 e as tabelas de
 * `data/gamepads.ts` — `STANDARD_BUTTONS` diz onde cada botão fica e
 * `PAD_BINDINGS` diz o que ele dispara. Trocar de DualSense para Xbox no meio
 * da partida é o perfil sendo relido, e mais nada.
 *
 * Quatro decisões que valem o comentário:
 *
 * 1. **O layout padrão é o caminho normal.** Quando o navegador reconhece o
 *    aparelho (`mapping === 'standard'`), os índices são os da especificação e
 *    valem para todo controle. O perfil só entra para os **rótulos** — e, se o
 *    navegador não reconhecer, para a ordem crua da família.
 * 2. **Gatilho é analógico.** `LT`/`RT` do Xbox e `L2`/`R2` do DualSense
 *    reportam `value` de 0 a 1, e tratar isso como booleano de `pressed`
 *    perderia o meio curso. O limiar é declarado, não mágico.
 * 3. **A borda de subida é por intenção, não por índice de botão.** Com dois
 *    layouts possíveis, guardar o estado anterior por índice faria a troca de
 *    perfil disparar um evento fantasma.
 * 4. **`reset` silencia até soltar, e não esquece.** Ver o comentário do
 *    método: esquecer o que estava apertado foi a causa do menu que abria e
 *    fechava sozinho.
 */

import {
  GENERIC_PROFILE, PAD_BINDINGS, STANDARD_AXES, STANDARD_BUTTONS, profileFor,
  type PadButton, type PadIntent, type PadLabels, type PadProfile,
} from '../data/gamepads';

/** Zona morta do analógico (doc 09 §3). */
export const DEFAULT_DEAD_ZONE = 0.15;
/** A partir de quanto um gatilho analógico conta como apertado. */
const TRIGGER_THRESHOLD = 0.35;
/** Acima disto, o analógico esquerdo faz o papel do direcional na interface. */
const STICK_AS_DPAD = 0.6;

/** Todas as intenções, para varrer na hora de silenciar. */
const ALL_INTENTS = Object.keys(PAD_BINDINGS) as PadIntent[];

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
  drop: boolean;
  hotbarPrev: boolean;
  hotbarNext: boolean;
  pause: boolean;
  inventory: boolean;
}

/**
 * O que a navegação de interface lê: direcional, confirmar/voltar, o clique
 * secundário e a posição do analógico direito, que vira cursor nos menus.
 */
export interface NavState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
  /** Botão direito do mouse: pegar metade, soltar um de cada vez. */
  secondary: boolean;
  /** Analógico direito, −1..1, já com zona morta. Move o cursor da tela. */
  cursorX: number;
  cursorY: number;
}

export class Gamepads {
  readonly state: GamepadState = {
    forward: 0, strafe: 0, lookX: 0, lookY: 0,
    jump: false, sneak: false, sprint: false, breaking: false,
    jumpPressed: false, placing: false, drop: false,
    hotbarPrev: false, hotbarNext: false, pause: false, inventory: false,
  };

  /**
   * Estado **contínuo** do direcional, para a navegação de interface. Ela tem
   * repetição própria (segurar anda de item em item), então precisa do botão
   * segurado e não da borda.
   */
  readonly nav: NavState = {
    up: false, down: false, left: false, right: false,
    confirm: false, cancel: false, secondary: false, cursorX: 0, cursorY: 0,
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

  /** Estado anterior **por intenção**, para a borda de subida. */
  private readonly previous = new Map<PadIntent, boolean>();
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
    s.drop = this.rising(pad, profile, 'drop');
    s.hotbarPrev = this.rising(pad, profile, 'hotbarPrev');
    s.hotbarNext = this.rising(pad, profile, 'hotbarNext');
    s.pause = this.rising(pad, profile, 'pause');
    s.inventory = this.rising(pad, profile, 'inventory');

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
      s.jumpPressed = false; s.placing = false; s.drop = false;
      s.hotbarPrev = false; s.hotbarNext = false;
    }
  }

  /**
   * Polling **só do que a interface usa**: direcional, confirmar/voltar e o
   * analógico direito.
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
      n.confirm = false; n.cancel = false; n.secondary = false;
      n.cursorX = 0; n.cursorY = 0;
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
    n.up = this.held(pad, profile, 'navUp') || raw(axes.moveY) < -STICK_AS_DPAD;
    n.down = this.held(pad, profile, 'navDown') || raw(axes.moveY) > STICK_AS_DPAD;
    n.left = this.held(pad, profile, 'navLeft') || raw(axes.moveX) < -STICK_AS_DPAD;
    n.right = this.held(pad, profile, 'navRight') || raw(axes.moveX) > STICK_AS_DPAD;
    n.confirm = this.held(pad, profile, 'navConfirm');
    n.cancel = this.held(pad, profile, 'navCancel');
    n.secondary = this.held(pad, profile, 'navSecondary');
    // O analógico direito vira cursor com a tela aberta e volta a ser câmera
    // quando ela fecha — quem decide é `UiNavigator`, que só lê isto quando há
    // camada aberta.
    n.cursorX = curve(raw(axes.lookX), this.deadZone);
    n.cursorY = curve(raw(axes.lookY), this.deadZone);
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
      /*
       * Controle novo: sem memória, e **não** silenciado.
       *
       * A Gamepad API só revela o aparelho depois do primeiro aperto — um
       * botão apertado no instante em que ele aparece é justamente o aperto
       * que o acordou. Engolir esse seria pedir dois apertos para entrar.
       */
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
  private indexOf(profile: PadProfile, button: PadButton): number {
    if (this.nonStandard) return profile.rawButtons?.[button] ?? STANDARD_BUTTONS[button];
    return STANDARD_BUTTONS[button];
  }

  /**
   * A intenção está pedida agora: qualquer um dos botões dela serve. Gatilho
   * analógico passa pelo limiar.
   */
  private held(pad: Gamepad, profile: PadProfile, intent: PadIntent): boolean {
    for (const name of PAD_BINDINGS[intent]) {
      const button = pad.buttons[this.indexOf(profile, name)];
      if (button === undefined) continue;
      if (button.pressed || button.value > TRIGGER_THRESHOLD) return true;
    }
    return false;
  }

  /** Borda de subida da intenção, consumida nesta chamada. */
  private rising(pad: Gamepad, profile: PadProfile, intent: PadIntent): boolean {
    const now = this.held(pad, profile, intent);
    const was = this.previous.get(intent) === true;
    this.previous.set(intent, now);
    return now && !was;
  }

  /**
   * Nenhuma intenção dispara até o botão ser solto.
   *
   * É o contrário de esquecer o estado anterior, e a diferença não é sutil:
   * `togglePause` chama `Controls.reset()`, que chama isto. Quando o método
   * **limpava** o mapa, o Options continuava apertado no tick seguinte, não
   * havia mais "estava apertado" guardado, e o jogo lia uma borda de subida
   * nova — abrindo e fechando o menu a 20 Hz enquanto o dedo estivesse no
   * botão (relato de campo 2026-09-14). Marcar tudo como já apertado resolve e
   * se conserta sozinho: no primeiro polling em que o botão aparece solto, o
   * `rising` grava `false` e o próximo aperto volta a valer.
   */
  private silenceUntilRelease(): void {
    for (const intent of ALL_INTENTS) this.previous.set(intent, true);
  }

  /** Zera tudo — controle desligado, ou aba perdendo o foco. */
  reset(): void {
    const s = this.state;
    s.forward = 0; s.strafe = 0; s.lookX = 0; s.lookY = 0;
    s.jump = false; s.sneak = false; s.sprint = false; s.breaking = false;
    s.jumpPressed = false; s.placing = false; s.drop = false;
    s.hotbarPrev = false; s.hotbarNext = false; s.pause = false; s.inventory = false;
    const n = this.nav;
    n.up = false; n.down = false; n.left = false; n.right = false;
    n.confirm = false; n.cancel = false; n.secondary = false;
    n.cursorX = 0; n.cursorY = 0;
    this.silenceUntilRelease();
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
