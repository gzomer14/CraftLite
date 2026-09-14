/**
 * Controles de toque (doc 09 §2).
 *
 * É a superfície onde erro não quebra nada visível mas deixa o jogo injogável
 * no celular — e o celular é o alvo principal do projeto. Os testes cobrem o
 * multitoque real (andar + olhar ao mesmo tempo), o joystick flutuante, a
 * corrida por tempo no limite e os dois modos de interação.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TouchControls } from '../src/input/touch';
import { SettingsStore } from '../src/game/settings';

/** Canvas falso com tamanho conhecido e despacho de eventos de ponteiro. */
class FakeCanvas {
  clientWidth = 800;
  clientHeight = 400;
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();

  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  removeEventListener(): void { /* não usado */ }

  emit(type: string, e: Record<string, unknown>): void {
    const event = {
      pointerType: 'touch', preventDefault: () => {}, stopPropagation: () => {},
      target: { setPointerCapture: () => {} },
      ...e,
    };
    for (const fn of this.handlers.get(type) ?? []) fn(event);
  }

  down(id: number, x: number, y: number): void {
    this.emit('pointerdown', { pointerId: id, clientX: x, clientY: y });
  }
  move(id: number, x: number, y: number): void {
    this.emit('pointermove', { pointerId: id, clientX: x, clientY: y });
  }
  up(id: number, x: number, y: number): void {
    this.emit('pointerup', { pointerId: id, clientX: x, clientY: y });
  }
}

let now = 1000;

beforeEach(() => {
  now = 1000;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('localStorage', {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

function baseSetup(): { canvas: FakeCanvas; touch: TouchControls; settings: SettingsStore } {
  const canvas = new FakeCanvas();
  const settings = new SettingsStore();
  const touch = new TouchControls(canvas as unknown as HTMLElement, settings);
  return { canvas, touch, settings };
}

/** Preparo padrão, com as opções de fábrica. */
const setup = baseSetup;

describe('joystick flutuante', () => {
  it('aparece onde o dedo tocar na metade esquerda', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    expect(touch.joystick.active).toBe(true);
    expect(touch.joystick.originX).toBe(120);
    expect(touch.joystick.originY).toBe(300);
  });

  it('o raio morto de 8 px não gera movimento', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 125, 300); // 5 px
    touch.update();
    expect(touch.state.forward).toBe(0);
    expect(touch.state.strafe).toBe(0);
  });

  it('empurrar para cima anda para frente', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 120, 240); // 60 px para cima
    touch.update();
    expect(touch.state.forward).toBeCloseTo(1, 1);
    expect(Math.abs(touch.state.strafe)).toBeLessThan(0.01);
  });

  it('empurrar para a direita anda para a direita', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 180, 300);
    touch.update();
    expect(touch.state.strafe).toBeCloseTo(1, 1);
  });

  it('não passa de 1 mesmo arrastando muito além do limite', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 600, 300);
    touch.update();
    expect(Math.hypot(touch.state.forward, touch.state.strafe)).toBeCloseTo(1, 2);
  });

  it('soltar zera o movimento', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 120, 240);
    touch.update();
    canvas.up(1, 120, 240);
    expect(touch.state.forward).toBe(0);
    expect(touch.joystick.active).toBe(false);
  });

  it('correr exige 300 ms no limite (doc 09 §2.1)', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 120, 235);
    touch.update();
    expect(touch.state.sprint).toBe(0);

    now += 150;
    touch.update();
    expect(touch.state.sprint).toBe(0);

    now += 200; // total 350 ms
    touch.update();
    expect(touch.state.sprint).toBe(1);
    expect(touch.joystick.sprinting).toBe(true);
  });

  it('sair do limite cancela a corrida', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.move(1, 120, 235);
    touch.update();
    now += 400;
    touch.update();
    expect(touch.state.sprint).toBe(1);

    canvas.move(1, 120, 280); // volta para perto do centro
    touch.update();
    expect(touch.state.sprint).toBe(0);
  });
});

describe('câmera por arraste', () => {
  /**
   * A sensibilidade estava 20× alta: eu multiplicava a base por 55, o que dava
   * ~6,9° por pixel e tornava a câmera incontrolável. O teste fixa a ordem de
   * grandeza esperada, não o valor exato.
   */
  it('arrastar meia tela gira entre 60° e 150°', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 500, 200);
    canvas.move(2, 900, 200); // 400 px ≈ meia tela de celular
    const look = new Float32Array(2);
    touch.consumeLook(look);
    const degrees = Math.abs(look[0]) * (180 / Math.PI);
    expect(degrees).toBeGreaterThan(60);
    expect(degrees).toBeLessThan(150);
  });

  it('um pixel de arraste gira bem menos que um grau', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 500, 200);
    canvas.move(2, 501, 200);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    expect(Math.abs(look[0]) * (180 / Math.PI)).toBeLessThan(1);
  });

  it('a sensibilidade das opções escala o arraste', () => {
    const { canvas, touch, settings } = setup();
    canvas.down(2, 500, 200);
    canvas.move(2, 600, 200);
    const slow = new Float32Array(2);
    touch.consumeLook(slow);

    settings.set('lookSensitivity', 0.0044); // o dobro
    canvas.move(2, 700, 200);
    const fast = new Float32Array(2);
    touch.consumeLook(fast);
    expect(Math.abs(fast[0])).toBeCloseTo(Math.abs(slow[0]) * 2, 4);
  });

  it('arrastar na metade direita gira a câmera', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    canvas.move(2, 660, 200);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    expect(look[0]).not.toBe(0);
  });

  it('arrastar para a direita diminui o yaw', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    canvas.move(2, 660, 200);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    expect(look[0]).toBeLessThan(0);
  });

  it('arrastar para baixo olha para baixo', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    canvas.move(2, 600, 260);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    expect(look[1]).toBeGreaterThan(0);
  });

  it('consumir zera o acumulado', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    canvas.move(2, 660, 260);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    touch.consumeLook(look);
    expect(look[0]).toBe(0);
    expect(look[1]).toBe(0);
  });
});

