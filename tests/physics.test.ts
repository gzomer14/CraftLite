/**
 * As constantes de física são "o que faz o jogo sentir certo" (doc 06). Estes
 * testes travam os números observáveis — velocidade terminal, altura de pulo,
 * velocidade de caminhada — porque um erro aqui não quebra nada, só deixa o
 * jogo com a sensação errada, que é muito mais difícil de perceber depois.
 */
import { describe, expect, it } from 'vitest';
import { Player, PLAYER_HEIGHT, PLAYER_WIDTH, EYE_HEIGHT } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { makeState, STONE, AIR, WATER } from '../src/data/blocks';
import {
  createAabb, isSpaceBlocked, moveWithCollision, setAabbFromBase,
} from '../src/world/physics';

/**
 * Mundo plano: pedra até `groundY` inclusive, ar acima.
 *
 * O raio precisa cobrir toda a distância que o teste vai percorrer — andar
 * para fora dos chunks carregados faz o jogador cair no vazio e falsear a
 * medição de velocidade.
 */
function flatWorld(groundY = 63, radius = 6): World {
  const world = new World(1);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= groundY; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

const IDLE = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
const WALK = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false };
const SPRINT = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: true };
const SNEAK = { forward: 1, strafe: 0, jump: false, sneak: true, sprint: false };

describe('queda', () => {
  it('a velocidade terminal é 3,92 blocos/tick', () => {
    // Mundo sem chunk nenhum: nada colide, então a queda é livre de verdade.
    const world = new World(1);
    const player = new Player(8, 120, 8);
    for (let i = 0; i < 400; i++) player.tick(world, IDLE);
    expect(Math.abs(player.vy)).toBeCloseTo(3.92, 2);
  });

  it('a gravidade é −0,08 com arrasto 0,98 no primeiro tick', () => {
    const world = new World(1);
    const player = new Player(8, 120, 8);
    player.tick(world, IDLE);
    expect(player.vy).toBeCloseTo((0 - 0.08) * 0.98, 6);
  });

  it('pousa no topo do bloco, sem afundar', () => {
    const world = flatWorld(63);
    const player = new Player(8, 80, 8);
    for (let i = 0; i < 200; i++) player.tick(world, IDLE);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(64, 4);
    expect(player.vy).toBe(0);
  });
});

describe('pulo', () => {
  it('sobe ~1,25 blocos, o suficiente para passar um bloco inteiro', () => {
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    player.tick(world, IDLE); // assenta no chão
    expect(player.onGround).toBe(true);

    const base = player.y;
    let peak = base;
    const jump = { ...IDLE, jump: true };
    for (let i = 0; i < 30; i++) {
      player.tick(world, i === 0 ? jump : IDLE);
      peak = Math.max(peak, player.y);
    }
    const height = peak - base;
    expect(height).toBeGreaterThan(1.0); // passa em cima de um bloco
    expect(height).toBeCloseTo(1.25, 1);
  });

  it('volta ao chão depois do pulo', () => {
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    player.tick(world, IDLE);
    player.tick(world, { ...IDLE, jump: true });
    for (let i = 0; i < 40; i++) player.tick(world, IDLE);
    expect(player.onGround).toBe(true);
    expect(player.y).toBeCloseTo(64, 4);
  });

  it('não pula no ar', () => {
    const world = flatWorld(0);
    const player = new Player(8, 100, 8);
    const before = player.vy;
    player.tick(world, { ...IDLE, jump: true });
    expect(player.vy).toBeLessThan(before);
  });
});

