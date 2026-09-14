/**
 * Fumaça do loop de jogo: mundo gerado de verdade + jogador + interação + luz.
 *
 * É o teste mais próximo de "jogar" que dá para fazer sem GL, e é o que pega
 * erro de fiação entre os sistemas — jogador caindo pelo terreno gerado,
 * quebrar sem atualizar luz, colocar sem marcar a section como suja.
 */
import { describe, expect, it } from 'vitest';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { World } from '../src/world/world';
import { Lighting } from '../src/world/lighting';
import { Player } from '../src/entity/player';
import { Interaction } from '../src/game/interaction';
import { Hotbar } from '../src/game/hotbar';
import { AIR, BLOCK_BY_NAME, blockIdOf, defOf, makeState } from '../src/data/blocks';
import { makeStack } from '../src/data/items';
import { WORLD_HEIGHT } from '../src/world/chunk';

const SEED = 20260908;
const IDLE = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

/** Mundo real de 5×5 chunks em volta da origem. */
function generatedWorld(): World {
  const noise = new TerrainNoise(SEED);
  const world = new World(SEED);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) world.addChunk(generateChunk(SEED, noise, cx, cz));
  }
  return world;
}

function spawnOnSurface(world: World): Player {
  const chunk = world.getChunk(0, 0)!;
  const height = chunk.heightMap[0];
  return new Player(0.5, height + 1, 0.5);
}

describe('jogador em terreno gerado', () => {
  it('pousa na superfície e fica parado', () => {
    const world = generatedWorld();
    const player = spawnOnSurface(world);
    player.y += 20; // solta de cima

    for (let i = 0; i < 200; i++) player.tick(world, IDLE);

    expect(player.onGround).toBe(true);
    expect(player.vy).toBe(0);
    // Pousou em cima de um bloco sólido, não dentro dele.
    const below = world.getBlock(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z));
    expect(defOf(below).solid).toBe(true);
    const at = world.getBlock(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z));
    expect(defOf(at).solid).toBe(false);
  });

  it('não atravessa o terreno andando por 400 ticks', () => {
    const world = generatedWorld();
    const player = spawnOnSurface(world);
    for (let i = 0; i < 50; i++) player.tick(world, IDLE);

    const walk = { ...IDLE, forward: 1 };
    for (let i = 0; i < 400; i++) {
      player.yaw = i * 0.02; // gira devagar para varrer direções
      player.tick(world, walk);
      // Nunca deve estar com os pés dentro de um bloco sólido.
      const feet = world.getBlock(
        Math.floor(player.x), Math.floor(player.y + 0.1), Math.floor(player.z),
      );
      expect(defOf(feet).solid, `tick ${i} em y=${player.y.toFixed(2)}`).toBe(false);
    }
    expect(player.y).toBeGreaterThan(0);
    expect(player.y).toBeLessThan(WORLD_HEIGHT);
  });

  it('pulando repetidamente não afunda nem voa', () => {
    const world = generatedWorld();
    const player = spawnOnSurface(world);
    for (let i = 0; i < 50; i++) player.tick(world, IDLE);
    const restY = player.y;

    for (let i = 0; i < 300; i++) player.tick(world, { ...IDLE, jump: true });
    expect(player.y).toBeGreaterThanOrEqual(restY - 0.01);
    expect(player.y).toBeLessThan(restY + 2);
  });
});