describe('multitoque real', () => {
  it('andar e olhar ao mesmo tempo funciona', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300); // joystick
    canvas.down(2, 600, 200); // câmera
    canvas.move(1, 120, 245);
    canvas.move(2, 660, 200);
    touch.update();

    expect(touch.state.forward).toBeGreaterThan(0.5);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    expect(look[0]).not.toBe(0);
    expect(touch.fingerCount).toBe(2);
  });

  it('soltar um dedo não afeta o outro', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.down(2, 600, 200);
    canvas.move(1, 120, 245);
    touch.update();
    canvas.up(2, 600, 200);
    touch.update();
    expect(touch.state.forward).toBeGreaterThan(0.5);
    expect(touch.fingerCount).toBe(1);
  });

  it('conta três dedos, para o gesto do debug', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 100, 300);
    canvas.down(2, 600, 200);
    canvas.down(3, 700, 300);
    expect(touch.fingerCount).toBe(3);
  });

  it('pointercancel solta só o dedo cancelado', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.down(2, 600, 200);
    canvas.emit('pointercancel', { pointerId: 2, clientX: 600, clientY: 200 });
    expect(touch.fingerCount).toBe(1);
    expect(touch.joystick.active).toBe(true);
  });
});

describe('modo A — toque no mundo', () => {
  /**
   * O modo A deixou de ser o padrão em 2026-09-14 (ver `game/settings.ts`), e
   * estes testes são sobre ele: cada um o liga explicitamente.
   */
  const setup = (): ReturnType<typeof baseSetup> => {
    const harness = baseSetup();
    harness.settings.set('touchMode', 'A');
    return harness;
  };

  it('toque curto e parado pede para colocar', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    now += 100;
    canvas.up(2, 600, 200);
    expect(touch.consumePlace()).toBe(true);
    expect(touch.consumePlace()).toBe(false); // consumido uma vez só
  });

  it('a mira vai para a posição do dedo, não para o centro', () => {
    /*
     * **Na ordem real do tick.** O `update()` roda no começo de
     * `Controls.update`, antes de alguém ler `state.hasAim` — e a versão
     * anterior deste teste lia a mira sem chamá-lo. Por isso ela passava
     * enquanto o jogo colocava blocos no centro da tela: o `update()` apagava
     * a mira que o `pointerup` tinha acabado de definir (relato de campo
     * 2026-09-14).
     */
    const { canvas, touch } = setup();
    canvas.down(2, 600, 100);
    now += 100;
    canvas.up(2, 600, 100);

    touch.update();
    // 600/800 → NDC x = 0.5 ; 100/400 → NDC y = 0.5
    expect(touch.state.aimNdcX).toBeCloseTo(0.5, 3);
    expect(touch.state.aimNdcY).toBeCloseTo(0.5, 3);
    expect(touch.state.hasAim, 'sem isto o bloco vai para o centro da tela').toBe(true);
    expect(touch.consumePlace()).toBe(true);
  });

  it('arrastar cancela o toque curto', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    canvas.move(2, 640, 200); // além do limiar de 10 px
    now += 100;
    canvas.up(2, 640, 200);
    expect(touch.consumePlace()).toBe(false);
  });

  it('segurar parado quebra depois do tempo de toque longo', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    touch.update();
    expect(touch.state.breaking).toBe(false);

    now += 350;
    touch.update();
    expect(touch.state.breaking).toBe(true);
    expect(touch.state.hasAim).toBe(true);
  });

  it('o progresso do toque longo cresce até 1', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    now += 150;
    touch.update();
    expect(touch.state.holdProgress).toBeGreaterThan(0.4);
    expect(touch.state.holdProgress).toBeLessThan(0.6);
  });

  it('arrastar não quebra durante o movimento, mas parar rearma a contagem', () => {
    /*
     * A regra **mudou de propósito**. Antes, um dedo que passasse de 10 px
     * ficava marcado como "arrastado" para sempre e não conseguia mais
     * quebrar até ser levantado — o que na mão significa mirar arrastando e
     * depois segurar sem nada acontecer. Agora sair da folga **reancora** a
     * contagem, como em todo toque longo com folga.
     */
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);

    for (let step = 1; step <= 6; step++) {
      now += 60;
      canvas.move(2, 600 + step * 40, 200);
      touch.update();
      expect(touch.state.breaking, `arrastando, passo ${step}`).toBe(false);
    }

    now += 400;
    touch.update();
    expect(touch.state.breaking, 'parou e segurou: tem que quebrar').toBe(true);
  });

  it('a deriva pequena do dedo parado não reinicia a quebra', () => {
    // O caso que mais doía: segurar para quebrar com o aparelho balançando na
    // mão. Com folga de 10 px, quase todo toque longo era cancelado.
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    for (let step = 0; step < 5; step++) {
      now += 60;
      canvas.move(2, 600 + (step % 2 === 0 ? 6 : -6), 200 + step);
      touch.update();
    }
    now += 60;
    touch.update();
    expect(touch.state.breaking, 'tremor de mão não é arraste').toBe(true);
  });

  it('começada a quebra, a deriva não a cancela mais', () => {
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    now += 400;
    touch.update();
    expect(touch.state.breaking).toBe(true);

    canvas.move(2, 700, 260);
    touch.update();
    expect(touch.state.breaking, 'quebrar não pode parar no meio por deriva').toBe(true);
  });

  it('o dedo que está quebrando para de girar a câmera', () => {
    // Ele é o mesmo polegar que mira: girar a cena tirava o alvo de baixo dele.
    const { canvas, touch } = setup();
    const look = new Float32Array(2);
    canvas.down(2, 600, 200);
    now += 400;
    touch.update();
    touch.consumeLook(look);

    canvas.move(2, 660, 200);
    touch.consumeLook(look);
    expect(look[0], 'quebrando, o arraste não vira câmera').toBe(0);
  });

  it('sair da área do canvas não coloca bloco sozinho', () => {
    /*
     * `pointerleave` era tratado como "soltou o dedo": encostar na borda da
     * tela, ou passar por cima de um botão do HUD, colocava um bloco que
     * ninguém pediu.
     */
    const { canvas, touch } = setup();
    canvas.down(2, 600, 200);
    now += 50;
    canvas.emit('pointerleave', { pointerId: 2, clientX: 799, clientY: 200 });
    expect(touch.consumePlace()).toBe(false);
  });

  it('o tempo de toque longo é ajustável (acessibilidade)', () => {
    const { canvas, touch, settings } = setup();
    settings.set('longPressMs', 800);
    canvas.down(2, 600, 200);
    now += 400;
    touch.update();
    expect(touch.state.breaking).toBe(false);
    now += 500;
    touch.update();
    expect(touch.state.breaking).toBe(true);
  });
});

