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
  GENERIC_PROFILE, PAD_PROFILES, STANDARD_BUTTONS, profileById, profileFor,
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

  it('todo perfil tem rótulo para as oito teclas que a interface cita', () => {
    for (const profile of [...PAD_PROFILES, GENERIC_PROFILE]) {
      for (const key of ['jump', 'sneak', 'place', 'drop', 'use', 'break', 'start', 'select']) {
        expect(profile.labels[key as 'jump'], `${profile.id}.${key}`).toBeTruthy();
      }
      expect(profile.labels.family, profile.id).toBeTruthy();
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
    expect(pads.labels.jump).toBe('✕');
    expect(pads.labels.sneak).toBe('○');
    expect(pads.labels.place).toBe('□');
    expect(pads.labels.drop).toBe('△');
    expect(pads.labels.break).toBe('R2');
    expect(pads.labels.start).toBe('Options');
  });

  it('o Xbox mostra as letras dele', () => {
    connect(fakePad({ id: IDS.xboxOne }));
    const pads = new Gamepads();
    pads.poll();
    expect(pads.labels.jump).toBe('A');
    expect(pads.labels.break).toBe('RT');
    expect(pads.labels.start).toBe('Menu');
  });

  it('o layout forçado nas opções vence a detecção', () => {
    connect(fakePad({ id: IDS.xboxOne }));
    const pads = new Gamepads();
    pads.forcedProfile = profileById('dualsense');
    pads.poll();
    expect(pads.labels.jump).toBe('✕');
  });
});

describe('mapeamento padrão', () => {
  it('as quatro faces caem nas ações do doc 09 §3', () => {
    const pads = new Gamepads();

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.jump] }));
    pads.poll();
    expect(pads.state.jump).toBe(true);

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.place] }));
    pads.poll();
    expect(pads.state.placing, 'colocar é borda de subida').toBe(true);

    connect(fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.drop] }));
    pads.poll();
    expect(pads.state.drop, 'largar item, que não existia').toBe(true);
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
    connect(fakePad({ id: IDS.xboxOne, values: { [STANDARD_BUTTONS.break]: 0.6 } }));
    pads.poll();
    expect(pads.state.breaking, 'meio curso de RT quebra').toBe(true);

    connect(fakePad({ id: IDS.xboxOne, values: { [STANDARD_BUTTONS.break]: 0.1 } }));
    pads.poll();
    expect(pads.state.breaking, 'um roçar no gatilho não').toBe(false);
  });

  it('a borda de subida não repete enquanto o botão fica apertado', () => {
    const pads = new Gamepads();
    const pad = fakePad({ id: IDS.xboxOne, pressed: [STANDARD_BUTTONS.place] });
    connect(pad);
    pads.poll();
    expect(pads.state.placing).toBe(true);
    pads.poll();
    expect(pads.state.placing, 'segurar não coloca em série').toBe(false);
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
  it('num DualSense cru, □ coloca e △ larga — e não o contrário', () => {
    /*
     * Sem a tabela da família, o índice 0 do relatório HID da Sony (□) seria
     * lido como "pular" e o 3 (△) como "colocar". O jogador apertaria □ e o
     * boneco pularia.
     */
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.dualsenseFirefox, mapping: '', pressed: [0] }));
    pads.poll();
    expect(pads.nonStandard).toBe(true);
    expect(pads.state.placing, '□ coloca').toBe(true);
    expect(pads.state.jump, '□ não pula').toBe(false);

    connect(fakePad({ id: IDS.dualsenseFirefox, mapping: '', pressed: [1] }));
    pads.poll();
    expect(pads.state.jump, '✕ pula').toBe(true);
  });

  it('controle desconhecido e não normalizado usa o layout padrão como palpite', () => {
    const pads = new Gamepads();
    connect(fakePad({ id: IDS.desconhecido, mapping: '', pressed: [STANDARD_BUTTONS.jump] }));
    pads.poll();
    expect(pads.state.jump).toBe(true);
  });
});

describe('voo no criativo', () => {
  it('o pulo tem borda de subida própria, que é o que o duplo toque lê', () => {
    // Sem ela, `jump` é só "segurado" e não dá para contar dois apertos —
    // quem joga de controle no criativo não voaria.
    const pads = new Gamepads();
    const pad = fakePad({ id: IDS.dualsenseChrome, pressed: [STANDARD_BUTTONS.jump] });
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
      pressed: [STANDARD_BUTTONS.jump, STANDARD_BUTTONS.select],
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
    connect(fakePad({ id: IDS.xboxOne, pressed: [STANDARD_BUTTONS.place] }));
    pads.pollNav();
    pads.pollNav();
    pads.poll();
    expect(pads.state.placing).toBe(true);
  });
});
