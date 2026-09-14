/**
 * Teste de controle ao vivo (doc 09 §3.1).
 *
 * Ele existe porque um relato de campo não bateu com o código: `L1`/`R1` não
 * trocavam o item da mão num DualSense por Bluetooth, e o caminho inteiro tem
 * teste verde. O painel lê o controle **cru** para separar "o mapeamento está
 * errado" de "o aparelho não manda esse botão" — então o que se testa aqui é
 * justamente que ele **não** passa por perfil nenhum.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PadTester } from '../src/ui/screens/padtester';

class FakeEl {
  hidden = false;
  textContent = '';
  className = '';
  readonly children: FakeEl[] = [];
  constructor(readonly tag: string) {}
  appendChild(child: FakeEl): void { this.children.push(child); }
}

function fakePad(options: {
  id?: string; pressed?: number[]; axes?: number[]; mapping?: string; buttons?: number;
}): Gamepad {
  const pressed = new Set(options.pressed ?? []);
  const total = options.buttons ?? 17;
  return {
    id: options.id ?? 'DualSense Wireless Controller (Vendor: 054c Product: 0ce6)',
    index: 0,
    connected: true,
    mapping: (options.mapping ?? 'standard') as GamepadMappingType,
    axes: options.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: total }, (_, i) => ({
      pressed: pressed.has(i), touched: pressed.has(i), value: pressed.has(i) ? 1 : 0,
    })) as unknown as readonly GamepadButton[],
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

function connect(pad: Gamepad | null): void {
  vi.stubGlobal('navigator', { getGamepads: () => (pad === null ? [] : [pad]) });
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeEl(tag),
    head: new FakeEl('head'),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('o que o painel mostra', () => {
  it('sem controle ele não ocupa espaço na tela', () => {
    connect(null);
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.hidden).toBe(true);
  });

  it('diz o índice do botão apertado, e não só o nome', () => {
    // O índice é o dado que resolve a dúvida: se apertar L1 acusar 4, o
    // aparelho manda o que a especificação diz e o problema é outro.
    connect(fakePad({ pressed: [4] }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent).toContain('4 (l1)');
  });

  it('o último aperto fica na tela depois de soltar', () => {
    const tester = new PadTester();
    connect(fakePad({ pressed: [5] }));
    tester.refresh();
    connect(fakePad({}));
    tester.refresh();
    expect(tester.element.textContent, 'ler a linha e apertar ao mesmo tempo é difícil')
      .toContain('último aperto: 5 (r1)');
    expect(tester.element.textContent).toContain('apertado agora: —');
  });

  it('avisa quando o navegador não normalizou o layout', () => {
    connect(fakePad({ mapping: '' }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent).toContain('NÃO normalizado');
  });

  it('conta botões e eixos — é o que denuncia um relatório fora do padrão', () => {
    connect(fakePad({ buttons: 14, axes: [0, 0, 0, 0, 0, 0, 0, 0, -1] }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent).toContain('14 botões');
    expect(tester.element.textContent, 'um direcional em eixo de chapéu aparece aqui')
      .toContain('9 eixos');
  });

  it('não some com um botão que a tabela não nomeia', () => {
    // O touchpad do DualSense é o índice 17 em alguns sistemas: fora da tabela
    // e exatamente o tipo de coisa que se quer ver.
    connect(fakePad({ pressed: [17], buttons: 18 }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent).toContain('apertado agora: 17');
  });
});

describe('relógio', () => {
  it('parar de fato para de ler o controle', () => {
    vi.useFakeTimers();
    let leituras = 0;
    vi.stubGlobal('navigator', {
      getGamepads: () => { leituras++; return [fakePad({})]; },
    });
    const tester = new PadTester();
    tester.start();
    vi.advanceTimersByTime(1000);
    const durante = leituras;
    expect(durante, 'com a tela aberta ele lê').toBeGreaterThan(5);

    tester.stop();
    vi.advanceTimersByTime(1000);
    expect(leituras, 'com a tela fechada ele não acorda a aba').toBe(durante);
    vi.useRealTimers();
  });
});
