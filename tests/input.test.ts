/**
 * Sinais de input. São duas linhas de código que, erradas, deixam o jogo
 * "estranho" sem quebrar nada — exatamente o tipo de bug que só aparece quando
 * alguém joga. Daí travar em teste.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Mouse } from '../src/input/mouse';
import { Keyboard } from '../src/input/keyboard';
import { Controls } from '../src/input/controls';
import { Gamepads } from '../src/input/gamepad';
import { SettingsStore } from '../src/game/settings';

/** Alvo de eventos mínimo, para não precisar de DOM real. */
class FakeTarget implements EventTarget {
  private readonly handlers = new Map<string, EventListener[]>();
  addEventListener(type: string, fn: EventListener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  removeEventListener(type: string, fn: EventListener): void {
    const list = this.handlers.get(type);
    if (list === undefined) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event: Event): boolean {
    for (const fn of this.handlers.get(event.type) ?? []) fn(event);
    return true;
  }
  /** `Event` real não deixa escrever `target`; um objeto simples basta aqui. */
  emit(type: string, detail: Record<string, unknown>): void {
    this.dispatchEvent({ type, preventDefault: () => {}, ...detail } as unknown as Event);
  }
}

let canvas: FakeTarget;

beforeEach(() => {
  canvas = new FakeTarget();
  vi.stubGlobal('document', new FakeTarget());
  vi.stubGlobal('window', new FakeTarget());
  // O teclado checa `instanceof HTMLElement` para não sequestrar teclas em
  // campos de texto; fora do navegador a classe não existe.
  vi.stubGlobal('HTMLElement', class {});
});

afterEach(() => vi.unstubAllGlobals());

describe('Mouse', () => {
  const makeMouse = (): Mouse => {
    const mouse = new Mouse(canvas as unknown as HTMLElement);
    (mouse as unknown as { locked: boolean }).locked = true;
    return mouse;
  };

  it('mouse para baixo faz a câmera olhar para baixo', () => {
    const mouse = makeMouse();
    canvas.emit('mousemove', { movementX: 0, movementY: 10 });
    const out = new Float32Array(2);
    mouse.consume(out);
    // Pitch positivo = olhando para baixo (forward.y = −sin pitch).
    expect(out[1]).toBeGreaterThan(0);
  });

  it('mouse para cima faz a câmera olhar para cima', () => {
    const mouse = makeMouse();
    canvas.emit('mousemove', { movementX: 0, movementY: -10 });
    const out = new Float32Array(2);
    mouse.consume(out);
    expect(out[1]).toBeLessThan(0);
  });

  it('mouse para a direita diminui o yaw (= virar à direita)', () => {
    const mouse = makeMouse();
    canvas.emit('mousemove', { movementX: 10, movementY: 0 });
    const out = new Float32Array(2);
    mouse.consume(out);
    expect(out[0]).toBeLessThan(0);
  });

  it('invertY inverte só o eixo vertical', () => {
    const mouse = makeMouse();
    mouse.invertY = true;
    canvas.emit('mousemove', { movementX: 10, movementY: 10 });
    const out = new Float32Array(2);
    mouse.consume(out);
    expect(out[1]).toBeLessThan(0);
    expect(out[0]).toBeLessThan(0); // horizontal não muda
  });

  it('consumir zera o acumulado', () => {
    const mouse = makeMouse();
    canvas.emit('mousemove', { movementX: 10, movementY: 10 });
    const out = new Float32Array(2);
    mouse.consume(out);
    mouse.consume(out);
    expect(out[0]).toBeCloseTo(0, 10);
    expect(out[1]).toBeCloseTo(0, 10);
  });

  it('ignora movimento sem pointer lock', () => {
    const mouse = new Mouse(canvas as unknown as HTMLElement);
    canvas.emit('mousemove', { movementX: 50, movementY: 50 });
    const out = new Float32Array(2);
    mouse.consume(out);
    expect(out[0]).toBeCloseTo(0, 10);
  });
});

describe('Keyboard.axis', () => {
  it('devolve +1 para a tecla positiva e −1 para a negativa', () => {
    const target = new FakeTarget();
    const keyboard = new Keyboard(target);
    target.emit('keydown', { code: 'KeyD', repeat: false, target: null });
    expect(keyboard.axis('KeyA', 'KeyD')).toBe(1);
    target.emit('keyup', { code: 'KeyD', target: null });
    target.emit('keydown', { code: 'KeyA', repeat: false, target: null });
    expect(keyboard.axis('KeyA', 'KeyD')).toBe(-1);
  });

  it('teclas opostas se cancelam', () => {
    const target = new FakeTarget();
    const keyboard = new Keyboard(target);
    target.emit('keydown', { code: 'KeyA', repeat: false, target: null });
    target.emit('keydown', { code: 'KeyD', repeat: false, target: null });
    expect(keyboard.axis('KeyA', 'KeyD')).toBe(0);
  });
});

/**
 * Pointer lock a partir de toque (bug de campo, 2026-09-10).
 *
 * No Modo A, colocar bloco é um toque curto e parado — que o navegador também
 * entrega como `click`. Pedir pointer lock dali congela `clientX`/`clientY`
 * pela spec: todo dedo passa a reportar o mesmo ponto, o joystick nasce no
 * canto, o jogador não anda mais e nenhum toque vira "olhar", então também não
 * dá para colocar mais nada. Só some ao pausar (que solta o lock) — e não
 * acontecia no Modo B, onde colocar é um botão de DOM e o canvas nunca recebe
 * o `click`.
 */
describe('pointer lock não é pedido por toque', () => {
  const setup = (): { locks: number } => {
    const counter = { locks: 0 };
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    const fake = canvas as unknown as HTMLElement;
    // A assinatura real devolve `Promise<void>`; aqui só contamos as chamadas.
    fake.requestPointerLock = (): Promise<void> => {
      counter.locks++;
      return Promise.resolve();
    };
    const store = new SettingsStore();
    new Controls(fake as unknown as HTMLCanvasElement, store, {
      onHotbarSelect: () => {}, onHotbarScroll: () => {}, onPickBlock: () => {},
      onToggleDebug: () => {}, onToggleFly: () => {}, onPause: () => {}, onInventory: () => {},
      onDropItem: () => {},
    });
    return counter;
  };

  it('toque curto no canvas não pede pointer lock', () => {
    const counter = setup();
    canvas.emit('click', { pointerType: 'touch' });
    expect(counter.locks).toBe(0);
  });

  it('caneta também não pede', () => {
    const counter = setup();
    canvas.emit('click', { pointerType: 'pen' });
    expect(counter.locks).toBe(0);
  });

  it('clique de mouse continua pedindo', () => {
    const counter = setup();
    canvas.emit('click', { pointerType: 'mouse' });
    expect(counter.locks).toBe(1);
  });

  it('clique sem pointerType (teclado) continua pedindo', () => {
    const counter = setup();
    canvas.emit('click', {});
    expect(counter.locks).toBe(1);
  });
});

/**
 * A câmera é lida **por quadro desenhado**, e não no tick de 20 Hz.
 *
 * `camera.yaw` recebe `player.yaw` direto, sem interpolação: girar a 20 Hz num
 * display de 60 Hz repete o mesmo ângulo por três quadros e depois pula. O jogo
 * rodava liso e a câmera andava *"de quadro em quadro, como se fosse
 * movimentação por teclado"* (relato de campo 2026-09-14).
 */
describe('a câmera é por quadro, não por tick', () => {
  function makeControls(pads: Gamepads): Controls {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
    const fake = canvas as unknown as HTMLCanvasElement;
    (fake as unknown as { requestPointerLock: () => void }).requestPointerLock = () => {};
    return new Controls(fake, new SettingsStore(), {
      onHotbarSelect: () => {}, onHotbarScroll: () => {}, onPickBlock: () => {},
      onToggleDebug: () => {}, onToggleFly: () => {}, onPause: () => {}, onInventory: () => {},
      onDropItem: () => {},
    }, undefined, pads);
  }

  /** Quanto a câmera girou numa chamada de `updateLook`. */
  function look(controls: Controls, dtMs: number): { yaw: number; pitch: number } {
    const out = { yaw: 0, pitch: 0 };
    controls.updateLook(dtMs, (yaw, pitch) => { out.yaw = yaw; out.pitch = pitch; });
    return out;
  }

  function fakePad(axes: number[]): void {
    vi.stubGlobal('navigator', {
      getGamepads: () => [{
        id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
        index: 0, connected: true, mapping: 'standard', axes,
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        timestamp: 0, vibrationActuator: null,
      }],
    });
  }

  it('o tick não mexe mais na câmera', () => {
    const controls = makeControls(new Gamepads());
    (controls.mouse as unknown as { locked: boolean }).locked = true;
    canvas.emit('mousemove', { movementX: 40, movementY: 0 });

    controls.update();
    // Se o tick tivesse consumido o movimento, não sobraria nada para o quadro.
    expect(look(controls, 16).yaw, 'o delta espera o quadro').not.toBe(0);
  });

  it('o mouse entrega pixels: o tempo do quadro não escala', () => {
    const controls = makeControls(new Gamepads());
    (controls.mouse as unknown as { locked: boolean }).locked = true;

    canvas.emit('mousemove', { movementX: 40, movementY: 0 });
    const curto = look(controls, 8);
    canvas.emit('mousemove', { movementX: 40, movementY: 0 });
    const longo = look(controls, 33);
    expect(longo.yaw, 'o mesmo arrasto gira o mesmo, em qualquer FPS')
      .toBeCloseTo(curto.yaw, 10);
  });

  it('o analógico entrega velocidade: o tempo do quadro escala', () => {
    const pads = new Gamepads();
    const controls = makeControls(pads);
    fakePad([0, 0, 1, 0]);
    controls.update();

    const umQuadro = look(controls, 16);
    const doisQuadros = look(controls, 32);
    expect(doisQuadros.yaw, 'girar não pode depender do FPS')
      .toBeCloseTo(umQuadro.yaw * 2, 6);
  });

  it('um engasgo longo não vira um giro de controle', () => {
    const pads = new Gamepads();
    const controls = makeControls(pads);
    fakePad([0, 0, 1, 0]);
    controls.update();

    const normal = look(controls, 100);
    const engasgo = look(controls, 250);
    expect(engasgo.yaw, 'o passo é limitado').toBeCloseTo(normal.yaw, 10);
  });

  it('sem input nenhum, nem chama de volta', () => {
    const controls = makeControls(new Gamepads());
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    controls.update();
    let chamou = false;
    controls.updateLook(16, () => { chamou = true; });
    expect(chamou, 'quadro parado não recalcula câmera').toBe(false);
  });
});
