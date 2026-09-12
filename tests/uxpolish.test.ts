/**
 * As sete queixas da revisão de 2026-09-11 (sessão "navegada geral").
 *
 * Cada bloco aqui existe porque o jogo falhou no teste de alguém tentando
 * jogar, não porque um módulo estava errado por dentro. São regressões de
 * experiência: se voltarem, o jogo volta a ser confuso sem quebrar nada.
 */
import { describe, expect, it } from 'vitest';
import { autoGuiScale } from '../src/ui/hud';
import { ACHIEVEMENTS, isUnlocked, nextObjective, objectiveFor } from '../src/data/achievements';
import { ITEM_BY_NAME } from '../src/data/items';
import { MOB_BY_NAME } from '../src/data/mobs';
import { Player, PLAYER_WIDTH } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { readFileSync } from 'node:fs';

const displayOf = (target: string): string =>
  ITEM_BY_NAME.get(target)?.display ?? MOB_BY_NAME.get(target)?.display ?? target;

describe('1. escala da interface no celular', () => {
  /**
   * O piso de toque era 3. Num celular deitado (~360 px de altura) isso dava a
   * mesma escala de um desktop de 1280×800, e o painel do inventário saía com
   * 755 px numa tela de 360.
   */
  const CELULARES: readonly [number, number, string][] = [
    [640, 360, 'emulador deitado'],
    [738, 415, 'Moto G4 deitado'],
    [844, 390, 'iPhone deitado'],
    [360, 640, 'em pé'],
  ];

  for (const [w, h, nome] of CELULARES) {
    it(`${nome} (${w}×${h}) não passa de 2`, () => {
      expect(autoGuiScale(w, h, true)).toBeLessThanOrEqual(2);
    });
  }

  it('nunca desce de 2 no toque: 18 px de slot seria pequeno demais', () => {
    for (const [w, h] of CELULARES) expect(autoGuiScale(w, h, true)).toBeGreaterThanOrEqual(2);
  });

  it('o desktop continua como era', () => {
    expect(autoGuiScale(1280, 800, false)).toBe(3);
    expect(autoGuiScale(1920, 1080, false)).toBe(4);
  });

  it('um celular não recebe mais a mesma escala de um desktop', () => {
    expect(autoGuiScale(640, 360, true)).toBeLessThan(autoGuiScale(1280, 800, false));
  });
});

describe('3 e 7. a árvore de conquistas diz o que fazer', () => {
  it('com nada obtido, já há um objetivo à vista', () => {
    const next = nextObjective(0);
    expect(next).toBeDefined();
    expect(next!.parent).toBeUndefined();
  });

  it('o objetivo é uma frase com o alvo, não "faça algo novo"', () => {
    const next = nextObjective(0)!;
    const texto = objectiveFor(next, displayOf);
    expect(texto).not.toBe('faça algo novo');
    expect(texto.length).toBeGreaterThan(10);
  });

  it('obter uma conquista revela a seguinte', () => {
    const primeira = nextObjective(0)!;
    const filha = ACHIEVEMENTS.find((a) => a.parent === primeira.name);
    expect(filha, 'a primeira conquista precisa ter continuação').toBeDefined();

    const mask = 1 << primeira.id;
    expect(isUnlocked(mask, primeira.name)).toBe(true);
    // A filha agora está à vista, mesmo sem ter sido obtida.
    expect(filha!.parent !== undefined && isUnlocked(mask, filha!.parent)).toBe(true);
  });

  it('toda conquista produz um objetivo legível', () => {
    for (const def of ACHIEVEMENTS) {
      const texto = objectiveFor(def, displayOf);
      expect(texto.length, def.name).toBeGreaterThan(8);
      // Nada de nome interno vazando para a tela.
      expect(texto, def.name).not.toMatch(/_/);
    }
  });

  it('com tudo obtido, não sobra objetivo', () => {
    let mask = 0;
    for (const def of ACHIEVEMENTS) mask |= 1 << def.id;
    expect(nextObjective(mask)).toBeUndefined();
  });
});

