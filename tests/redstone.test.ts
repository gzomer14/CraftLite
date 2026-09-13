/**
 * Circuito de redstone (M7): pó, tocha, alavanca, botão, placa, repetidor,
 * pistão, lâmpada e porta.
 *
 * O mundo é uma plataforma de pedra: o pó precisa de apoio opaco embaixo, e é
 * ele que transmite energia de bloco. Nada aqui depende de sorte nem de tempo
 * real — o circuito é drenado dentro do tick e os atrasos são contados em
 * ticks explícitos.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { MAX_POWER, PISTON_LIMIT, Redstone } from '../src/world/redstone';
import { MOUNT_CEILING, MOUNT_FLOOR } from '../src/world/mesh/shapes';
import { AIR, BLOCK_BY_NAME, STONE, blockIdOf, makeState, stateBitsOf } from '../src/data/blocks';
import { toggleOpenState } from '../src/game/interaction';

const GROUND_Y = 63;
const WIRE_Y = GROUND_Y + 1;

const id = (name: string): number => {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`bloco inexistente no teste: ${name}`);
  return def.id;
};

const WIRE = id('redstone_wire');
const LEVER = id('lever');
const BUTTON = id('stone_button');
const PLATE = id('stone_pressure_plate');
const TORCH = id('redstone_torch');
const TORCH_OFF = id('redstone_torch_off');
const REPEATER = id('repeater');
const PISTON = id('piston');
const STICKY = id('sticky_piston');
const PISTON_HEAD = id('piston_head');
const LAMP = id('redstone_lamp');
const LAMP_ON = id('redstone_lamp_on');
const SOURCE = id('redstone_block');
const DOOR = id('oak_door');

/** Plataforma de pedra de 3×3 chunks com ar em cima. */
function stoneWorld(): World {
  const world = new World(7);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      const stone = makeState(STONE);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

interface Rig {
  world: World;
  redstone: Redstone;
  broken: number[];
  /** Escreve um bloco como se fosse o jogador e deixa o circuito reagir. */
  put(x: number, y: number, z: number, block: number, bits?: number): void;
  at(x: number, y: number, z: number): number;
  bitsAt(x: number, y: number, z: number): number;
  power(x: number, z: number): number;
  /** Roda `n` ticks de circuito. */
  run(n?: number): void;
}

function rig(): Rig {
  const world = stoneWorld();
  const broken: number[] = [];
  const redstone = new Redstone(world, {
    onBroken: (_x, _y, _z, state) => broken.push(state),
  });
  redstone.attach();
  return {
    world,
    redstone,
    broken,
    put(x, y, z, block, bits = 0) {
      world.setBlock(x, y, z, makeState(block, bits), 'player');
    },
    at(x, y, z) {
      return blockIdOf(world.getBlock(x, y, z));
    },
    bitsAt(x, y, z) {
      return stateBitsOf(world.getBlock(x, y, z));
    },
    power(x, z) {
      return redstone.powerAt(x, WIRE_Y, z);
    },
    run(n = 1) {
      for (let i = 0; i < n; i++) redstone.tick();
    },
  };
}

/** Fio reto de `length` blocos de pó saindo de (0, WIRE_Y, 0) para +X. */
function wireLine(r: Rig, length: number): void {
  for (let x = 0; x < length; x++) r.put(x, WIRE_Y, 0, WIRE);
}

describe('pó de redstone', () => {
  it('sem fonte, todo o fio fica em zero', () => {
    const r = rig();
    wireLine(r, 5);
    r.run();
    for (let x = 0; x < 5; x++) expect(r.power(x, 0)).toBe(0);
  });

  it('a alavanca energiza o fio inteiro com perda de 1 por bloco', () => {
    const r = rig();
    wireLine(r, 6);
    // Alavanca no chão, ao lado do começo do fio.
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();

    expect(r.power(0, 0)).toBe(MAX_POWER);
    expect(r.power(1, 0)).toBe(MAX_POWER - 1);
    expect(r.power(5, 0)).toBe(MAX_POWER - 5);
  });

  it('o fio inteiro acende no mesmo tick', () => {
    const r = rig();
    wireLine(r, 14);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run(1);
    expect(r.power(13, 0)).toBe(MAX_POWER - 13);
  });

  it('depois de 15 blocos o sinal morre', () => {
    const r = rig();
    wireLine(r, 18);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.power(14, 0)).toBe(1);
    expect(r.power(15, 0)).toBe(0);
    expect(r.power(17, 0)).toBe(0);
  });

  it('desligar a alavanca apaga o fio', () => {
    const r = rig();
    wireLine(r, 6);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.power(3, 0)).toBeGreaterThan(0);

    r.redstone.use(-1, WIRE_Y, 0);
    r.run();
    for (let x = 0; x < 6; x++) expect(r.power(x, 0)).toBe(0);
  });

  it('o bloco de redstone é fonte permanente', () => {
    const r = rig();
    wireLine(r, 4);
    r.put(-1, WIRE_Y, 0, SOURCE);
    r.run();
    expect(r.power(0, 0)).toBe(MAX_POWER);
  });

  it('o pó sobe e desce degrau', () => {
    const r = rig();
    // Degrau: um bloco de pedra em x=2 com pó em cima.
    r.put(0, WIRE_Y, 0, WIRE);
    r.put(1, WIRE_Y, 0, WIRE);
    r.put(2, WIRE_Y, 0, STONE);
    r.put(2, WIRE_Y + 1, 0, WIRE);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.redstone.powerAt(2, WIRE_Y + 1, 0)).toBe(MAX_POWER - 2);
  });

  it('o pó sem apoio cai como item', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, WIRE);
    r.put(0, GROUND_Y, 0, AIR);
    r.run();
    expect(r.at(0, WIRE_Y, 0)).toBe(AIR);
    expect(r.broken.length).toBe(1);
    expect(blockIdOf(r.broken[0])).toBe(WIRE);
  });
});

