/**
 * A primeira hora guiada (M17). O critério do doc 14: *"um jogador novo chega
 * à picareta de pedra sem ler nada fora do jogo"*. O que dá para provar sem
 * gente: cada dica aponta para algo que o jogo oferece naquele momento — o
 * livro de receitas tem a receita, e ela fecha com o que o passo anterior deu
 * —, a dica anda sozinha quando o item aparece, e a linha diz o gesto do
 * aparelho que está na mão.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Guide } from '../src/game/guide';
import { GUIDE_STEPS } from '../src/data/guide';
import { ObjectiveLine, displayOfTarget } from '../src/ui/objectiveline';
import { Session } from '../src/game/session';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { ACHIEVEMENT_BY_NAME, isUnlocked } from '../src/data/achievements';
import { ITEM_BY_NAME, itemId, makeStack, type ItemStack } from '../src/data/items';
import { CRAFT_RESULT } from '../src/game/inventory';
import { setLanguage } from '../src/core/i18n';
import type { Settings } from '../src/game/settings';

afterEach(() => setLanguage('pt'));

const stepOf = (id: string): number => GUIDE_STEPS.findIndex((s) => s.id === id);
const slotsWith = (...names: string[]): (ItemStack | null)[] => {
  const slots: (ItemStack | null)[] = new Array(46).fill(null);
  names.forEach((name, i) => { slots[i] = makeStack(itemId(name), 1); });
  return slots;
};
const bit = (name: string): number => 1 << ACHIEVEMENT_BY_NAME.get(name)!.id;
const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

describe('progresso da dica', () => {
  it('começa no tronco e anda quando o item aparece', () => {
    const guide = new Guide();
    expect(guide.current).toBe(stepOf('log'));
    expect(guide.update(slotsWith(), 0)).toBe(false);
    expect(guide.update(slotsWith('spruce_log'), 0)).toBe(true);
    expect(guide.current).toBe(stepOf('planks'));
  });

  it('pula o que já está cumprido: quem tem bancada vai direto para a picareta', () => {
    const guide = new Guide();
    guide.update(slotsWith('crafting_table'), 0);
    expect(guide.current).toBe(stepOf('pickaxe'));
  });

  it('não volta: gastar as tábuas não traz a dica das tábuas de novo', () => {
    const guide = new Guide();
    guide.update(slotsWith('oak_planks'), 0);
    const after = guide.current;
    guide.update(slotsWith(), 0);
    expect(guide.current).toBe(after);
  });

  it('a conquista também cumpre o passo, sem o item na mochila', () => {
    const guide = new Guide();
    guide.update(slotsWith(), bit('time_to_mine'));
    expect(guide.current).toBe(stepOf('cobble'));
  });

  it('acaba com a picareta de pedra', () => {
    const guide = new Guide();
    guide.update(slotsWith('stone_pickaxe'), 0);
    expect(guide.finished).toBe(true);
    expect(guide.current).toBe(-1);
  });

  it('o save devolve o passo, e valor estranho vira "nada feito"', () => {
    const guide = new Guide();
    guide.restore(3);
    expect(guide.stepsDone).toBe(3);
    guide.restore(999);
    expect(guide.finished).toBe(true);
    guide.restore(-2);
    expect(guide.stepsDone).toBe(0);
    guide.restore(undefined);
    expect(guide.stepsDone).toBe(0);
  });
});

/** A linha do HUD com dependências falsas e controláveis. */
function lineHarness(overrides: Partial<Settings> = {}) {
  const shown: (string | null)[] = [];
  const messages: string[] = [];
  const state = {
    slots: slotsWith(),
    mask: 0,
    survival: true,
    padConnected: false,
    isTouch: false,
  };
  const settings: Partial<Settings> = { guide: true, touchMode: 'B', ...overrides };
  const guide = new Guide();
  const line = new ObjectiveLine({
    hud: {
      setObjective: (text) => { shown.push(text); },
      showMessage: (text) => { messages.push(text); },
    },
    guide,
    slots: () => state.slots,
    achievementMask: () => state.mask,
    survival: () => state.survival,
    settings: { get: ((key: keyof Settings) => settings[key]) as never },
    gamepads: {
      get connected() { return state.padConnected; },
      labels: { r2: 'R2', l2: 'L2', faceLeft: '□' } as never,
    },
    keybinds: { codeFor: () => 'KeyI' },
    get isTouch() { return state.isTouch; },
  });
  return { line, shown, messages, state, settings, guide };
}

