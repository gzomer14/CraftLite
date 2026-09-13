/**
 * Trilhos e carrinho de mina (M7).
 *
 * Duas coisas testadas juntas porque uma só existe pela outra: a forma do
 * trilho é escrita no estado **para o carrinho ler**. O mundo é uma plataforma
 * de pedra, sem GL e sem DOM, e nada aqui depende de sorte.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Rails, isRail, railShapeOf } from '../src/world/rails';
import { MAX_SPEED, Minecarts, alignDirection, slopeOffset } from '../src/entity/minecart';
import { Redstone } from '../src/world/redstone';
import {
  RAIL_ASCEND_EAST, RAIL_ASCEND_WEST, RAIL_CURVE_NE, RAIL_CURVE_SE, RAIL_CURVE_SW,
  RAIL_EW, RAIL_NS, RAIL_POWERED, railIsCurve, railIsSlope, railSlopeDir,
} from '../src/world/mesh/shapes';
import { AIR, BLOCK_BY_NAME, STONE, blockIdOf, makeState, stateBitsOf } from '../src/data/blocks';
import { MOUNT_FLOOR } from '../src/world/mesh/shapes';
import { ITEM_BY_NAME, makeStack } from '../src/data/items';
import { Player } from '../src/entity/player';
import { Session } from '../src/game/session';

const GROUND = 63;
const RAIL_Y = GROUND + 1;

const id = (name: string): number => {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`bloco inexistente no teste: ${name}`);
  return def.id;
};

const RAIL = id('rail');
const POWERED_RAIL = id('powered_rail');
const DETECTOR_RAIL = id('detector_rail');
const LEVER = id('lever');

interface Rig {
  world: World;
  rails: Rails;
  broken: number[];
  put(x: number, y: number, z: number, block: number, bits?: number): void;
  shape(x: number, z: number, y?: number): number;
  run(n?: number): void;
}

function stoneWorld(): World {
  const world = new World(99);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      const stone = makeState(STONE);
      for (let y = 0; y <= GROUND; y++) {
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

function rig(): Rig {
  const world = stoneWorld();
  const broken: number[] = [];
  const rails = new Rails(world, { onBroken: (_x, _y, _z, state) => broken.push(state) });
  rails.attach();
  return {
    world,
    rails,
    broken,
    put(x, y, z, block, bits = 0) {
      world.setBlock(x, y, z, makeState(block, bits), 'player');
    },
    shape(x, z, y = RAIL_Y) {
      return railShapeOf(world.getBlock(x, y, z));
    },
    run(n = 1) {
      for (let i = 0; i < n; i++) rails.tick();
    },
  };
}

/** Linha reta de trilhos de `0` a `length-1` em +X, em `RAIL_Y`. */
function line(r: Rig, length: number, block = RAIL): void {
  for (let x = 0; x < length; x++) r.put(x, RAIL_Y, 0, block);
  r.run();
}

// --- forma -----------------------------------------------------------------