describe('velocidade horizontal', () => {
  const terminalSpeed = (world: World, input: typeof WALK): number => {
    const player = new Player(8, 64, 8);
    player.yaw = 0; // olhando para +Z
    // O atrito 0.546 faz a velocidade convergir em ~20 ticks; 60 sobra.
    for (let i = 0; i < 60; i++) player.tick(world, input);
    expect(player.onGround, 'saiu do chão durante a medição').toBe(true);
    const before = player.z;
    player.tick(world, input);
    return (player.z - before) * 20; // blocos por segundo
  };

  it('caminhando: 4,317 blocos/s (doc 06 §2)', () => {
    expect(terminalSpeed(flatWorld(63), WALK)).toBeCloseTo(4.317, 2);
  });

  it('correndo: 5,612 blocos/s', () => {
    expect(terminalSpeed(flatWorld(63), SPRINT)).toBeCloseTo(5.612, 2);
  });

  it('agachado: 1,295 blocos/s', () => {
    expect(terminalSpeed(flatWorld(63), SNEAK)).toBeCloseTo(1.295, 2);
  });

  it('strafe positivo vai para a DIREITA da câmera', () => {
    // Com yaw=0 a câmera olha para +Z e a direita é −X (sistema destro com
    // up=+Y). Foi aqui que A e D estavam trocados.
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    player.yaw = 0;
    for (let i = 0; i < 30; i++) {
      player.tick(world, { forward: 0, strafe: 1, jump: false, sneak: false, sprint: false });
    }
    expect(player.x).toBeLessThan(8); // andou para −X
    expect(Math.abs(player.z - 8)).toBeLessThan(0.01);
  });

  it('strafe negativo vai para a esquerda', () => {
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    player.yaw = 0;
    for (let i = 0; i < 30; i++) {
      player.tick(world, { forward: 0, strafe: -1, jump: false, sneak: false, sprint: false });
    }
    expect(player.x).toBeGreaterThan(8);
  });

  it('forward positivo vai para onde a câmera olha', () => {
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    player.yaw = 0;
    for (let i = 0; i < 30; i++) player.tick(world, WALK);
    expect(player.z).toBeGreaterThan(8); // +Z, a direção do yaw 0
  });

  it('a diagonal não é mais rápida que a reta', () => {
    const world = flatWorld(63);
    const straight = new Player(8, 64, 8);
    const diagonal = new Player(8, 64, 8);
    for (let i = 0; i < 60; i++) {
      straight.tick(world, WALK);
      diagonal.tick(world, { ...WALK, strafe: 1 });
    }
    expect(diagonal.horizontalSpeed).toBeLessThanOrEqual(straight.horizontalSpeed + 0.01);
  });

  it('para quando o input some', () => {
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    for (let i = 0; i < 60; i++) player.tick(world, WALK);
    for (let i = 0; i < 60; i++) player.tick(world, IDLE);
    expect(player.vx).toBe(0);
    expect(player.vz).toBe(0);
  });
});

describe('colisão', () => {
  it('não atravessa parede', () => {
    const world = flatWorld(63);
    // Parede em z = 20
    for (let y = 64; y < 68; y++) {
      for (let x = 0; x < 16; x++) world.setBlock(x, y, 20, makeState(STONE), 'gen');
    }
    const player = new Player(8, 64, 8);
    player.yaw = 0;
    for (let i = 0; i < 120; i++) player.tick(world, SPRINT);
    expect(player.z).toBeLessThan(20);
    expect(player.aabb[5]).toBeLessThanOrEqual(20.001);
  });

  it('NÃO sobe um degrau de 1 bloco andando — precisa pular', () => {
    // O auto-step é 0.6 (doc 06 §2): sobe laje, não bloco inteiro. É de
    // propósito, e é o que obriga o jogador a pular para subir terreno.
    const world = flatWorld(63);
    for (let x = 0; x < 16; x++) {
      for (let z = 20; z < 24; z++) world.setBlock(x, 64, z, makeState(STONE), 'gen');
    }
    const player = new Player(8, 64, 8);
    player.yaw = 0;
    for (let i = 0; i < 120; i++) player.tick(world, WALK);
    expect(player.y).toBeCloseTo(64, 2);
    expect(player.z).toBeLessThan(20);
  });

  it('pulando, sobe o degrau de 1 bloco', () => {
    const world = flatWorld(63);
    for (let x = 0; x < 16; x++) {
      for (let z = 20; z < 30; z++) world.setBlock(x, 64, z, makeState(STONE), 'gen');
    }
    const player = new Player(8, 64, 8);
    player.yaw = 0;
    for (let i = 0; i < 200; i++) player.tick(world, { ...WALK, jump: true });
    // Pode estar no meio de um pulo; o que importa é ter subido o degrau.
    expect(player.y).toBeGreaterThanOrEqual(65);
    expect(player.z).toBeGreaterThan(20);
  });

  it('o mecanismo de auto-step funciona quando a altura permite', () => {
    // Prova o mecanismo isolado: com folga de 1.05 o degrau de 1 bloco passa.
    const world = flatWorld(63);
    for (let x = 0; x < 16; x++) {
      for (let z = 20; z < 24; z++) world.setBlock(x, 64, z, makeState(STONE), 'gen');
    }
    const box = createAabb();
    // Encostada no degrau, mas sem sobrepor: o teste é sobre subir, não sobre
    // desencavar uma caixa que já começou dentro do bloco.
    setAabbFromBase(box, 8, 64, 19.5, PLAYER_WIDTH, PLAYER_HEIGHT);
    // dy negativo pequeno reproduz a gravidade de um tick em terreno plano.
    const result = moveWithCollision(world, box, 0, -0.0784, 0.4, 1.05);
    expect(box[1]).toBeCloseTo(65, 3);
    expect(result.onGround).toBe(true);
  });

  it('bate a cabeça no teto', () => {
    const world = flatWorld(63);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) world.setBlock(x, 66, z, makeState(STONE), 'gen');
    }
    const player = new Player(8, 64, 8);
    player.tick(world, IDLE);
    for (let i = 0; i < 20; i++) player.tick(world, { ...IDLE, jump: i === 0 });
    expect(player.y + PLAYER_HEIGHT).toBeLessThanOrEqual(66.001);
  });

  it('a hitbox tem as dimensões do doc', () => {
    const player = new Player(8, 64, 8);
    expect(player.aabb[3] - player.aabb[0]).toBeCloseTo(PLAYER_WIDTH, 5);
    expect(player.aabb[4] - player.aabb[1]).toBeCloseTo(PLAYER_HEIGHT, 5);
    expect(player.eyeHeight).toBeCloseTo(EYE_HEIGHT, 5);
  });

  it('agachar diminui a hitbox e a altura dos olhos', () => {
    const world = flatWorld(63);
    const player = new Player(8, 64, 8);
    player.tick(world, IDLE);
    player.tick(world, SNEAK);
    expect(player.height).toBeCloseTo(1.5, 5);
    expect(player.eyeHeight).toBeCloseTo(1.27, 5);
  });
});

