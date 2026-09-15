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
  touched?: number[]; values?: Record<number, number>;
}): Gamepad {
  const pressed = new Set(options.pressed ?? []);
  const touched = new Set(options.touched ?? []);
  const total = options.buttons ?? 17;
  return {
    id: options.id ?? 'DualSense Wireless Controller (Vendor: 054c Product: 0ce6)',
    index: 0,
    connected: true,
    mapping: (options.mapping ?? 'standard') as GamepadMappingType,
    axes: options.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: total }, (_, i) => ({
      pressed: pressed.has(i),
      touched: pressed.has(i) || touched.has(i),
      value: options.values?.[i] ?? (pressed.has(i) ? 1 : 0),
    })) as unknown as readonly GamepadButton[],
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

function connect(pad: Gamepad | null): void {
  vi.stubGlobal('navigator', { getGamepads: () => (pad === null ? [] : [pad]) });
}

/** Ouvintes registrados no `window`, para o teste disparar a tecla. */
let teclado: ((e: unknown) => void)[] = [];

beforeEach(() => {
  teclado = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeEl(tag),
    head: new FakeEl('head'),
  });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'keydown') teclado.push(fn);
    },
    removeEventListener: (_type: string, fn: (e: unknown) => void) => {
      teclado = teclado.filter((f) => f !== fn);
    },
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

describe('sinais que não são um aperto comum', () => {
  /*
   * A linha que o painel existe para mostrar: num DualSense real, `L1` e `R1`
   * não aparecem como botão nenhum enquanto o resto do controle aparece. As
   * três formas abaixo são as maneiras conhecidas de um botão chegar sem
   * `pressed`, e o painel engolia todas.
   */
  it('meio curso aparece com o valor', () => {
    connect(fakePad({ values: { 6: 0.4 } }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent).toContain('6 (l2) 0.40');
  });

  it('encostado sem apertar também aparece', () => {
    connect(fakePad({ touched: [4] }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent, 'alguns drivers só reportam touched')
      .toContain('4 (l1) toque');
  });

  it('um eixo que sai do lugar fica registrado', () => {
    // É a hipótese que sobra se L1/R1 não chegam como botão: um chapéu, ou um
    // ombro que o driver reporta como eixo.
    const tester = new PadTester();
    connect(fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }));
    tester.refresh();
    connect(fakePad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1] }));
    tester.refresh();
    expect(tester.element.textContent).toContain('último eixo que mexeu: 9 → 1.00');
  });

  it('ruído de analógico parado não conta como movimento', () => {
    const tester = new PadTester();
    connect(fakePad({ axes: [0, 0, 0, 0] }));
    tester.refresh();
    connect(fakePad({ axes: [0.08, 0, 0, 0] }));
    tester.refresh();
    expect(tester.element.textContent).toContain('último eixo que mexeu: —');
  });

  it('mostra o id cru, que é o que se cola num relato', () => {
    connect(fakePad({ id: 'Controle Esquisito (Vendor: dead Product: beef)' }));
    const tester = new PadTester();
    tester.refresh();
    expect(tester.element.textContent).toContain('Vendor: dead Product: beef');
  });
});

describe('a tecla que a página recebe', () => {
  /*
   * Num Android, o sistema entrega os botões do controle como tecla, e o
   * navegador fica com alguns antes de a página ver: no Chrome, `L1` e `R1`
   * trocam de aba. Esta linha é o que separa "a página recebeu e ignorou" de
   * "a página nunca viu" — dois casos indistinguíveis de dentro do jogo, e a
   * diferença entre ter e não ter conserto.
   */
  it('anota a tecla como ela chega, sem interpretar', () => {
    connect(fakePad({}));
    const tester = new PadTester();
    tester.start();
    for (const fn of teclado) fn({ key: 'Unidentified', code: '', keyCode: 102 });
    tester.refresh();
    expect(tester.element.textContent)
      .toContain('última tecla na página: Unidentified · code — · keyCode 102');
    tester.stop();
  });

  it('sem tecla nenhuma, a linha fica vazia — e é essa a informação', () => {
    connect(fakePad({}));
    const tester = new PadTester();
    tester.start();
    tester.refresh();
    expect(tester.element.textContent).toContain('última tecla na página: —');
    tester.stop();
  });

  it('parar solta o ouvinte de teclado junto com o relógio', () => {
    connect(fakePad({}));
    const tester = new PadTester();
    tester.start();
    expect(teclado.length).toBe(1);
    tester.stop();
    expect(teclado.length, 'a tela fechada não escuta mais nada').toBe(0);
  });
});