describe('forma do trilho', () => {
  it('um trilho sozinho fica reto', () => {
    const r = rig();
    r.put(0, RAIL_Y, 0, RAIL);
    r.run();
    expect(railIsCurve(r.shape(0, 0))).toBe(false);
    expect(railIsSlope(r.shape(0, 0))).toBe(false);
  });

  it('uma linha em X vira toda leste-oeste', () => {
    const r = rig();
    line(r, 5);
    for (let x = 0; x < 5; x++) expect(r.shape(x, 0), `x=${x}`).toBe(RAIL_EW);
  });

  it('uma linha em Z vira toda norte-sul', () => {
    const r = rig();
    for (let z = 0; z < 5; z++) r.put(0, RAIL_Y, z, RAIL);
    r.run();
    for (let z = 0; z < 5; z++) expect(r.shape(0, z), `z=${z}`).toBe(RAIL_NS);
  });

  it('o canto entre os dois eixos vira curva', () => {
    const r = rig();
    // Um L: (0,0)–(1,0) em X e (1,0)–(1,1) em Z. O canto é (1,0).
    r.put(0, RAIL_Y, 0, RAIL);
    r.put(1, RAIL_Y, 0, RAIL);
    r.put(1, RAIL_Y, 1, RAIL);
    r.run();
    expect(railIsCurve(r.shape(1, 0))).toBe(true);
    // A curva liga −X (de onde vem) e +Z (para onde vai).
    expect(r.shape(1, 0)).toBe(RAIL_CURVE_SW);
  });

  it('o trilho vira rampa quando o vizinho está um nível acima', () => {
    const r = rig();
    r.put(0, RAIL_Y, 0, RAIL);
    // Degrau de pedra em x=1 com trilho em cima.
    r.put(1, RAIL_Y, 0, STONE);
    r.put(1, RAIL_Y + 1, 0, RAIL);
    r.run();
    expect(r.shape(0, 0)).toBe(RAIL_ASCEND_EAST);
    expect(railSlopeDir(RAIL_ASCEND_EAST)).toBe(0);
  });

  it('a rampa aponta para o outro lado quando o degrau está em −X', () => {
    const r = rig();
    r.put(1, RAIL_Y, 0, RAIL);
    r.put(0, RAIL_Y, 0, STONE);
    r.put(0, RAIL_Y + 1, 0, RAIL);
    r.run();
    expect(r.shape(1, 0)).toBe(RAIL_ASCEND_WEST);
  });

  it('a forma se refaz quando um vizinho some', () => {
    const r = rig();
    r.put(0, RAIL_Y, 0, RAIL);
    r.put(1, RAIL_Y, 0, RAIL);
    r.put(1, RAIL_Y, 1, RAIL);
    r.run();
    expect(railIsCurve(r.shape(1, 0))).toBe(true);

    r.put(1, RAIL_Y, 1, AIR);
    r.run();
    expect(r.shape(1, 0)).toBe(RAIL_EW);
  });

  it('trilho sem chão cai como item', () => {
    const r = rig();
    r.put(0, RAIL_Y, 0, RAIL);
    r.run();
    r.put(0, GROUND, 0, AIR);
    r.run();
    expect(blockIdOf(r.world.getBlock(0, RAIL_Y, 0))).toBe(AIR);
    expect(r.broken.length).toBe(1);
    expect(blockIdOf(r.broken[0])).toBe(RAIL);
  });

  it('trilho motorizado nunca faz curva', () => {
    const r = rig();
    r.put(0, RAIL_Y, 0, RAIL);
    r.put(1, RAIL_Y, 0, POWERED_RAIL);
    r.put(1, RAIL_Y, 1, RAIL);
    r.run();
    expect(railIsCurve(r.shape(1, 0))).toBe(false);
  });

  it('mundo sem trilho nenhum não enfileira nada', () => {
    const r = rig();
    r.put(3, RAIL_Y, 3, STONE);
    r.run();
    expect(r.rails.pending).toBe(0);
    expect(r.rails.lastUpdates).toBe(0);
  });
});

// --- circuito ---------------------------------------------------------------

describe('trilho e circuito', () => {
  it('a alavanca energiza o trilho motorizado e desliga junto', () => {
    const r = rig();
    const redstone = new Redstone(r.world);
    redstone.attach();
    r.put(0, RAIL_Y, 0, POWERED_RAIL);
    r.put(0, RAIL_Y, 1, LEVER, MOUNT_FLOOR | 8);
    r.run();
    redstone.tick();
    expect(stateBitsOf(r.world.getBlock(0, RAIL_Y, 0)) & RAIL_POWERED).toBe(RAIL_POWERED);

    redstone.use(0, RAIL_Y, 1);
    redstone.tick();
    expect(stateBitsOf(r.world.getBlock(0, RAIL_Y, 0)) & RAIL_POWERED).toBe(0);
  });

  it('energizar o trilho não apaga a forma que a conexão escreveu', () => {
    const r = rig();
    const redstone = new Redstone(r.world);
    redstone.attach();
    for (let z = 0; z < 3; z++) r.put(0, RAIL_Y, z, POWERED_RAIL);
    r.put(1, RAIL_Y, 1, LEVER, MOUNT_FLOOR | 8);
    r.run();
    redstone.tick();
    r.run();
    expect(r.shape(0, 1)).toBe(RAIL_NS);
    expect(stateBitsOf(r.world.getBlock(0, RAIL_Y, 1)) & RAIL_POWERED).toBe(RAIL_POWERED);
  });

  it('o detector com carrinho em cima vira fonte para o pó', () => {
    const r = rig();
    const redstone = new Redstone(r.world);
    redstone.attach();
    const carts = new Minecarts({
      onDetector: (x, y, z, occupied) => r.rails.setPowered(x, y, z, occupied),
    });
    r.put(0, RAIL_Y, 0, DETECTOR_RAIL);
    r.put(1, RAIL_Y, 0, id('redstone_lamp'));
    r.run();

    carts.spawn(0.5, RAIL_Y, 0.5);
    carts.tick(r.world);
    r.run();
    redstone.tick();
    expect(blockIdOf(r.world.getBlock(1, RAIL_Y, 0))).toBe(id('redstone_lamp_on'));
  });
});

// --- carrinho ---------------------------------------------------------------

