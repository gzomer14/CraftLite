/**
 * As opções são persistidas em `localStorage`, que é território hostil: modo
 * privado joga exceção, a cota estoura, e o conteúdo pode ter sido editado à
 * mão ou vir de uma versão antiga. Nada disso pode derrubar o jogo.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SettingsStore } from '../src/game/settings';

let store: Record<string, string>;

function stubStorage(behavior: 'ok' | 'throws' = 'ok'): void {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (behavior === 'throws') throw new Error('modo privado');
      return store[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (behavior === 'throws') throw new Error('cota cheia');
      store[k] = v;
    },
    removeItem: (k: string) => { delete store[k]; },
  });
}

beforeEach(() => stubStorage());
afterEach(() => vi.unstubAllGlobals());

describe('padrões', () => {
  it('o modo de toque padrão é o B — desvio consciente do doc 09 §2.2', () => {
    /*
     * O doc pede o A como padrão. Ele tinha bugs reais, já corrigidos, mas
     * sobra a ambiguidade de ter duas miras ao mesmo tempo: o alvo é o dedo e
     * a mira branca continua no centro da tela. Decisão do usuário com o jogo
     * na mão (2026-09-14); o A continua a um toque nas opções.
     */
    expect(new SettingsStore().get('touchMode')).toBe('B');
  });

  it('o toque longo padrão é 300 ms', () => {
    expect(new SettingsStore().get('longPressMs')).toBe(300);
  });

  it('resolução dinâmica vem ligada', () => {
    expect(new SettingsStore().get('dynamicResolution')).toBe(true);
  });
});

describe('6. opções novas da revisão de UX', () => {
  /** `touchDefaults` lê `matchMedia`, que não existe em Node. */
  const comToque = (coarse: boolean): SettingsStore => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q.includes('coarse') }));
    return new SettingsStore();
  };

  it('o pulo automático vem ligado no toque e desligado no desktop', () => {
    // Doc 09 §2: no celular, subir uma borda de um bloco exigia soltar o
    // joystick e acertar o botão de pulo a cada passo.
    expect(comToque(true).get('autoJump')).toBe(true);
    expect(comToque(false).get('autoJump')).toBe(false);
  });

  it('a escolha do jogador vence o padrão do aparelho', () => {
    const s = comToque(true);
    s.set('autoJump', false);
    expect(comToque(true).get('autoJump')).toBe(false);
  });

  it('FOV e brilho têm padrão e faixa', () => {
    const s = comToque(false);
    expect(s.get('fov')).toBe(70);
    expect(s.get('brightness')).toBe(50);
    s.set('fov', 500);
    expect(s.get('fov')).toBe(110);
    s.set('brightness', -20);
    expect(s.get('brightness')).toBe(0);
  });

  it('a acessibilidade existe e nasce neutra', () => {
    const s = comToque(false);
    expect(s.get('highContrast')).toBe(false);
    expect(s.get('textScale')).toBe(100);
    expect(s.get('damageFlash')).toBe(true);
  });

  it('reset volta ao padrão do aparelho, não ao do desktop', () => {
    const s = comToque(true);
    s.set('autoJump', false);
    s.reset();
    expect(s.get('autoJump')).toBe(true);
  });
});

describe('estilo de textura', () => {
  it('nasce no Nítido e guarda a escolha do Clássico', () => {
    const settings = new SettingsStore();
    expect(settings.get('textureStyle')).toBe('nitido');
    settings.set('textureStyle', 'classico');
    expect(new SettingsStore().get('textureStyle')).toBe('classico');
  });
});

describe('persistência', () => {
  it('grava e relê', () => {
    const a = new SettingsStore();
    a.set('touchMode', 'B');
    a.set('leftHanded', true);
    const b = new SettingsStore();
    expect(b.get('touchMode')).toBe('B');
    expect(b.get('leftHanded')).toBe(true);
  });

  it('avisa quem escuta ao mudar', () => {
    const settings = new SettingsStore();
    let calls = 0;
    settings.onChange(() => calls++);
    settings.set('invertY', true);
    expect(calls).toBe(1);
  });

  it('não avisa quando o valor não muda', () => {
    const settings = new SettingsStore();
    let calls = 0;
    settings.onChange(() => calls++);
    settings.set('invertY', false);
    expect(calls).toBe(0);
  });

  it('reset volta aos padrões', () => {
    const settings = new SettingsStore();
    // Tem que sair do padrão para o teste provar alguma coisa.
    settings.set('touchMode', 'A');
    settings.reset();
    expect(settings.get('touchMode')).toBe('B');
  });
});

