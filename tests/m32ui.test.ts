/**
 * M32 — interface nova: o que mudou de comportamento, e não só de cara.
 *
 * O encaixe ("nenhuma tela rola") é medido no navegador por
 * `scripts/ui-fit.mjs`, que precisa de layout de verdade. Aqui fica o que
 * dá para provar sem DOM: o "Restaurar esta aba", os controles novos das
 * opções (interruptor e segmento), a pausa com as folhas no lugar dos
 * ladrilhos, e a saída da tela de morte, que antes só renascia.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/game/settings';
import { buildFields, type Field } from '../src/ui/screens/menu';
import { PauseMenu } from '../src/ui/screens/pause';
import { ACHIEVEMENTS } from '../src/data/achievements';

class FakeEl {
  hidden = false;
  textContent = '';
  className = '';
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  checked = false;
  parent: FakeEl | null = null;
  readonly children: FakeEl[] = [];
  readonly attributes: Record<string, string> = {};
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => { for (const n of names) this.classes.add(n); },
    toggle: (name: string, on?: boolean): void => {
      if (on ?? !this.classes.has(name)) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string): boolean => this.classes.has(name),
  };
  constructor(readonly tag: string) {}
  appendChild(child: FakeEl): FakeEl { child.parent = this; this.children.push(child); return child; }
  append(...kids: FakeEl[]): void { for (const kid of kids) this.appendChild(kid); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  focus(): void { /* sem foco */ }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  click(): void { for (const fn of this.handlers.get('click') ?? []) fn({}); }
  all(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const child of this.children) { out.push(child); out.push(...child.all()); }
    return out;
  }
  /** O primeiro descendente com este texto exato. */
  find(text: string): FakeEl | undefined {
    return this.all().find((el) => el.textContent === text);
  }
}

let body: FakeEl;
let stored: Record<string, string>;

beforeEach(() => {
  body = new FakeEl('body');
  stored = {};
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeEl(tag),
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
    body,
    head: new FakeEl('head'),
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => { stored[k] = v; },
    removeItem: (k: string) => { delete stored[k]; },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Restaurar esta aba', () => {
  it('volta só as chaves pedidas, e avisa uma vez', () => {
    const settings = new SettingsStore();
    settings.set('fov', 100);
    settings.set('brightness', 80);
    settings.set('masterVolume', 0.2);
    let avisos = 0;
    settings.onChange(() => { avisos++; });

    settings.resetKeys(['fov', 'brightness']);
    expect(settings.get('fov')).toBe(70);
    expect(settings.get('brightness')).toBe(50);
    expect(settings.get('masterVolume'), 'o som é de outra aba').toBe(0.2);
    expect(avisos).toBe(1);
  });

  it('sem nada mudado, não grava nem avisa', () => {
    const settings = new SettingsStore();
    let avisos = 0;
    settings.onChange(() => { avisos++; });
    settings.resetKeys(['fov']);
    expect(avisos).toBe(0);
  });
});