describe('carrinho de mina', () => {
  it('anda pela linha e para no fim dela', () => {
    const r = rig();
    line(r, 8);
    const carts = new Minecarts();
    const i = carts.spawn(0.5, RAIL_Y, 0.5, 0);
    carts.drive(i, 1, Math.PI / 2); // olhar para +X

    // O atrito do trilho comum é baixo de propósito: um empurrão rende ~5
    // blocos, e leva umas 250 voltas para o carrinho parar de vez.
    for (let t = 0; t < 400; t++) carts.tick(r.world);
    expect(carts.x[i]).toBeGreaterThan(5);
    expect(carts.x[i]).toBeLessThan(8);
    expect(carts.speed[i]).toBe(0);
  });

  it('fica grudado no centro do trilho no eixo perpendicular', () => {
    const r = rig();
    line(r, 6);
    const carts = new Minecarts();
    const i = carts.spawn(0.5, RAIL_Y, 0.9, 0);
    carts.drive(i, 1, Math.PI / 2);
    for (let t = 0; t < 20; t++) carts.tick(r.world);
    expect(carts.z[i]).toBeCloseTo(0.5, 5);
  });

  it('o trilho motorizado energizado mantém a velocidade', () => {
    const r = rig();
    for (let x = 0; x < 12; x++) {
      r.put(x, RAIL_Y, 0, x % 3 === 0 ? POWERED_RAIL : RAIL, x % 3 === 0 ? RAIL_POWERED : 0);
    }
    r.run();
    const carts = new Minecarts();
    const i = carts.spawn(0.5, RAIL_Y, 0.5, 0);
    carts.drive(i, 1, Math.PI / 2);
    // Medido no meio da linha: no fim dela o carrinho para, e o que se quer
    // saber aqui é se o motorizado **sustenta** a velocidade no caminho.
    for (let t = 0; t < 30; t++) carts.tick(r.world);
    expect(carts.speed[i]).toBeGreaterThan(0.2);
    expect(carts.speed[i]).toBeLessThanOrEqual(MAX_SPEED);
  });

  it('o trilho motorizado sem energia freia até parar', () => {
    const r = rig();
    for (let x = 0; x < 12; x++) r.put(x, RAIL_Y, 0, POWERED_RAIL);
    r.run();
    const carts = new Minecarts();
    const i = carts.spawn(0.5, RAIL_Y, 0.5, 0);
    carts.drive(i, 1, Math.PI / 2);
    for (let t = 0; t < 40; t++) carts.tick(r.world);
    expect(carts.speed[i]).toBe(0);
  });

  it('sai da curva pelo outro lado, não de volta', () => {
    // Entrando por +X numa curva que liga +Z e −X, a saída é +Z.
    expect(alignDirection(RAIL_CURVE_SW, 0)).toBe(2);
    // Entrando por −Z numa curva que liga −Z e +X, segue por −Z.
    expect(alignDirection(RAIL_CURVE_NE, 3)).toBe(3);
    // Direção que a curva não liga cai no primeiro lado dela.
    expect(alignDirection(RAIL_CURVE_SE, 3)).toBe(0);
  });

  it('a rampa levanta o carrinho conforme ele atravessa o bloco', () => {
    expect(slopeOffset(RAIL_ASCEND_EAST, 4.0, 0)).toBeCloseTo(0);
    expect(slopeOffset(RAIL_ASCEND_EAST, 4.5, 0)).toBeCloseTo(0.5);
    expect(slopeOffset(RAIL_ASCEND_EAST, 4.99, 0)).toBeCloseTo(0.99);
    expect(slopeOffset(RAIL_ASCEND_WEST, 4.25, 0)).toBeCloseTo(0.75);
    expect(slopeOffset(RAIL_EW, 4.5, 0)).toBe(0);
  });

  it('sobe a rampa e chega ao nível de cima', () => {
    const r = rig();
    // Dois trilhos no chão, degrau, e dois no nível de cima.
    r.put(0, RAIL_Y, 0, RAIL);
    r.put(1, RAIL_Y, 0, RAIL);
    r.put(2, RAIL_Y, 0, STONE);
    r.put(3, RAIL_Y, 0, STONE);
    r.put(2, RAIL_Y + 1, 0, RAIL);
    r.put(3, RAIL_Y + 1, 0, RAIL);
    r.run(3);
    expect(railIsSlope(r.shape(1, 0))).toBe(true);

    const carts = new Minecarts();
    const i = carts.spawn(0.5, RAIL_Y, 0.5, 0);
    for (let t = 0; t < 80; t++) {
      carts.drive(i, 1, Math.PI / 2);
      carts.tick(r.world);
    }
    expect(carts.y[i]).toBeGreaterThan(RAIL_Y);
  });

  it('fora do trilho o carrinho cai e para', () => {
    const r = rig();
    const carts = new Minecarts();
    const i = carts.spawn(4.5, RAIL_Y + 6, 4.5, 0);
    carts.drive(i, 1, Math.PI / 2);
    for (let t = 0; t < 60; t++) carts.tick(r.world);
    expect(carts.y[i]).toBeCloseTo(RAIL_Y, 1);
    expect(carts.speed[i]).toBe(0);
  });

  it('o detector avisa a entrada e a saída, uma vez cada', () => {
    const r = rig();
    line(r, 8);
    r.put(4, RAIL_Y, 0, DETECTOR_RAIL);
    r.run();
    const events: boolean[] = [];
    const carts = new Minecarts({ onDetector: (_x, _y, _z, on) => events.push(on) });
    const i = carts.spawn(0.5, RAIL_Y, 0.5, 0);
    carts.drive(i, 1, Math.PI / 2);
    for (let t = 0; t < 400; t++) carts.tick(r.world);
    expect(events).toEqual([true, false]);
  });

  it('o pool devolve −1 quando enche, e `clear` esvazia', () => {
    const carts = new Minecarts();
    let last = 0;
    for (let i = 0; i < 40; i++) last = carts.spawn(0.5, RAIL_Y, 0.5);
    expect(last).toBe(-1);
    carts.clear();
    expect(carts.active).toBe(0);
    expect(carts.spawn(0.5, RAIL_Y, 0.5)).toBe(0);
  });

  it('os três trilhos são reconhecidos como trilho, e pedra não', () => {
    expect(isRail(makeState(RAIL))).toBe(true);
    expect(isRail(makeState(POWERED_RAIL))).toBe(true);
    expect(isRail(makeState(DETECTOR_RAIL))).toBe(true);
    expect(isRail(makeState(STONE))).toBe(false);
    expect(railShapeOf(makeState(STONE))).toBe(-1);
  });
});