describe('6. pulo automático', () => {
  const GROUND = 64;
  const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);

  /** Plataforma plana com um degrau de `altura` blocos na faixa z >= 4. */
  function world(altura: number): World {
    const w = new World(7);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const c = new ChunkColumn(cx, cz);
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const wz = (cz << 4) + z;
            const topo = wz >= 4 ? GROUND + altura : GROUND;
            for (let y = 0; y <= topo; y++) c.setBlock(x, y, z, stone);
          }
        }
        c.recomputeHeightMap();
        for (const s of c.sections) {
          s.blockLight = new Uint8Array(2048);
          s.skyLight = new Uint8Array(2048);
        }
        w.addChunk(c);
      }
    }
    return w;
  }

  /** Anda para frente por `ticks` e devolve o Y final. */
  function caminha(w: World, autoJump: boolean, ticks = 80): number {
    const p = new Player(8.5, GROUND + 1, 0.5);
    p.autoJump = autoJump;
    p.yaw = 0; // +Z
    for (let t = 0; t < ticks; t++) {
      p.tick(w, { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false });
    }
    return p.y;
  }

  it('sobe um degrau de um bloco sem o jogador pular', () => {
    expect(caminha(world(1), true)).toBeGreaterThan(GROUND + 1.5);
  });

  it('desligado, o mesmo degrau barra o jogador', () => {
    expect(caminha(world(1), false)).toBeLessThan(GROUND + 1.5);
  });

  it('não escala parede de dois blocos — não é voar', () => {
    expect(caminha(world(2), true)).toBeLessThan(GROUND + 1.5);
  });

  it('parado, não pula sozinho', () => {
    const w = world(1);
    const p = new Player(8.5, GROUND + 1, 0.5);
    p.autoJump = true;
    for (let t = 0; t < 40; t++) {
      p.tick(w, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false });
    }
    expect(p.onGround).toBe(true);
    expect(p.vy).toBeLessThanOrEqual(0);
  });

  it('a largura do jogador continua sendo a do doc 06', () => {
    expect(PLAYER_WIDTH).toBe(0.6);
  });
});

describe('2. o livro de receitas não nasce vazio', () => {
  const src = readFileSync('src/ui/containers/recipebook.ts', 'utf8');

  it('o filtro "só o que dá" começa desligado', () => {
    // Ligado, o livro de quem acabou de entrar no mundo abria dizendo
    // "Nada para fazer com o que você tem" — vazio na hora em que mais serve.
    expect(src).toMatch(/this\.onlyAvailable\.checked\s*=\s*false/);
  });

  it('o que não dá aparece em cinza, como o doc 08 §3.5 pede', () => {
    expect(src.replace(/\s+/g, '')).toContain('.recipe.missing{filter:grayscale(1)');
  });

  it('o que dá vem antes do que falta ingrediente', () => {
    expect(src).toContain('for (const pass of [true, false])');
  });
});

describe('4. o botão de voar só existe no criativo', () => {
  const src = readFileSync('src/ui/touchui.ts', 'utf8');

  it('nasce escondido', () => {
    expect(src).toMatch(/this\.flyButton\.hidden\s*=\s*true/);
  });

  it('há um jeito de ligá-lo, e ele olha o modo', () => {
    expect(src).toContain('setCreative(creative: boolean)');
    expect(readFileSync('src/main.ts', 'utf8'))
      .toContain("touchUi.setCreative(player.mode === 'creative')");
  });
});

describe('5. o HUD não passa por baixo dos botões de toque', () => {
  it('a TouchUi publica a largura ocupada pelos pads', () => {
    expect(readFileSync('src/ui/touchui.ts', 'utf8')).toContain("'--touch-pad'");
  });

  it('a barra de vida e fome desconta essa largura dos dois lados', () => {
    const css = readFileSync('src/ui/hud.ts', 'utf8').replace(/\s+/g, '');
    expect(css).toContain('max-width:calc(100vw-16px-2*var(--touch-pad,0px))');
  });
});

/**
 * Regressões da queixa de 2026-09-11 sobre o painel e a escala:
 * *"O inventário ficou quebrado, está extrapolando o tamanho"* e *"a escala da
 * interface começa em automático e a próxima opção já é 1x"*.
 */
describe('painel não vaza, e a escala responde', () => {
  const screenSrc = readFileSync('src/ui/containers/screen.ts', 'utf8');
  const hudSrc = readFileSync('src/ui/hud.ts', 'utf8');
  const optionsSrc = readFileSync('src/ui/screens/options.ts', 'utf8');

  it('as colunas do painel são contêineres, não multi-coluna do CSS', () => {
    // `columns:2` reparte a largura em partes iguais, e a fileira de 9 slots
    // da mochila é mais larga que metade do painel: ela vazava pela borda.
    expect(screenSrc).not.toContain('columns:2');
    expect(screenSrc).toContain('grid-col');
    expect(screenSrc.replace(/\s+/g, '')).toContain('flex-flow:rowwrap');
  });

  it('a coluna larga existe e recebe a mochila', () => {
    expect(screenSrc).toContain('this.column = this.mainColumn;');
  });

  it('a escala da interface tem passo de meio', () => {
    // Com passo 1, o vizinho de "automática" era 1×: num aparelho cuja
    // automática já é 2× não havia como pedir só um pouco menor.
    expect(optionsSrc).toMatch(/key: 'guiScale'[\s\S]*?step: 0\.5/);
  });

  it('a escala segue as opções, não só o resize da janela', () => {
    // `updateScale` só rodava no boot e no `resize`: mexer no slider trocava o
    // rótulo e não mudava nada na tela.
    expect(hudSrc).toContain('settings?.onChange(() => this.updateScale())');
  });
});
