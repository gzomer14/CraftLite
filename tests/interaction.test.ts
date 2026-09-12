/**
 * Fórmula de tempo de quebra e regras de colocação (doc 06 §4 e §5).
 *
 * Os tempos abaixo são os valores de referência do gênero: quem jogou reconhece
 * "pedra à mão leva 7,5 s" e "com picareta de madeira, 1,15 s". Se estes testes
 * mudarem, a progressão do jogo mudou junto.
 */
import { describe, expect, it } from 'vitest';
import { breakTimeSeconds, canHarvest, breakProgressPerTick, Interaction } from '../src/game/interaction';
import { BLOCK_BY_NAME, makeState, STONE, AIR, defOf } from '../src/data/blocks';
import { ITEM_BY_NAME, makeStack, type ToolSpec } from '../src/data/items';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Lighting } from '../src/world/lighting';

const stone = BLOCK_BY_NAME.get('stone')!;
const dirt = BLOCK_BY_NAME.get('dirt')!;
const oakLog = BLOCK_BY_NAME.get('oak_log')!;
const bedrock = BLOCK_BY_NAME.get('bedrock')!;
const poppy = BLOCK_BY_NAME.get('poppy')!;

const tool = (name: string): ToolSpec => ITEM_BY_NAME.get(name)!.tool!;

describe('tempo de quebra', () => {
  it('pedra à mão: 7,5 s e não dropa', () => {
    expect(breakTimeSeconds(stone, undefined)).toBeCloseTo(7.5, 1);
    expect(canHarvest(stone, undefined)).toBe(false);
  });

  it('pedra com picareta de madeira: 1,15 s', () => {
    expect(breakTimeSeconds(stone, tool('wooden_pickaxe'))).toBeCloseTo(1.15, 1);
  });

  it('pedra com picareta de pedra: 0,6 s', () => {
    expect(breakTimeSeconds(stone, tool('stone_pickaxe'))).toBeCloseTo(0.6, 1);
  });

  it('pedra com picareta de diamante: 0,3 s', () => {
    expect(breakTimeSeconds(stone, tool('diamond_pickaxe'))).toBeCloseTo(0.3, 1);
  });

  it('a picareta de ouro é rápida mas frágil (speed 12)', () => {
    expect(breakTimeSeconds(stone, tool('golden_pickaxe')))
      .toBeLessThan(breakTimeSeconds(stone, tool('diamond_pickaxe')));
  });

  it('ferramenta errada não acelera nada', () => {
    expect(breakTimeSeconds(stone, tool('wooden_axe')))
      .toBeCloseTo(breakTimeSeconds(stone, undefined), 2);
  });

  it('terra com pá é bem mais rápido que à mão', () => {
    expect(breakTimeSeconds(dirt, tool('iron_shovel')))
      .toBeLessThan(breakTimeSeconds(dirt, undefined) / 3);
  });

  it('terra à mão ainda dropa (não requer ferramenta)', () => {
    expect(canHarvest(dirt, undefined)).toBe(true);
  });

  it('tronco com machado é mais rápido', () => {
    expect(breakTimeSeconds(oakLog, tool('iron_axe')))
      .toBeLessThan(breakTimeSeconds(oakLog, undefined));
  });

  it('bedrock é inquebrável', () => {
    expect(breakTimeSeconds(bedrock, tool('diamond_pickaxe'))).toBe(Infinity);
    expect(breakProgressPerTick(bedrock, tool('diamond_pickaxe'), true, false)).toBe(0);
  });

  it('flor quebra em um tick', () => {
    expect(breakProgressPerTick(poppy, undefined, true, false)).toBe(1);
  });

  it('no ar demora 5× mais', () => {
    const ground = breakTimeSeconds(stone, tool('stone_pickaxe'), true, false);
    const air = breakTimeSeconds(stone, tool('stone_pickaxe'), false, false);
    expect(air / ground).toBeCloseTo(5, 0);
  });

  it('dentro da água demora 5× mais', () => {
    const dry = breakTimeSeconds(stone, tool('stone_pickaxe'), true, false);
    const wet = breakTimeSeconds(stone, tool('stone_pickaxe'), true, true);
    expect(wet / dry).toBeCloseTo(5, 0);
  });
});

describe('canHarvest por tier', () => {
  const ironOre = BLOCK_BY_NAME.get('iron_ore')!;
  const diamondOre = BLOCK_BY_NAME.get('diamond_ore')!;

  it('ferro precisa de picareta de pedra (tier 2)', () => {
    expect(canHarvest(ironOre, tool('wooden_pickaxe'))).toBe(false);
    expect(canHarvest(ironOre, tool('stone_pickaxe'))).toBe(true);
  });

  it('diamante precisa de picareta de ferro (tier 3)', () => {
    expect(canHarvest(diamondOre, tool('stone_pickaxe'))).toBe(false);
    expect(canHarvest(diamondOre, tool('iron_pickaxe'))).toBe(true);
  });

  it('a picareta de ouro é tier 1: não pega ferro', () => {
    expect(canHarvest(ironOre, tool('golden_pickaxe'))).toBe(false);
  });

  it('picareta de madeira mina pedra — sem isso o jogo não começa', () => {
    // O doc 04 §2.1 traz `minTier: 2` para a pedra, o que tornaria impossível
    // obter pedregulho para craftar a picareta de pedra. Corrigido para 1.
    expect(canHarvest(stone, tool('wooden_pickaxe'))).toBe(true);
  });
});

// --- integração ------------------------------------------------------------