describe('a linha do HUD', () => {
  it('no teclado, a dica diz o botão do mouse e a tecla remapeada da mochila', () => {
    const h = lineHarness();
    h.line.refresh();
    expect(last(h.shown)).toBe('Dica — Mire num tronco de árvore e segure o botão esquerdo do mouse até ele quebrar. Junte três.');
    h.state.slots = slotsWith('oak_log');
    h.line.refresh();
    expect(last(h.shown)).toBe('Dica — Aperte I para abrir a mochila. Em Receitas, toque nas tábuas.');
  });

  it('com controle ligado, os botões do controle', () => {
    const h = lineHarness();
    h.state.padConnected = true;
    h.line.refresh();
    expect(last(h.shown)).toContain('segure R2');
  });

  it('no toque, o gesto do modo escolhido', () => {
    const b = lineHarness({ touchMode: 'B' });
    b.state.isTouch = true;
    b.line.refresh();
    expect(last(b.shown)).toContain('segure ⛏');
    const a = lineHarness({ touchMode: 'A' });
    a.state.isTouch = true;
    a.line.refresh();
    expect(last(a.shown)).toContain('segure o dedo em cima');
  });

  it('em inglês, a frase inteira em inglês', () => {
    setLanguage('en');
    const h = lineHarness();
    h.line.refresh();
    expect(last(h.shown)).toBe('Tip — Aim at a tree trunk and hold the left mouse button until it breaks. Gather three.');
  });

  it('só remonta o texto quando o que ela diz muda', () => {
    const h = lineHarness();
    h.line.refresh();
    h.line.refresh();
    h.line.refresh();
    expect(h.shown.length).toBe(1);
  });

  it('ao acabar a dica, avisa uma vez e passa para o objetivo', () => {
    const h = lineHarness();
    h.line.refresh();
    h.state.slots = slotsWith('stone_pickaxe');
    h.line.refresh();
    expect(h.messages.length).toBe(1);
    expect(last(h.shown)).toMatch(/^Objetivo — /);
  });

  it('desligada nas opções ou no Criativo, a linha é o objetivo', () => {
    const off = lineHarness({ guide: false });
    off.line.refresh();
    expect(last(off.shown)).toMatch(/^Objetivo — /);
    const creative = lineHarness();
    creative.state.survival = false;
    creative.line.refresh();
    expect(last(creative.shown)).toMatch(/^Objetivo — /);
  });

  it('regressão: o objetivo muda quando a conquista sai, sem sair do mundo', () => {
    const h = lineHarness({ guide: false });
    h.line.refresh();
    expect(last(h.shown)).toBe('Objetivo — consiga um tronco qualquer');
    h.state.mask = bit('get_wood');
    h.line.refresh();
    expect(last(h.shown)).toBe(`Objetivo — consiga ${displayOfTarget('crafting_table')}`);
  });

  it('confere uma vez por segundo, não a cada quadro', () => {
    const h = lineHarness();
    h.line.frame();
    expect(h.shown.length).toBe(1);
    h.state.slots = slotsWith('oak_log');
    for (let i = 0; i < 30; i++) h.line.frame();
    expect(h.shown.length).toBe(1);
    for (let i = 0; i < 40; i++) h.line.frame();
    expect(h.shown.length).toBe(2);
  });
});

