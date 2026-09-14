/**
 * Controle (doc 09 §3 e doc 08 §4.3).
 *
 * Node não tem Gamepad API, então o teste monta um controle falso — que é
 * exatamente o que se quer: dá para exercitar um DualSense que o navegador
 * normalizou, um que ele **não** normalizou, e um Xbox, sem ter os três na
 * mesa.
 *
 * O que importa aqui não é "o botão 0 é o índice 0": é que **o jogador com um
 * DualSense na mão veja ✕ escrito na tela**, que o mapeamento não troque
 * colocar por largar quando o navegador não reconhece o aparelho, e que dê
 * para sair de um menu só com o controle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gamepads } from '../src/input/gamepad';
import {
  GENERIC_PROFILE, PAD_BINDINGS, PAD_PROFILES, STANDARD_BUTTONS, profileById, profileFor,
} from '../src/data/gamepads';

/** Ids como Chrome e Firefox os escrevem de verdade. */
const IDS = {
  dualsenseChrome:
    'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  dualsenseFirefox: '054c-0ce6-DualSense Wireless Controller',
  dualshock4: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  xboxOne: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
  xboxSeries: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  switchPro: '057e-2009-Pro Controller',
  desconhecido: 'Generic USB Joystick (Vendor: 1234 Product: 5678)',
};

/** Controle falso; `pressed` lista os índices apertados. */
function fakePad(options: {
  id: string; pressed?: number[]; axes?: number[]; mapping?: string; values?: Record<number, number>;
}): Gamepad {
  const pressed = new Set(options.pressed ?? []);
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.has(i),
    touched: pressed.has(i),
    value: options.values?.[i] ?? (pressed.has(i) ? 1 : 0),
  }));
  return {
    id: options.id,
    index: 0,
    connected: true,
    mapping: (options.mapping ?? 'standard') as GamepadMappingType,
    axes: options.axes ?? [0, 0, 0, 0],
    buttons: buttons as unknown as readonly GamepadButton[],
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

function connect(pad: Gamepad | null): void {
  vi.stubGlobal('navigator', { getGamepads: () => (pad === null ? [] : [pad]) });
}

afterEach(() => vi.unstubAllGlobals());

describe('detecção de perfil', () => {
  it('reconhece o DualSense pelos dois formatos de id que existem', () => {
    expect(profileFor(IDS.dualsenseChrome).id).toBe('dualsense');
    expect(profileFor(IDS.dualsenseFirefox).id).toBe('dualsense');
  });

  it('não confunde Xbox com DualShock 4', () => {
    // Os dois reportam "Wireless Controller" no nome; quem desempata é o par
    // fabricante/produto. Esta é a armadilha da tabela.
    expect(profileFor(IDS.xboxOne).id).toBe('xbox');
    expect(profileFor(IDS.xboxSeries).id).toBe('xbox');
    expect(profileFor(IDS.dualshock4).id).toBe('dualshock4');
  });

  it('reconhece o Pro Controller', () => {
    expect(profileFor(IDS.switchPro).id).toBe('switch');
  });

  it('controle fora da tabela cai no genérico, e continua jogável', () => {
    const profile = profileFor(IDS.desconhecido);
    expect(profile.id).toBe('generic');
    // O genérico não tem mapa cru: no layout padrão ele não precisa de um.
    expect(profile.rawButtons).toBeUndefined();
  });

  it('todo perfil tem rótulo para todo botão do layout', () => {
    // A lista sai de `STANDARD_BUTTONS` e não de uma cópia à mão: botão novo
    // na tabela cobra o rótulo de todas as famílias sem ninguém lembrar.
    for (const profile of [...PAD_PROFILES, GENERIC_PROFILE]) {
      for (const key of Object.keys(STANDARD_BUTTONS) as (keyof typeof STANDARD_BUTTONS)[]) {
        expect(profile.labels[key], `${profile.id}.${key}`).toBeTruthy();
      }
      expect(profile.labels.family, profile.id).toBeTruthy();
    }
  });

  it('toda intenção aponta para pelo menos um botão que existe', () => {
    for (const [intent, buttons] of Object.entries(PAD_BINDINGS)) {
      expect(buttons.length, intent).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(STANDARD_BUTTONS[button], `${intent} → ${button}`).toBeTypeOf('number');
      }
    }
  });

  it('o layout forçado das opções encontra todos os perfis da lista', () => {
    for (const profile of PAD_PROFILES) {
      expect(profileById(profile.id)?.id, profile.id).toBe(profile.id);
    }
    expect(profileById('generic')?.id).toBe('generic');
    expect(profileById('nada')).toBeNull();
  });
});