describe('energia através de bloco', () => {
  it('bloco com energia forte realimenta o pó com 15', () => {
    const r = rig();
    // Alavanca presa no teto de um bloco solto, energizando-o por baixo.
    r.put(4, WIRE_Y, 0, STONE);
    r.put(4, WIRE_Y + 1, 0, LEVER, MOUNT_FLOOR | 8);
    r.put(5, WIRE_Y, 0, WIRE);
    r.run();
    expect(r.power(5, 0)).toBe(MAX_POWER);
  });

  it('energia fraca do pó não atravessa bloco para outro pó', () => {
    const r = rig();
    // pó — bloco — pó: o segundo fio não pode acender.
    r.put(0, WIRE_Y, 0, WIRE);
    r.put(1, WIRE_Y, 0, STONE);
    r.put(2, WIRE_Y, 0, WIRE);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.power(0, 0)).toBe(MAX_POWER);
    expect(r.power(2, 0)).toBe(0);
  });

  it('energia fraca do pó atravessa bloco para ligar mecanismo', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, WIRE);
    r.put(1, WIRE_Y, 0, STONE);
    r.put(2, WIRE_Y, 0, LAMP);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.at(2, WIRE_Y, 0)).toBe(LAMP_ON);
  });
});

describe('lâmpada', () => {
  it('acende com o pó ao lado e apaga quando ele morre', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, LAMP);
    r.put(1, WIRE_Y, 0, WIRE);
    r.put(2, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.at(0, WIRE_Y, 0)).toBe(LAMP_ON);

    r.redstone.use(2, WIRE_Y, 0);
    r.run();
    expect(r.at(0, WIRE_Y, 0)).toBe(LAMP);
  });
});

describe('botão', () => {
  it('solta sozinho depois do tempo da tabela', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, BUTTON, MOUNT_FLOOR);
    r.put(1, WIRE_Y, 0, LAMP);

    expect(r.redstone.use(0, WIRE_Y, 0)).toBe(true);
    r.run();
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(8);
    expect(r.at(1, WIRE_Y, 0)).toBe(LAMP_ON);

    r.run(19);
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(0);
    r.run();
    expect(r.at(1, WIRE_Y, 0)).toBe(LAMP);
  });

  it('clicar de novo no botão apertado não estende o pulso', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, BUTTON, MOUNT_FLOOR);
    r.redstone.use(0, WIRE_Y, 0);
    r.run(5);
    r.redstone.use(0, WIRE_Y, 0);
    r.run(15);
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(0);
  });
});