describe('validação', () => {
  it('clampa valores fora da faixa', () => {
    const settings = new SettingsStore();
    settings.set('longPressMs', 5000);
    expect(settings.get('longPressMs')).toBe(1000);
    settings.set('longPressMs', 10);
    expect(settings.get('longPressMs')).toBe(150);
  });

  it('ignora estilo de textura desconhecido vindo do storage', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ textureStyle: 'ultra' });
    expect(new SettingsStore().get('textureStyle')).toBe('nitido');
  });

  it('ignora JSON corrompido', () => {
    store['craftlite.settings.v1'] = '{isto não é json';
    expect(new SettingsStore().get('touchMode')).toBe('B');
  });

  it('ignora campos com tipo errado', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ longPressMs: 'muito', invertY: 1 });
    const settings = new SettingsStore();
    expect(settings.get('longPressMs')).toBe(300);
    expect(settings.get('invertY')).toBe(false);
  });

  it('ignora números fora da faixa vindos do storage', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ lookSensitivity: 999 });
    expect(new SettingsStore().get('lookSensitivity')).toBe(0.0022);
  });

  it('ignora touchMode inválido', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ touchMode: 'Z' });
    expect(new SettingsStore().get('touchMode')).toBe('B');
  });

  it('descarta campos desconhecidos', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ naoExiste: 42, touchMode: 'A' });
    const settings = new SettingsStore();
    // O campo válido ao lado do desconhecido continua valendo.
    expect(settings.get('touchMode')).toBe('A');
    expect((settings.current as Record<string, unknown>).naoExiste).toBeUndefined();
  });
});

describe('storage hostil', () => {
  it('sobrevive a localStorage que joga exceção', () => {
    stubStorage('throws');
    const settings = new SettingsStore();
    expect(settings.get('touchMode')).toBe('B');
    // Mudar para um valor **diferente** do padrão é o que prova que a escrita
    // vale em memória mesmo sem conseguir persistir.
    expect(() => settings.set('touchMode', 'A')).not.toThrow();
    expect(settings.get('touchMode')).toBe('A'); // vale na sessão, só não persiste
  });
});

/**
 * Opções de controle (doc 09 §3).
 *
 * A zona morta é a que mais importa: é ela que salva um analógico gasto, que
 * reporta desvio parado e faz o jogador andar sozinho para um lado.
 */
describe('opções de controle', () => {
  it('nascem no padrão do doc, com detecção automática de layout', () => {
    const s = new SettingsStore();
    expect(s.get('padDeadZone')).toBe(0.15);
    expect(s.get('padSensitivity')).toBe(1);
    expect(s.get('padProfile')).toBe('auto');
  });

  it('a zona morta tem piso e teto — zero deixaria o analógico gasto à solta', () => {
    const s = new SettingsStore();
    s.set('padDeadZone', 0);
    expect(s.get('padDeadZone')).toBe(0.05);
    s.set('padDeadZone', 0.9);
    expect(s.get('padDeadZone')).toBe(0.4);
  });

  it('a sensibilidade do analógico tem faixa própria', () => {
    const s = new SettingsStore();
    s.set('padSensitivity', 99);
    expect(s.get('padSensitivity')).toBe(3);
    s.set('padSensitivity', 0);
    expect(s.get('padSensitivity')).toBe(0.3);
  });

  it('layout desconhecido no armazenamento é descartado', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ padProfile: 'playstation-2' });
    expect(new SettingsStore().get('padProfile')).toBe('auto');
  });

  it('layout conhecido sobrevive', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ padProfile: 'dualsense' });
    expect(new SettingsStore().get('padProfile')).toBe('dualsense');
  });
});

describe('idioma e dicas (M17)', () => {
  it('o padrão é seguir o aparelho, com as dicas da primeira hora ligadas', () => {
    const s = new SettingsStore();
    expect(s.get('language')).toBe('auto');
    expect(s.get('guide')).toBe(true);
  });

  it('idioma escolhido sobrevive; idioma que o jogo não tem é descartado', () => {
    store['craftlite.settings.v1'] = JSON.stringify({ language: 'en' });
    expect(new SettingsStore().get('language')).toBe('en');
    store['craftlite.settings.v1'] = JSON.stringify({ language: 'fr' });
    expect(new SettingsStore().get('language')).toBe('auto');
  });
});