describe('rótulos', () => {
  it('o DualSense mostra os símbolos da Sony, não A/B/X/Y', () => {
    connect(fakePad({ id: IDS.dualsenseChrome }));
    const pads = new Gamepads();
    pads.poll();
    expect(pads.labels.faceDown).toBe('✕');
    expect(pads.labels.faceRight).toBe('○');
    expect(pads.labels.faceLeft).toBe('□');
    expect(pads.labels.faceUp).toBe('△');
    expect(pads.labels.r2).toBe('R2');
    expect(pads.labels.start).toBe('Options');
  });

  it('o Xbox mostra as letras dele', () => {
    connect(fakePad({ id: IDS.xboxOne }));
    const pads = new Gamepads();
    pads.poll();
    expect(pads.labels.faceDown).toBe('A');
    expect(pads.labels.r2).toBe('RT');
    expect(pads.labels.start).toBe('Menu');
  });

  it('o layout forçado nas opções vence a detecção', () => {
    connect(fakePad({ id: IDS.xboxOne }));
    const pads = new Gamepads();
    pads.forcedProfile = profileById('dualsense');
    pads.poll();
    expect(pads.labels.faceDown).toBe('✕');
  });
});

describe('mapeamento padrão', () => {
  it('cada botão cai na intenção que a tabela declara', () => {
    const pads = new Gamepads();

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.faceDown] }));
    pads.poll();
    expect(pads.state.jump, '✕ pula').toBe(true);

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.l2] }));
    pads.poll();
    expect(pads.state.placing, 'L2 coloca, e é borda de subida').toBe(true);

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.faceUp] }));
    pads.poll();
    expect(pads.state.drop, '△ larga o item').toBe(true);
  });

  it('o □ abre a mochila — e não coloca mais bloco', () => {
    /*
     * Pedido de campo (2026-09-14). Antes o □ duplicava o L2 e era a única
     * coisa que fazia; a mochila só abria no Create, que é um botão pequeno e
     * mal colocado para uma ação usada o tempo todo.
     */
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.faceLeft] }));
    pads.poll();
    expect(pads.state.inventory, '□ abre a mochila').toBe(true);
    expect(pads.state.placing, '□ não coloca bloco').toBe(false);
  });

  it('L1 e R1 trocam o item da mão, um passo por aperto', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.l1] }));
    pads.poll();
    expect(pads.state.hotbarPrev, 'L1 volta um slot').toBe(true);
    pads.poll();
    expect(pads.state.hotbarPrev, 'segurar não desfila a hotbar').toBe(false);

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.r1] }));
    pads.poll();
    expect(pads.state.hotbarNext, 'R1 avança um slot').toBe(true);
  });

  it('pausa e inventário chegam ao jogo — antes eram calculados e jogados fora', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.xboxOne, pressed: [STANDARD_BUTTONS.start] }));
    pads.poll();
    expect(pads.state.pause).toBe(true);

    connect(fakePad({ id: IDS.xboxOne, pressed: [STANDARD_BUTTONS.select] }));
    pads.poll();
    expect(pads.state.inventory).toBe(true);
  });

  it('o gatilho é analógico: meio curso já conta', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.xboxOne, values: { [STANDARD_BUTTONS.r2]: 0.6 } }));
    pads.poll();
    expect(pads.state.breaking, 'meio curso de RT quebra').toBe(true);

    connect(fakePad({ id: IDS.xboxOne, values: { [STANDARD_BUTTONS.r2]: 0.1 } }));
    pads.poll();
    expect(pads.state.breaking, 'um roçar no gatilho não').toBe(false);
  });

  it('a borda de subida não repete enquanto o botão fica apertado', () => {
    const pads = new Gamepads();
    const pad = fakePad({ id: IDS.xboxOne, pressed: [STANDARD_BUTTONS.l2] });
    connect(pad);
    pads.poll();
    expect(pads.state.placing).toBe(true);
    pads.poll();
    expect(pads.state.placing, 'segurar não coloca em série').toBe(false);
  });
});