describe('placa de pressão', () => {
  it('afunda com alguém em cima e sobe quando ele sai', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PLATE);
    r.put(1, WIRE_Y, 0, LAMP);

    r.redstone.beginPlateScan();
    // Pé um fio de cabelo **abaixo** do topo do bloco, como a colisão deixa.
    r.redstone.markEntity(0.5, WIRE_Y - 0.0001, 0.5);
    r.redstone.endPlateScan();
    r.run();
    expect(r.bitsAt(0, WIRE_Y, 0) & 1).toBe(1);
    expect(r.at(1, WIRE_Y, 0)).toBe(LAMP_ON);

    r.redstone.beginPlateScan();
    r.redstone.endPlateScan();
    r.run();
    expect(r.bitsAt(0, WIRE_Y, 0) & 1).toBe(0);
    expect(r.at(1, WIRE_Y, 0)).toBe(LAMP);
  });

  it('ninguém em cima de bloco que não é placa não faz nada', () => {
    const r = rig();
    r.redstone.beginPlateScan();
    r.redstone.markEntity(3.5, WIRE_Y + 0.01, 3.5);
    r.redstone.endPlateScan();
    expect(() => r.run()).not.toThrow();
  });
});

describe('tocha de redstone', () => {
  it('nasce acesa e apaga quando o apoio é energizado', () => {
    const r = rig();
    // Bloco solto com a tocha em cima e uma alavanca presa nele.
    r.put(0, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y + 1, 0, TORCH);
    r.put(1, WIRE_Y, 0, LEVER, 1 | 8); // encaixe cujo apoio fica em −X

    r.run(4);
    expect(r.at(0, WIRE_Y + 1, 0)).toBe(TORCH_OFF);
  });

  it('volta a acender quando o apoio perde a energia', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y + 1, 0, TORCH);
    r.put(1, WIRE_Y, 0, LEVER, 1 | 8);
    r.run(4);
    expect(r.at(0, WIRE_Y + 1, 0)).toBe(TORCH_OFF);

    r.redstone.use(1, WIRE_Y, 0);
    r.run(4);
    expect(r.at(0, WIRE_Y + 1, 0)).toBe(TORCH);
  });

  it('a tocha acesa alimenta o pó ao lado', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y + 1, 0, TORCH);
    r.put(1, WIRE_Y + 1, 0, WIRE);
    r.put(1, WIRE_Y, 0, STONE);
    r.run();
    expect(r.redstone.powerAt(1, WIRE_Y + 1, 0)).toBe(MAX_POWER);
  });

  it('a tocha não energiza o próprio apoio', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y + 1, 0, TORCH);
    // Pó encostado no bloco de apoio: só acenderia se a tocha o energizasse.
    r.put(1, WIRE_Y, 0, WIRE);
    r.run(3);
    expect(r.power(1, 0)).toBe(0);
  });
});

describe('repetidor', () => {
  it('repete com atraso e renova o sinal em 15', () => {
    const r = rig();
    // Fio longo até quase morrer, repetidor, fio de novo.
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    for (let x = 0; x < 14; x++) r.put(x, WIRE_Y, 0, WIRE);
    r.put(14, WIRE_Y, 0, REPEATER, 0); // saída para +X
    r.put(15, WIRE_Y, 0, WIRE);
    r.run();
    expect(r.power(13, 0)).toBe(2);
    // O repetidor ainda não disparou: o atraso é de 1 tick.
    expect(r.power(15, 0)).toBe(0);

    r.run(2);
    expect(r.power(15, 0)).toBe(MAX_POWER);
  });

  it('só aceita entrada por trás', () => {
    const r = rig();
    // Repetidor apontando para +X, alavanca à frente dele.
    r.put(0, WIRE_Y, 0, REPEATER, 0);
    r.put(1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.put(-1, WIRE_Y, 0, WIRE);
    r.run(4);
    expect(r.bitsAt(0, WIRE_Y, 0) & 16).toBe(0);
  });

  it('o clique gira o atraso em quatro posições', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, REPEATER, 0);
    for (let expected = 1; expected <= 3; expected++) {
      r.redstone.use(0, WIRE_Y, 0);
      expect((r.bitsAt(0, WIRE_Y, 0) >> 2) & 3).toBe(expected);
    }
    r.redstone.use(0, WIRE_Y, 0);
    expect((r.bitsAt(0, WIRE_Y, 0) >> 2) & 3).toBe(0);
  });

  it('o atraso maior demora mais ticks', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, REPEATER, 0 | (3 << 2)); // atraso 4 ticks
    r.put(1, WIRE_Y, 0, LAMP);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run(3);
    expect(r.at(1, WIRE_Y, 0)).toBe(LAMP);
    r.run(3);
    expect(r.at(1, WIRE_Y, 0)).toBe(LAMP_ON);
  });
});