function testWorld(): { world: World; player: Player; interaction: Interaction } {
  const world = new World(1);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 63; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  const player = new Player(8.5, 64, 8.5);
  const lighting = new Lighting(world);
  return { world, player, interaction: new Interaction(world, player, lighting) };
}

describe('mirar e quebrar', () => {
  it('mira o bloco na frente da câmera', () => {
    const { player, interaction } = testWorld();
    player.pitch = Math.PI / 2 - 0.01; // olhando para baixo
    interaction.updateTarget();
    expect(interaction.state.target).not.toBeNull();
    expect(interaction.state.target?.y).toBe(63);
  });

  it('não mira nada olhando para o céu', () => {
    const { player, interaction } = testWorld();
    player.pitch = -Math.PI / 2 + 0.01;
    interaction.updateTarget();
    expect(interaction.state.target).toBeNull();
  });

  it('respeita o alcance de 4,5 blocos', () => {
    const { world, player, interaction } = testWorld();
    // Abre um poço de 6 blocos abaixo do jogador.
    for (let y = 58; y <= 63; y++) world.setBlock(8, y, 8, AIR, 'gen');
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    expect(interaction.state.target).toBeNull();
  });

  it('quebra depois do tempo certo e avança os estágios', () => {
    const { world, player, interaction } = testWorld();
    player.pitch = Math.PI / 2 - 0.01;
    player.onGround = true;
    interaction.updateTarget();

    const stages = new Set<number>();
    let ticks = 0;
    while (world.getBlock(8, 63, 8) !== AIR && ticks < 400) {
      interaction.tickBreaking(true, null);
      if (interaction.state.stage >= 0) stages.add(interaction.state.stage);
      ticks++;
    }
    expect(world.getBlock(8, 63, 8)).toBe(AIR);
    // 7,5 s à mão = 150 ticks.
    expect(ticks).toBeGreaterThan(140);
    expect(ticks).toBeLessThan(160);
    expect(stages.size).toBeGreaterThan(5); // passou por vários estágios
  });

  it('com picareta quebra muito mais rápido', () => {
    const { world, player, interaction } = testWorld();
    player.pitch = Math.PI / 2 - 0.01;
    player.onGround = true;
    interaction.updateTarget();
    const pick = makeStack(ITEM_BY_NAME.get('stone_pickaxe')!.id);

    let ticks = 0;
    while (world.getBlock(8, 63, 8) !== AIR && ticks < 400) {
      interaction.tickBreaking(true, pick);
      ticks++;
    }
    expect(ticks).toBeLessThan(20); // 0,6 s = 12 ticks
  });

  it('soltar o botão zera o progresso', () => {
    const { player, interaction } = testWorld();
    player.pitch = Math.PI / 2 - 0.01;
    player.onGround = true;
    interaction.updateTarget();

    for (let i = 0; i < 50; i++) interaction.tickBreaking(true, null);
    expect(interaction.state.progress).toBeGreaterThan(0);
    interaction.tickBreaking(false, null);
    expect(interaction.state.progress).toBe(0);
    expect(interaction.state.stage).toBe(-1);
  });

  it('modo criativo quebra na hora', () => {
    const { world, player, interaction } = testWorld();
    player.mode = 'creative';
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    interaction.tickBreaking(true, null);
    expect(world.getBlock(8, 63, 8)).toBe(AIR);
  });

  it('avisa quem escuta quando um bloco quebra', () => {
    const { player, interaction } = testWorld();
    player.mode = 'creative';
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();

    let broken = 0;
    interaction.onBlockBroken = () => broken++;
    interaction.tickBreaking(true, null);
    expect(broken).toBe(1);
  });
});

describe('colocar', () => {
  it('coloca na face mirada', () => {
    const { world, player, interaction } = testWorld();
    // Olha para o chão de um ponto elevado, para colocar em cima.
    player.setPosition(8.5, 66, 8.5);
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    expect(interaction.tryPlace(makeStack(STONE))).toBe(true);
    expect(defOf(world.getBlock(8, 64, 8)).id).toBe(STONE);
  });

  it('não coloca dentro do jogador', () => {
    const { player, interaction } = testWorld();
    player.setPosition(8.5, 64, 8.5);
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    // A face de cima do bloco em (8,63,8) é exatamente onde o jogador está.
    expect(interaction.tryPlace(makeStack(STONE))).toBe(false);
  });

  it('respeita o cooldown de colocação', () => {
    const { player, interaction } = testWorld();
    player.setPosition(8.5, 66, 8.5);
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    expect(interaction.tryPlace(makeStack(STONE))).toBe(true);
    interaction.updateTarget();
    expect(interaction.tryPlace(makeStack(STONE))).toBe(false);
  });

  it('não coloca sem alvo', () => {
    const { player, interaction } = testWorld();
    player.pitch = -Math.PI / 2 + 0.01;
    interaction.updateTarget();
    expect(interaction.tryPlace(makeStack(STONE))).toBe(false);
  });

  it('não coloca com a mão vazia', () => {
    const { player, interaction } = testWorld();
    player.setPosition(8.5, 66, 8.5);
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    expect(interaction.tryPlace(null)).toBe(false);
  });

  it('tronco pega o eixo da face clicada', () => {
    const { world, player, interaction } = testWorld();
    player.setPosition(8.5, 66, 8.5);
    player.pitch = Math.PI / 2 - 0.01;
    interaction.updateTarget();
    const log = BLOCK_BY_NAME.get('oak_log')!.id;
    expect(interaction.tryPlace(makeStack(log))).toBe(true);
    // Clicou no topo → eixo Y → estado 0.
    expect(world.getBlock(8, 64, 8) >>> 10).toBe(0);
  });
});