describe('modo B — botões dedicados', () => {
  it('não quebra nem coloca por toque no mundo', () => {
    const { canvas, touch, settings } = setup();
    settings.set('touchMode', 'B');
    canvas.down(2, 600, 200);
    now += 500;
    touch.update();
    expect(touch.state.breaking).toBe(false);
    canvas.up(2, 600, 200);
    expect(touch.consumePlace()).toBe(false);
  });

  it('mas a câmera continua girando por arraste', () => {
    const { canvas, touch, settings } = setup();
    settings.set('touchMode', 'B');
    canvas.down(2, 600, 200);
    canvas.move(2, 660, 200);
    const look = new Float32Array(2);
    touch.consumeLook(look);
    expect(look[0]).not.toBe(0);
  });
});

describe('canhoto', () => {
  it('espelha as zonas de movimento e câmera', () => {
    const { canvas, touch, settings } = setup();
    settings.set('leftHanded', true);
    canvas.down(1, 600, 300); // metade DIREITA vira o joystick
    expect(touch.joystick.active).toBe(true);
  });
});

describe('reset', () => {
  it('solta tudo', () => {
    const { canvas, touch } = setup();
    canvas.down(1, 120, 300);
    canvas.down(2, 600, 200);
    canvas.move(1, 120, 240);
    touch.update();
    touch.reset();
    expect(touch.fingerCount).toBe(0);
    expect(touch.state.forward).toBe(0);
    expect(touch.joystick.active).toBe(false);
  });
});

describe('primeiro toque', () => {
  it('dispara uma única vez, para pedir tela cheia', () => {
    const { canvas, touch } = setup();
    let calls = 0;
    touch.onFirstTouch = () => calls++;
    canvas.down(1, 100, 300);
    canvas.down(2, 600, 300);
    expect(calls).toBe(1);
    expect(touch.everTouched).toBe(true);
  });
});

describe('mouse não interfere', () => {
  it('eventos de mouse são ignorados pelo motor de toque', () => {
    const { canvas, touch } = setup();
    canvas.emit('pointerdown', {
      pointerId: 9, clientX: 120, clientY: 300, pointerType: 'mouse',
    });
    expect(touch.fingerCount).toBe(0);
    expect(touch.joystick.active).toBe(false);
  });
});
