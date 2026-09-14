/**
 * Vida, fome e saturação (doc 06 §6 e §7).
 *
 * Estes números definem o ritmo do jogo — quanto dá para explorar sem comer,
 * quão punitiva é uma queda. São exatamente o tipo de constante que passa
 * despercebida quando erra.
 */
import { describe, expect, it } from 'vitest';
import { Survival, EXHAUSTION, MAX_HEALTH, MAX_HUNGER } from '../src/game/survival';

const CALM = { submerged: false, inLava: false, onFire: false, suffocating: false, y: 64 };

function run(s: Survival, ticks: number, context = CALM): void {
  for (let i = 0; i < ticks; i++) s.tick(context);
}

describe('estado inicial', () => {
  it('começa com vida e fome cheias', () => {
    const s = new Survival();
    expect(s.health).toBe(MAX_HEALTH);
    expect(s.hunger).toBe(MAX_HUNGER);
    expect(s.isDead).toBe(false);
  });
});

describe('exaustão e fome', () => {
  it('4 de exaustão consomem 1 de saturação', () => {
    const s = new Survival();
    s.saturation = 5;
    s.addExhaustion(4);
    run(s, 1);
    expect(s.saturation).toBe(4);
    expect(s.hunger).toBe(MAX_HUNGER);
  });

  it('sem saturação, a exaustão come a fome', () => {
    const s = new Survival();
    s.saturation = 0;
    s.addExhaustion(4);
    run(s, 1);
    expect(s.hunger).toBe(MAX_HUNGER - 1);
  });

  it('correr gasta 0,1 por bloco', () => {
    const s = new Survival();
    s.saturation = 0;
    // 40 blocos correndo = 4,0 de exaustão = 1 de fome.
    for (let i = 0; i < 40; i++) s.addExhaustion(EXHAUSTION.sprintPerBlock);
    run(s, 1);
    expect(s.hunger).toBe(MAX_HUNGER - 1);
  });

  it('quebrar bloco gasta muito pouco', () => {
    const s = new Survival();
    s.saturation = 0;
    for (let i = 0; i < 100; i++) s.addExhaustion(EXHAUSTION.breakBlock);
    run(s, 1);
    // 100 blocos = 0,5 de exaustão: ainda não tirou nem 1 de fome.
    expect(s.hunger).toBe(MAX_HUNGER);
  });

  it('no pacífico não há fome', () => {
    const s = new Survival();
    s.difficulty = 0;
    s.saturation = 0;
    s.addExhaustion(100);
    run(s, 1);
    expect(s.hunger).toBe(MAX_HUNGER);
  });
});

describe('regeneração', () => {
  it('com fome cheia e saturação, cura 1♥ a cada 10 ticks', () => {
    const s = new Survival();
    s.health = 10;
    s.saturation = 20;
    run(s, 10);
    expect(s.health).toBe(11);
  });

  it('sem saturação a regeneração é lenta (80 ticks)', () => {
    const s = new Survival();
    s.health = 10;
    s.saturation = 0;
    run(s, 40);
    expect(s.health).toBe(10);
    run(s, 45);
    expect(s.health).toBe(11);
  });

  it('com fome ≤ 17 não regenera', () => {
    const s = new Survival();
    s.health = 10;
    s.hunger = 17;
    s.saturation = 20;
    run(s, 200);
    expect(s.health).toBe(10);
  });

  it('não passa da vida máxima', () => {
    const s = new Survival();
    s.saturation = 20;
    run(s, 500);
    expect(s.health).toBe(MAX_HEALTH);
  });
});

describe('inanição', () => {
  it('com fome 0 perde 1♥ a cada 80 ticks', () => {
    const s = new Survival();
    s.hunger = 0;
    s.saturation = 0;
    run(s, 80);
    expect(s.health).toBe(MAX_HEALTH - 1);
  });

  it('no Normal a inanição para em 1♥', () => {
    const s = new Survival();
    s.difficulty = 2;
    s.hunger = 0;
    s.saturation = 0;
    s.health = 2;
    run(s, 800);
    expect(s.health).toBe(1);
    expect(s.isDead).toBe(false);
  });

  it('no Fácil a inanição para em 10♥', () => {
    const s = new Survival();
    s.difficulty = 1;
    s.hunger = 0;
    s.saturation = 0;
    run(s, 2000);
    expect(s.health).toBe(10);
  });

  it('no Difícil a inanição mata', () => {
    const s = new Survival();
    s.difficulty = 3;
    s.hunger = 0;
    s.saturation = 0;
    s.health = 2;
    run(s, 400);
    expect(s.isDead).toBe(true);
  });
});

describe('correr', () => {
  it('com fome ≤ 6 não pode correr', () => {
    const s = new Survival();
    s.hunger = 6;
    expect(s.canSprint).toBe(false);
    s.hunger = 7;
    expect(s.canSprint).toBe(true);
  });
});