describe('porta', () => {
  it('abre com energia e fecha sem ela', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, DOOR, 0);
    r.put(1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.bitsAt(0, WIRE_Y, 0) & 4).toBe(4);

    r.redstone.use(1, WIRE_Y, 0);
    r.run();
    expect(r.bitsAt(0, WIRE_Y, 0) & 4).toBe(0);
  });

  /**
   * Regressão: a primeira versão fechava a porta no mesmo tick em que a mão a
   * abria, porque o circuito reavaliava a posição e não via energia nenhuma.
   */
  it('a porta aberta na mão continua aberta sem circuito por perto', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, DOOR, 0);
    r.run();
    const aberta = toggleOpenState(r.world.getBlock(0, WIRE_Y, 0));
    r.world.setBlock(0, WIRE_Y, 0, aberta, 'player');
    r.run(5);
    expect(r.bitsAt(0, WIRE_Y, 0) & 4).toBe(4);
  });

  it('a porta aberta na mão fecha quando a energia que a abriu cai', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, DOOR, 0);
    r.put(1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.bitsAt(0, WIRE_Y, 0) & 4).toBe(4);

    // O jogador fecha na mão; a alavanca continua ligada.
    r.world.setBlock(0, WIRE_Y, 0, toggleOpenState(r.world.getBlock(0, WIRE_Y, 0)), 'player');
    r.run(2);
    expect(r.bitsAt(0, WIRE_Y, 0) & 4).toBe(0);

    // Desligar a alavanca não reabre — só confirma o fechado.
    r.redstone.use(1, WIRE_Y, 0);
    r.run(2);
    expect(r.bitsAt(0, WIRE_Y, 0) & 4).toBe(0);
  });
});

describe('pistão', () => {
  it('estende com energia e põe o braço à frente', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 0); // aponta para +X
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(8);
    expect(r.at(1, WIRE_Y, 0)).toBe(PISTON_HEAD);
  });

  it('empurra a coluna de blocos à frente', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 0);
    r.put(1, WIRE_Y, 0, STONE);
    r.put(2, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.at(1, WIRE_Y, 0)).toBe(PISTON_HEAD);
    expect(r.at(2, WIRE_Y, 0)).toBe(STONE);
    expect(r.at(3, WIRE_Y, 0)).toBe(STONE);
  });

  it('não empurra mais que o limite', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 0);
    for (let x = 1; x <= PISTON_LIMIT + 1; x++) r.put(x, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(0);
    expect(r.at(1, WIRE_Y, 0)).toBe(STONE);
  });

  it('não empurra bloco imóvel', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 0);
    r.put(1, WIRE_Y, 0, id('obsidian'));
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(0);
    expect(r.at(1, WIRE_Y, 0)).toBe(id('obsidian'));
  });

  it('recolhe e tira o braço quando a energia some', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 0);
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.at(1, WIRE_Y, 0)).toBe(PISTON_HEAD);

    r.redstone.use(0, WIRE_Y, -1);
    r.run(2);
    expect(r.at(1, WIRE_Y, 0)).toBe(AIR);
    expect(r.bitsAt(0, WIRE_Y, 0) & 8).toBe(0);
  });

  it('o pegajoso traz o bloco de volta ao recolher', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, STICKY, 0);
    r.put(1, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.at(2, WIRE_Y, 0)).toBe(STONE);

    r.redstone.use(0, WIRE_Y, -1);
    r.run(2);
    expect(r.at(1, WIRE_Y, 0)).toBe(STONE);
    expect(r.at(2, WIRE_Y, 0)).toBe(AIR);
  });

  it('o pistão comum deixa o bloco onde empurrou', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 0);
    r.put(1, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    r.redstone.use(0, WIRE_Y, -1);
    r.run(2);
    expect(r.at(1, WIRE_Y, 0)).toBe(AIR);
    expect(r.at(2, WIRE_Y, 0)).toBe(STONE);
  });

  it('empurra para cima também', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, PISTON, 4); // aponta para +Y
    r.put(0, WIRE_Y + 1, 0, STONE);
    r.put(0, WIRE_Y, -1, LEVER, MOUNT_FLOOR | 8);
    r.run(2);
    expect(r.at(0, WIRE_Y + 1, 0)).toBe(PISTON_HEAD);
    expect(r.at(0, WIRE_Y + 2, 0)).toBe(STONE);
  });
});