describe('moveWithCollision', () => {
  it('não move nada num espaço vazio bloqueado', () => {
    const world = flatWorld(63);
    const box = createAabb();
    setAabbFromBase(box, 8, 70, 8, 0.6, 1.8);
    const r = moveWithCollision(world, box, 0, -20, 0, 0);
    expect(r.onGround).toBe(true);
    expect(box[1]).toBeCloseTo(64, 4);
  });

  it('isSpaceBlocked detecta bloco sólido', () => {
    const world = flatWorld(63);
    const box = createAabb();
    setAabbFromBase(box, 8, 63, 8, 0.6, 1.8);
    expect(isSpaceBlocked(world, box)).toBe(true);
    setAabbFromBase(box, 8, 70, 8, 0.6, 1.8);
    expect(isSpaceBlocked(world, box)).toBe(false);
  });

  it('ar não bloqueia', () => {
    const world = flatWorld(63);
    world.setBlock(8, 64, 8, AIR, 'player');
    const box = createAabb();
    setAabbFromBase(box, 8.5, 64, 8.5, 0.5, 0.5);
    expect(isSpaceBlocked(world, box)).toBe(false);
  });
});

/**
 * Nadar (bug de campo, 2026-09-10: "nadar está extremamente lento").
 *
 * A água aplicava **dois** freios ao mesmo tempo — o atrito do ar (0,91) e o
 * arrasto do fluido (0,8) — e ainda cortava a aceleração em 0,4. A velocidade
 * terminal dava 0,58 blocos/s, sete vezes mais lenta que andar. O doc 06 §3
 * pede só o arrasto: ×0,8.
 */