describe('silêncio até soltar', () => {
  it('o Options segurado não abre e fecha o menu em série', () => {
    /*
     * Relato de campo 2026-09-14: "apertando uma vez ele considera que apertei
     * duas ou até três".
     *
     * A causa não estava no controle. `togglePause` chama `Controls.reset()`,
     * que chamava `Gamepads.reset()`, que **limpava** o estado anterior. No
     * tick seguinte o Options continuava apertado e não havia mais nada
     * guardado dizendo isso — o jogo lia uma borda de subida nova e pausava de
     * novo, a 20 Hz, enquanto o dedo estivesse no botão.
     */
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.start] }));
    pads.poll();
    expect(pads.state.pause, 'o primeiro aperto pausa').toBe(true);

    pads.reset();
    pads.poll();
    expect(pads.state.pause, 'o mesmo aperto não pausa de novo').toBe(false);
    pads.poll();
    expect(pads.state.pause).toBe(false);

    connect(fakePad({ id: IDS.dualsenseChrome }));
    pads.poll();
    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.start] }));
    pads.poll();
    expect(pads.state.pause, 'soltar e apertar de novo volta a valer').toBe(true);
  });

});

describe('navegação de interface', () => {
  it('o analógico direito vira cursor e o L2 vira clique direito', () => {
    const pads = new Gamepads();
    connect(fakePad({
      id: IDS.dualsenseChrome,
      axes: [0, 0, 1, -1],
      pressed: [STANDARD_BUTTONS.l2],
    }));
    pads.pollNav();
    expect(pads.nav.cursorX, 'direita no analógico direito').toBeGreaterThan(0);
    expect(pads.nav.cursorY, 'e para cima').toBeLessThan(0);
    expect(pads.nav.secondary, 'L2 é o botão direito do mouse nos menus').toBe(true);
  });

  it('✕ e R2 confirmam; ○ volta', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.r2] }));
    pads.pollNav();
    expect(pads.nav.confirm, 'o gatilho de quebrar é o clique esquerdo').toBe(true);

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.faceRight] }));
    pads.pollNav();
    expect(pads.nav.cancel).toBe(true);
    expect(pads.nav.confirm).toBe(false);
  });

  it('com tela aberta a hotbar não roda sozinha', () => {
    const pads = new Gamepads();
    pads.uiCapture = true;
    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.r1] }));
    pads.poll();
    expect(pads.state.hotbarNext, 'R1 é da tela enquanto ela estiver aberta').toBe(false);
  });
});

describe('analógico', () => {
  it('a zona morta come o desvio de centro de um controle gasto', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseChrome, axes: [0.1, 0.1, 0, 0] }));
    pads.poll();
    expect(pads.state.strafe).toBe(0);
    expect(pads.state.forward).toBe(0);
  });

  it('a zona morta das opções sobe junto', () => {
    const pads = new Gamepads();
    pads.deadZone = 0.05;
    connect(fakePad({ id: IDS.dualsenseChrome, axes: [0.1, 0, 0, 0] }));
    pads.poll();
    expect(pads.state.strafe).toBeGreaterThan(0);

    pads.deadZone = 0.3;
    pads.poll();
    expect(pads.state.strafe).toBe(0);
  });

  it('o eixo Y do analógico é invertido para "frente" ser positivo', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseChrome, axes: [0, -1, 0, 0] }));
    pads.poll();
    expect(pads.state.forward).toBeGreaterThan(0);
  });
});