// --- integração pela sessão -------------------------------------------------

describe('carrinho pela sessão', () => {
  function session(): { world: World; player: Player; session: Session } {
    const world = stoneWorld();
    const player = new Player(0.5, RAIL_Y, 0.5);
    const s = new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
    });
    return { world, player, session: s };
  }

  it('o item coloca o carrinho no trilho mirado e consome a peça', () => {
    const { world, session: s } = session();
    world.setBlock(0, RAIL_Y, 0, makeState(RAIL), 'player');
    s.tick();

    const cart = ITEM_BY_NAME.get('minecart')!;
    s.inventory.set(0, makeStack(cart.id, 1));
    s.inventory.select(0);
    s.interaction.state.target = {
      hit: true, x: 0, y: RAIL_Y, z: 0, nx: 0, ny: 1, nz: 0,
      px: 0.5, py: RAIL_Y, pz: 0.5, state: world.getBlock(0, RAIL_Y, 0), distance: 1,
    };

    expect(s.useHeld()).toBe(true);
    expect(s.carts.active).toBe(1);
    expect(s.inventory.get(0)).toBeNull();
  });

  it('não coloca o carrinho fora de trilho', () => {
    const { world, session: s } = session();
    const cart = ITEM_BY_NAME.get('minecart')!;
    s.inventory.set(0, makeStack(cart.id, 1));
    s.inventory.select(0);
    s.interaction.state.target = {
      hit: true, x: 0, y: GROUND, z: 0, nx: 0, ny: 1, nz: 0,
      px: 0.5, py: GROUND, pz: 0.5, state: world.getBlock(0, GROUND, 0), distance: 1,
    };
    s.useHeld();
    expect(s.carts.active).toBe(0);
  });

  it('montar e descer do carrinho, e o jogador anda junto com ele', () => {
    const { world, player, session: s } = session();
    for (let x = 0; x < 8; x++) world.setBlock(x, RAIL_Y, 0, makeState(RAIL), 'player');
    s.tick();
    s.carts.spawn(0.5, RAIL_Y, 0.5, 0);
    player.setPosition(0.5, RAIL_Y, 0.5);

    expect(s.useHeld()).toBe(true);
    expect(s.isRiding).toBe(true);

    for (let t = 0; t < 30; t++) {
      s.driveVehicle(1);
      s.tick();
    }
    expect(player.x).toBeGreaterThan(1);
    expect(player.x).toBeCloseTo(s.carts.x[0], 5);

    // Clicar de novo desce.
    expect(s.useHeld()).toBe(true);
    expect(s.isRiding).toBe(false);
  });

  it('trocar de dimensão leva os carrinhos junto', () => {
    const { world, session: s } = session();
    world.setBlock(0, RAIL_Y, 0, makeState(RAIL), 'player');
    s.carts.spawn(0.5, RAIL_Y, 0.5);
    expect(s.carts.active).toBe(1);
    s.enterDimension(1);
    expect(s.carts.active).toBe(0);
  });
});