describe('nadar', () => {
  /** Mundo plano com água do chão até `waterTop`. */
  function floodedWorld(groundY = 60, waterTop = 70): World {
    const world = new World(1);
    for (let cz = -6; cz <= 6; cz++) {
      for (let cx = -6; cx <= 6; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        for (let y = 0; y <= waterTop; y++) {
          const state = y <= groundY ? makeState(STONE) : makeState(WATER);
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, state);
          }
        }
        chunk.recomputeHeightMap();
        world.addChunk(chunk);
      }
    }
    return world;
  }

  /** Deslocamento do tick seguinte, em blocos/s — a mesma régua da caminhada. */
  const swimSpeed = (world: World, y: number): number => {
    const player = new Player(8, y, 8);
    for (let i = 0; i < 200; i++) player.tick(world, WALK);
    expect(player.inWater, 'o teste precisa do jogador submerso').toBe(true);
    const before = player.z;
    player.tick(world, WALK);
    return (player.z - before) * 20;
  };

  it('a velocidade terminal na água é 1,96 blocos/s (doc 06 §3)', () => {
    // 0.02 × 0.98 / (1 − 0.8) = 0.098 blocos/tick = 1,96 blocos/s.
    expect(swimSpeed(floodedWorld(), 66)).toBeCloseTo(1.96, 2);
  });

  it('nadar é mais lento que andar, mas não sete vezes', () => {
    const swim = swimSpeed(floodedWorld(), 66);
    // Andando: 4,317 blocos/s. Antes da correção nadar dava 0,58 — 13% disto.
    expect(swim).toBeLessThan(4.317);
    expect(swim).toBeGreaterThan(4.317 * 0.35);
  });

  it("pisar no fundo não acelera: dentro d'água o arrasto é o mesmo", () => {
    // Com a fórmula de chão dentro d'água a terminal ia a ~9,8 blocos/s.
    expect(swimSpeed(floodedWorld(63, 70), 64)).toBeLessThan(2.6);
  });

  /*
   * Nadar para cima (bug de campo, 2026-09-12, em aparelho T0: "o boneco
   * afunda extremamente rápido e não consegue sair da água").
   *
   * Eram dois defeitos somados, os dois na vertical:
   *
   * 1. O empuxo do doc 06 §3 (+0,02/tick) **apenas cancelava** a gravidade
   *    dentro d'água (0,08 × 0,25 = 0,02/tick). O que sobrava era o resíduo do
   *    arrasto: 0,02 blocos/tick = 0,4 blocos/s subindo contra 1,6 descendo —
   *    quatro vezes mais lento para subir do que para afundar, 2,7 s por bloco.
   * 2. `updateFluidState` sondava `floor(y + 0.1)`, então o empuxo desligava
   *    **um décimo de bloco abaixo** da superfície. Esse décimo é exatamente o
   *    que falta para pisar numa margem no mesmo nível da água: o jogador
   *    ficava preso batendo na parede do lago para sempre.
   *
   * O epsilon não podia ir a zero: parado no fundo da piscina a colisão deixa
   * o jogador na borda exata do bloco e o ponto flutuante joga o `floor()` um
   * bloco para baixo, o que fazia o jogador submerso contar como fora d'água.
   */
  const SWIM_UP = { forward: 0, strafe: 0, jump: true, sneak: false, sprint: false };
  /** Nadando para frente e para cima: é assim que se sai de um lago. */
  const SWIM_OUT = { forward: 1, strafe: 0, jump: true, sneak: false, sprint: false };

  /** Lago a oeste de x=8, margem sólida a leste, os dois com topo em y=64. */
  function shoreWorld(): World {
    const world = new World(1);
    for (let cz = -4; cz <= 4; cz++) {
      for (let cx = -4; cx <= 4; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const solid = cx * 16 + x >= 8;
            for (let y = 0; y <= 59; y++) chunk.setBlock(x, y, z, makeState(STONE));
            for (let y = 60; y <= 63; y++) {
              chunk.setBlock(x, y, z, makeState(solid ? STONE : WATER));
            }
          }
        }
        chunk.recomputeHeightMap();
        world.addChunk(chunk);
      }
    }
    return world;
  }

  it('sobe um bloco na água em menos de 1,5 s', () => {
    const world = shoreWorld();
    const player = new Player(4.5, 61, 8.5);
    const start = player.y;
    let ticks = 0;
    while (player.y - start < 1 && ticks < 400) { player.tick(world, SWIM_UP); ticks++; }
    // Antes da correção: 54 ticks (2,7 s).
    expect(ticks).toBeLessThan(30);
  });

  it('sai da água para uma margem no mesmo nível', () => {
    const world = shoreWorld();
    const player = new Player(4.5, 62, 8.5);
    // `forward` segue (sin yaw, cos yaw): yaw = PI/2 aponta para +X, a margem.
    player.yaw = Math.PI / 2;
    let ticks = 0;
    while (ticks < 400 && !(player.onGround && player.y >= 64)) {
      player.tick(world, SWIM_OUT); ticks++;
    }
    // Antes da correção o jogador empacava em y=63,87 e nunca saía.
    expect(player.y).toBeGreaterThanOrEqual(64);
    expect(player.onGround).toBe(true);
    expect(ticks).toBeLessThan(200);
  });

  it('afundar não é mais rápido que subir', () => {
    const world = shoreWorld();
    const sink = new Player(4.5, 63, 8.5);
    for (let i = 0; i < 60; i++) sink.tick(world, IDLE);
    const rise = new Player(4.5, 61, 8.5);
    for (let i = 0; i < 60; i++) rise.tick(world, SWIM_UP);
    expect(Math.abs(rise.vy)).toBeGreaterThanOrEqual(Math.abs(sink.vy));
  });
});