describe('dano', () => {
  it('a invulnerabilidade bloqueia dano seguido', () => {
    const s = new Survival();
    expect(s.damage(3, 'mob')).toBe(true);
    expect(s.damage(3, 'mob')).toBe(false);
    expect(s.health).toBe(17);
  });

  it('a invulnerabilidade expira em 10 ticks', () => {
    const s = new Survival();
    s.damage(3, 'mob');
    run(s, 11);
    expect(s.damage(3, 'mob')).toBe(true);
  });

  it('void ignora a invulnerabilidade', () => {
    const s = new Survival();
    s.damage(1, 'mob');
    expect(s.damage(4, 'void', true)).toBe(true);
  });

  it('dano de mob escala com a dificuldade', () => {
    const easy = new Survival();
    easy.difficulty = 1;
    easy.damage(4, 'mob');
    expect(easy.health).toBe(18); // ×0,5

    const hard = new Survival();
    hard.difficulty = 3;
    hard.damage(4, 'mob');
    expect(hard.health).toBe(14); // ×1,5
  });

  it('dano de ambiente não escala', () => {
    const hard = new Survival();
    hard.difficulty = 3;
    hard.damage(4, 'lava');
    expect(hard.health).toBe(16);
  });

  it('no pacífico mob não causa dano', () => {
    const s = new Survival();
    s.difficulty = 0;
    expect(s.damage(10, 'mob')).toBe(false);
    expect(s.health).toBe(MAX_HEALTH);
  });

  it('avisa a morte com a causa', () => {
    const s = new Survival();
    let cause = '';
    s.onDeath = (c) => { cause = c; };
    s.damage(100, 'fall');
    expect(s.isDead).toBe(true);
    expect(cause).toBe('fall');
    expect(s.deathMessage).toContain('caiu');
  });
});

describe('dano de queda', () => {
  it('cair 3 blocos não machuca', () => {
    const s = new Survival();
    s.applyFallDamage(3);
    expect(s.health).toBe(MAX_HEALTH);
  });

  it('cair 5 blocos tira 2♥', () => {
    const s = new Survival();
    s.applyFallDamage(5);
    expect(s.health).toBe(MAX_HEALTH - 2);
  });

  it('cair 23 blocos mata', () => {
    const s = new Survival();
    s.applyFallDamage(23);
    expect(s.isDead).toBe(true);
  });
});

describe('afogamento', () => {
  it('o ar cai debaixo d’água e o dano começa depois que zera', () => {
    const s = new Survival();
    const water = { ...CALM, submerged: true };
    run(s, 300, water);
    expect(s.air).toBe(0);
    expect(s.health).toBe(MAX_HEALTH);
    run(s, 20, water);
    expect(s.health).toBe(MAX_HEALTH - 2);
  });

  it('o ar volta fora d’água', () => {
    const s = new Survival();
    run(s, 100, { ...CALM, submerged: true });
    const low = s.air;
    run(s, 30);
    expect(s.air).toBeGreaterThan(low);
  });
});

describe('comer', () => {
  it('restaura fome e saturação', () => {
    const s = new Survival();
    s.hunger = 10;
    s.saturation = 0;
    s.eat(5, 6);
    expect(s.hunger).toBe(15);
    expect(s.saturation).toBe(6);
  });

  it('a saturação nunca passa da fome', () => {
    const s = new Survival();
    s.hunger = 4;
    s.saturation = 0;
    s.eat(2, 20);
    expect(s.saturation).toBe(6);
    expect(s.saturation).toBeLessThanOrEqual(s.hunger);
  });

  it('não come com a fome cheia', () => {
    expect(new Survival().canEat).toBe(false);
  });
});

describe('respawn', () => {
  it('restaura tudo', () => {
    const s = new Survival();
    s.damage(100, 'fall');
    s.hunger = 0;
    s.respawn();
    expect(s.health).toBe(MAX_HEALTH);
    expect(s.hunger).toBe(MAX_HUNGER);
    expect(s.isDead).toBe(false);
    expect(s.lastCause).toBeNull();
  });
});

/**
 * Fogo (doc 04 `flammable` + `world/fire.ts`).
 *
 * O contrato é **poder escapar**: atravessar uma chama custa caro, ficar
 * parado nela mata. Com dano por tick um único bloco de fogo seria morte
 * instantânea, e um incêndio deixaria de ser algo com que se convive.
 */
describe('dano de fogo', () => {
  const BURNING = { ...CALM, onFire: true };

  it('não mata em um tick — dá para atravessar a chama', () => {
    const s = new Survival();
    s.tick(BURNING);
    expect(s.health).toBe(MAX_HEALTH);
  });

  it('cobra a cada meio segundo enquanto o jogador ficar dentro', () => {
    const s = new Survival();
    run(s, 10, BURNING);
    expect(s.health).toBeLessThan(MAX_HEALTH);
    const afterFirst = s.health;
    run(s, 10, BURNING);
    expect(s.health).toBeLessThan(afterFirst);
  });

  it('sair do fogo zera a conta: dez ticks dentro e dez fora não machucam', () => {
    const s = new Survival();
    for (let i = 0; i < 5; i++) s.tick(BURNING);
    for (let i = 0; i < 20; i++) s.tick(CALM);
    for (let i = 0; i < 5; i++) s.tick(BURNING);
    expect(s.health).toBe(MAX_HEALTH);
  });

  it('a causa da morte é a do doc', () => {
    const s = new Survival();
    run(s, 400, BURNING);
    expect(s.isDead).toBe(true);
    expect(s.lastCause).toBe('fire');
  });
});