describe('um jogador novo, do tronco à picareta de pedra', () => {
  const GROUND_Y = 63;

  function harness() {
    const world = new World(7);
    const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        for (let y = 0; y <= GROUND_Y; y++) {
          for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
        chunk.recomputeHeightMap();
        for (const section of chunk.sections) {
          section.blockLight = new Uint8Array(2048);
          section.skyLight = new Uint8Array(2048);
        }
        world.addChunk(chunk);
      }
    }
    const player = new Player(8.5, GROUND_Y + 1, 8.5);
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
    });
    return { world, player, session };
  }

  /** O que o jogador faz ao ler "em Receitas, toque em X": acha, preenche e tira. */
  function craftFromBook(session: Session, result: string): void {
    const id = itemId(result);
    const entry = session.recipes.entries().find((e) => e.resultItem === id);
    expect(entry, `Receitas não tem ${result}`).toBeDefined();
    expect(session.workbench.autoFillRecipe(entry!), `faltou ingrediente para ${result}`).toBe(true);
    // Um toque no resultado (o shift faria em lote e gastaria tudo), e o que
    // ficou no cursor vai para o primeiro espaço vazio da mochila.
    const inventory = session.inventory;
    expect(inventory.click(CRAFT_RESULT, 'left')).toBe(true);
    const empty = inventory.slots.findIndex((slot, i) => i < 36 && slot === null);
    expect(inventory.click(empty, 'left')).toBe(true);
  }

  it('numa floresta de bétula, cada dica fecha com o que a anterior deu', () => {
    const { world, player, session } = harness();
    const guide = session.guide;
    const check = (): void => { guide.update(session.inventory.slots, session.achievements.mask); };

    // Tronco: três de bétula, do chão (o caminho de coleta de verdade).
    session.items.spawn(8.5, GROUND_Y + 1, 8.5, makeStack(itemId('birch_log'), 3));
    for (let i = 0; i < 30; i++) session.tick();
    check();
    expect(guide.current).toBe(stepOf('planks'));
    // A primeira medalha sai com qualquer tronco, não só com o de carvalho.
    expect(isUnlocked(session.achievements.mask, 'get_wood')).toBe(true);

    // Mochila → Receitas → tábuas; depois a bancada.
    session.workbench.toggleInventory();
    craftFromBook(session, 'oak_planks');
    check();
    expect(guide.current).toBe(stepOf('table'));
    craftFromBook(session, 'crafting_table');
    check();
    expect(guide.current).toBe(stepOf('pickaxe'));
    session.workbench.closeScreen();

    // Bancada no chão, usar, gravetos e picareta de madeira pelo livro.
    world.setBlock(8, GROUND_Y, 9, makeState(BLOCK_BY_NAME.get('crafting_table')!.id), 'player');
    // Em cima da bancada, olhando para baixo: o alvo é ela.
    player.setPosition(8.5, GROUND_Y + 1, 9.5);
    player.pitch = Math.PI / 2 - 0.01;
    session.interaction.updateTarget();
    session.useHeld();
    expect(session.workbench.openScreen).toBe('crafting');
    // A bancada gastou as quatro tábuas do primeiro tronco: "mais tábuas".
    craftFromBook(session, 'oak_planks');
    craftFromBook(session, 'oak_planks');
    craftFromBook(session, 'stick');
    craftFromBook(session, 'wooden_pickaxe');
    check();
    expect(guide.current).toBe(stepOf('cobble'));
    session.workbench.closeScreen();

    // Pedregulho: a pedra quebrada com a picareta (três, a receita pede três).
    session.inventory.give(itemId('cobblestone'), 3);
    check();
    expect(guide.current).toBe(stepOf('stone_pickaxe'));

    // De volta à bancada: a picareta de pedra.
    session.interaction.updateTarget();
    session.useHeld();
    expect(session.workbench.openScreen).toBe('crafting');
    craftFromBook(session, 'stone_pickaxe');
    check();
    expect(guide.finished).toBe(true);
    expect(session.inventory.countOf(ITEM_BY_NAME.get('stone_pickaxe')!.id)).toBe(1);
  });
});