describe('rede de segurança do layout não normalizado', () => {
  it('num DualSense cru, □ abre a mochila e ✕ pula — e não o contrário', () => {
    /*
     * Sem a tabela da família, o índice 0 do relatório HID da Sony (□) seria
     * lido como "pular" e o 1 (✕) como "agachar". O jogador apertaria □ e o
     * boneco pularia.
     */
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseFirefox, mapping: '', pressed: [0] }));
    pads.poll();
    expect(pads.nonStandard).toBe(true);
    expect(pads.state.inventory, '□ abre a mochila').toBe(true);
    expect(pads.state.jump, '□ não pula').toBe(false);

    connect(fakePad({ id: IDS.dualsenseFirefox, mapping: '', pressed: [1] }));
    pads.poll();
    expect(pads.state.jump, '✕ pula').toBe(true);
  });

  it('controle desconhecido e não normalizado usa o layout padrão como palpite', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.desconhecido, mapping: '', pressed: [STANDARD_BUTTONS.faceDown] }));
    pads.poll();
    expect(pads.state.jump).toBe(true);
  });
});

describe('voo no criativo', () => {
  it('o pulo tem borda de subida própria, que é o que o duplo toque lê', () => {
    // Sem ela, `jump` é só "segurado" e não dá para contar dois apertos —
    // quem joga de controle no criativo não voaria.
    const pads = new Gamepads();
    const pad = fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.faceDown] });
    connect(pad);
    pads.poll();
    expect(pads.state.jumpPressed).toBe(true);
    expect(pads.state.jump).toBe(true);

    pads.poll();
    expect(pads.state.jumpPressed, 'segurar não conta como segundo toque').toBe(false);
    expect(pads.state.jump, 'mas continua segurado, para pular').toBe(true);
  });
});

describe('estado', () => {
  it('sem controle, tudo zerado — e nada quebra', () => {
    connect(null);
    const pads = new Gamepads();
    pads.poll();
    expect(pads.connected).toBe(false);
    expect(pads.state.forward).toBe(0);
    expect(pads.state.jump).toBe(false);
  });

  it('com uma tela aberta o mundo não recebe o analógico — mas dá para sair', () => {
    const pads = new Gamepads();
    connect(fakePad({
      id: IDS.dualsenseChrome,
      axes: [1, 1, 1, 1],
      pressed: [STANDARD_BUTTONS.faceDown, STANDARD_BUTTONS.select],
    }));
    pads.uiCapture = true;
    pads.poll();
    expect(pads.state.forward, 'o jogador não anda com o menu aberto').toBe(0);
    expect(pads.state.jump).toBe(false);
    expect(pads.state.inventory, 'mas o botão que fecha a tela continua chegando').toBe(true);
  });

  it('avisa quem liga um controle, uma vez por troca', () => {
    const pads = new Gamepads();
    const vistos: string[] = [];
    pads.onConnect((profile) => vistos.push(profile.id));

    connect(fakePad({ id: IDS.dualsenseChrome }));
    pads.poll();
    pads.poll();
    expect(vistos, 'o mesmo controle avisa uma vez só').toEqual(['dualsense']);

    connect(fakePad({ id: IDS.xboxOne }));
    pads.poll();
    expect(vistos).toEqual(['dualsense', 'xbox']);
  });

  it('dois ouvintes convivem — a dica e o HUD querem os dois saber', () => {
    const pads = new Gamepads();
    let a = 0;
    let b = 0;
    pads.onConnect(() => { a++; });
    const off = pads.onConnect(() => { b++; });
    connect(fakePad({ id: IDS.xboxOne }));
    pads.poll();
    expect([a, b]).toEqual([1, 1]);

    off();
    connect(fakePad({ id: IDS.dualsenseChrome }));
    pads.poll();
    expect([a, b]).toEqual([2, 1]);
  });

  it('pollNav não consome a borda que o tick do jogo vai ler', () => {
    // Os dois laços rodam no mesmo quadro: se `pollNav` consumisse a borda, o
    // aperto de colocar bloco sumiria antes de chegar ao jogo.
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.xboxOne, pressed: [STANDARD_BUTTONS.l2] }));
    pads.pollNav();
    pads.pollNav();
    pads.poll();
    expect(pads.state.placing).toBe(true);
  });
});