describe('controles das opções', () => {
  const FIELDS: readonly Field[] = [
    { kind: 'toggle', key: 'showFps', label: 'Mostrar FPS' },
    {
      kind: 'choice', key: 'fog', label: 'Névoa',
      options: [{ value: 'far', label: 'Longe' }, { value: 'near', label: 'Perto' }, { value: 'off', label: 'Sem' }],
    },
    {
      kind: 'choice', key: 'padProfile', label: 'Layout',
      options: [
        { value: 'auto', label: 'Detectar sozinho' },
        { value: 'dualsense', label: 'DualSense (PS5)' },
        { value: 'xbox', label: 'Xbox' },
      ],
    },
  ];

  it('liga/desliga é um interruptor que diz o estado ao leitor de tela', () => {
    const settings = new SettingsStore();
    const target = new FakeEl('div');
    buildFields(target as unknown as HTMLElement, settings, FIELDS);
    const toggle = target.all().find((el) => el.attributes.role === 'switch')!;
    expect(toggle.attributes['aria-checked']).toBe('false');
    toggle.click();
    expect(settings.get('showFps')).toBe(true);
    expect(toggle.attributes['aria-checked']).toBe('true');
  });

  it('escolha curta mostra todas as opções; longa continua <select>', () => {
    const settings = new SettingsStore();
    const target = new FakeEl('div');
    buildFields(target as unknown as HTMLElement, settings, FIELDS);
    const segment = target.all().find((el) => el.className === 'segment')!;
    expect(segment.children.map((b) => b.textContent)).toEqual(['Longe', 'Perto', 'Sem']);
    segment.children[1].click();
    expect(settings.get('fog')).toBe('near');
    expect(segment.children[1].classes.has('on')).toBe(true);
    expect(segment.children[0].classes.has('on')).toBe(false);
    expect(target.all().filter((el) => el.tag === 'select')).toHaveLength(1);
  });

  it('o valor mudado por fora aparece quando a tela relê', () => {
    const settings = new SettingsStore();
    const target = new FakeEl('div');
    const syncs = buildFields(target as unknown as HTMLElement, settings, FIELDS);
    settings.set('fog', 'off');
    for (const sync of syncs) sync();
    const segment = target.all().find((el) => el.className === 'segment')!;
    expect(segment.children[2].classes.has('on')).toBe(true);
  });
});

describe('pausa', () => {
  const tiles = (): FakeEl => body.all().find((el) => el.className === 'pause-tiles')!;
  const sheet = (): FakeEl => body.all().find((el) => el.className === 'pause-sheet')!;
  const tileButton = (label: string): FakeEl => body.find(label)!.parent!;

  it('o ladrilho de conquistas diz quantas já são suas', () => {
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      achievements: () => 0b1011,
    });
    menu.show();
    expect(tileButton('Conquistas').all().find((el) => el.className === 'sub')?.textContent)
      .toBe(`3 de ${ACHIEVEMENTS.length}`);
  });

  it('conquistas abrem no lugar dos ladrilhos, e Voltar devolve', () => {
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      achievements: () => 1,
      stats: () => [],
    });
    menu.show();
    tileButton('Conquistas').click();
    expect(tiles().hidden).toBe(true);
    expect(sheet().hidden).toBe(false);
    const rows = sheet().all().filter((el) => el.className.startsWith('row'));
    expect(rows).toHaveLength(ACHIEVEMENTS.length);

    body.all().find((el) => el.classes.has('back'))!.click();
    expect(tiles().hidden).toBe(false);
    expect(sheet().hidden).toBe(true);
  });

  it('o alvo por tag sai em palavras, não "#logs"', () => {
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      achievements: () => 0,
    });
    menu.show();
    tileButton('Conquistas').click();
    const textos = sheet().all().map((el) => el.textContent).join(' ');
    expect(textos).not.toContain('#');
  });

  it('fechar e reabrir volta aos ladrilhos', () => {
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      stats: () => [],
    });
    menu.show();
    tileButton('Estatísticas').click();
    menu.hide();
    menu.show();
    expect(tiles().hidden).toBe(false);
  });
});

/*
 * O "Sair do Mundo" da tela de morte chamava o mesmo `respawn` do
 * "Reaparecer": o botão prometia sair e não saía. A ligação mora no
 * `main.ts`, que não roda em teste, então a checagem é sobre a fonte — como
 * em `uihidden.test.ts`.
 */
describe('tela de morte', () => {
  it('"Sair do Mundo" grava e sai, em vez de só renascer', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).not.toContain('onQuit: respawn');
    expect(main).toMatch(/onQuit: \(\) => \{ respawn\(\); flow\.saveAndQuit\(\); \}/);
    const flow = readFileSync('src/ui/gameflow.ts', 'utf8');
    expect(flow).toContain('onSaveAndQuit: () => this.saveAndQuit()');
  });
});