describe('quebrar e colocar em terreno gerado', () => {
  function setup() {
    const world = generatedWorld();
    const lighting = new Lighting(world);
    const player = spawnOnSurface(world);
    for (let i = 0; i < 50; i++) player.tick(world, IDLE);
    const interaction = new Interaction(world, player, lighting);
    return { world, lighting, player, interaction };
  }

  it('quebra o bloco que está sob os pés olhando para baixo', () => {
    const { world, player, interaction } = setup();
    player.mode = 'creative';
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();

    const target = interaction.state.target;
    expect(target).not.toBeNull();
    interaction.tickBreaking(true, null);
    expect(world.getBlock(target!.x, target!.y, target!.z)).toBe(AIR);
  });

  it('quebrar marca sections sujas para o re-mesh', () => {
    const { world, player, interaction } = setup();
    const scratch: number[] = [];
    world.takeDirtySections(scratch);

    player.mode = 'creative';
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    interaction.tickBreaking(true, null);

    expect(world.dirtyCount).toBeGreaterThan(0);
  });

  it('cavar um poço deixa a luz do céu descer junto', () => {
    const { world, lighting, player, interaction } = setup();
    player.mode = 'creative';
    player.pitch = Math.PI / 2 - 0.01;

    const x = Math.floor(player.x);
    const z = Math.floor(player.z);
    const surface = world.getChunk(0, 0)!.heightMap[((z & 15) << 4) | (x & 15)];

    /*
     * Cava 4 blocos para baixo, **um clique por bloco**.
     *
     * O `tickBreaking(false, …)` no meio não é enfeite: desde que existe o
     * intervalo entre quebras (`BREAK_INTERVAL`), segurar o botão derruba um
     * bloco a cada 5 ticks, e um laço que só segura cavaria um buraco de um
     * bloco. Soltar entre as quebras é o que um jogador faz.
     */
    for (let i = 0; i < 4; i++) {
      interaction.updateTarget();
      if (interaction.state.target === null) break;
      interaction.tickBreaking(true, null);
      interaction.tickBreaking(false, null);
      player.setPosition(player.x, player.y - 1, player.z);
    }

    // O fundo do poço enxerga o céu, então continua iluminado.
    expect(world.getSkyLight(x, surface - 2, z)).toBeGreaterThan(0);
    void lighting;
  });

  it('coloca um bloco e ele aparece no mundo', () => {
    const { world, player, interaction } = setup();
    player.pitch = Math.PI / 2 - 0.01;
    // Sobe 2 blocos: espaço livre embaixo, mas o chão ainda dentro do alcance
    // de 4,5 (com 3 o olho fica a 4,62 e o alvo some).
    player.setPosition(player.x, player.y + 2, player.z);
    interaction.updateTarget();
    const target = interaction.state.target;
    expect(target, 'o chão precisa estar no alcance').not.toBeNull();

    const stone = BLOCK_BY_NAME.get('stone')!.id;
    expect(interaction.tryPlace(makeStack(stone))).toBe(true);

    const px = target!.x + target!.nx;
    const py = target!.y + target!.ny;
    const pz = target!.z + target!.nz;
    expect(defOf(world.getBlock(px, py, pz)).name).toBe('stone');
  });

  it('a tocha acende o lugar onde foi colocada', () => {
    const { world, player, interaction } = setup();
    player.mode = 'creative';
    const torch = BLOCK_BY_NAME.get('torch')!.id;

    // Cava um buraco e põe a tocha dentro dele.
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    const target = interaction.state.target!;
    interaction.tickBreaking(true, null);

    world.setBlock(target.x, target.y, target.z, makeState(torch), 'player');
    new Lighting(world).onBlockChanged(target.x, target.y, target.z, AIR, makeState(torch));
    expect(world.getBlockLight(target.x, target.y, target.z)).toBe(14);
  });
});

describe('hotbar', () => {
  it('empilha itens iguais até 64', () => {
    const hotbar = new Hotbar();
    expect(hotbar.give(1, 100)).toBe(0);
    expect(hotbar.slots[0]?.count).toBe(64);
    expect(hotbar.slots[1]?.count).toBe(36);
  });

  it('devolve o que não coube', () => {
    const hotbar = new Hotbar();
    expect(hotbar.give(1, 9 * 64 + 5)).toBe(5);
  });

  it('consumir esvazia o slot ao chegar a zero', () => {
    const hotbar = new Hotbar();
    hotbar.set(0, makeStack(1, 1));
    hotbar.consumeHeld();
    expect(hotbar.held).toBeNull();
  });

  it('a roda dá a volta nos dois sentidos', () => {
    const hotbar = new Hotbar();
    hotbar.scroll(-1);
    expect(hotbar.selectedIndex).toBe(8);
    hotbar.scroll(1);
    expect(hotbar.selectedIndex).toBe(0);
  });

  it('pick block seleciona o slot que já tem o item', () => {
    const hotbar = new Hotbar();
    hotbar.set(4, makeStack(7, 3));
    hotbar.pickBlock(7);
    expect(hotbar.selectedIndex).toBe(4);
  });

  it('pick block sem o item põe no slot atual', () => {
    const hotbar = new Hotbar();
    hotbar.pickBlock(12);
    expect(blockIdOf(hotbar.held!.item)).toBe(12);
  });
});