describe('apoio e encaixe', () => {
  it('a alavanca cai quando a parede some', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, STONE);
    // Alavanca na parede +X do bloco em (0): ela fica em (1) e aponta para −X.
    r.put(1, WIRE_Y, 0, LEVER, 1);
    r.run();
    expect(r.at(1, WIRE_Y, 0)).toBe(LEVER);

    r.put(0, WIRE_Y, 0, AIR);
    r.run();
    expect(r.at(1, WIRE_Y, 0)).toBe(AIR);
    expect(r.broken.some((state) => blockIdOf(state) === LEVER)).toBe(true);
  });

  it('o encaixe no teto procura o apoio em cima', () => {
    const r = rig();
    r.put(0, WIRE_Y + 2, 0, STONE);
    r.put(0, WIRE_Y + 1, 0, LEVER, MOUNT_CEILING);
    r.run();
    expect(r.at(0, WIRE_Y + 1, 0)).toBe(LEVER);

    r.put(0, WIRE_Y + 2, 0, AIR);
    r.run();
    expect(r.at(0, WIRE_Y + 1, 0)).toBe(AIR);
  });
});

describe('orçamento', () => {
  it('um oscilador de tocha não trava o tick', () => {
    const r = rig();
    // Tocha alimentando o próprio apoio através do pó: oscila para sempre.
    r.put(0, WIRE_Y, 0, STONE);
    r.put(0, WIRE_Y + 1, 0, TORCH);
    r.put(1, WIRE_Y + 1, 0, WIRE);
    r.put(1, WIRE_Y, 0, STONE);
    r.put(1, WIRE_Y - 1, 0, WIRE);

    for (let i = 0; i < 200; i++) r.redstone.tick();
    expect(r.redstone.lastUpdates).toBeLessThan(1024);
  });

  it('um fio de 15 blocos custa poucas dezenas de atualizações', () => {
    const r = rig();
    wireLine(r, 15);
    r.run();
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.redstone.lastUpdates).toBeLessThan(400);
  });

  /**
   * A armadilha clássica do pó: quando a fonte some, cada célula recalcula a
   * partir da vizinha que ainda **não** recalculou, e o fio "decai" um degrau
   * por tick em vez de apagar. Drenar a fila dentro do tick é o que resolve —
   * este teste é o que garante que continue assim num fio comprido.
   */
  it('um fio de 60 blocos apaga por inteiro em um tick só', () => {
    const r = rig();
    wireLine(r, 60);
    r.put(-1, WIRE_Y, 0, LEVER, MOUNT_FLOOR | 8);
    r.run();
    expect(r.power(0, 0)).toBe(MAX_POWER);

    r.redstone.use(-1, WIRE_Y, 0);
    r.run();
    for (let x = 0; x < 60; x++) expect(r.power(x, 0), `x=${x}`).toBe(0);
    expect(r.redstone.pending).toBe(0);
  });

  it('mundo sem circuito nenhum não enfileira nada', () => {
    const r = rig();
    r.put(0, WIRE_Y, 0, STONE);
    r.put(3, WIRE_Y, 0, STONE);
    r.run();
    expect(r.redstone.pending).toBe(0);
    expect(r.redstone.lastUpdates).toBe(0);
  });
});
