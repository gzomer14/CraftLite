/**
 * Ritmo de quebra e o que o raio da interação enxerga (relato de campo
 * 2026-09-14).
 *
 * *"mesmo dando um clique extremamente rápido... é quase impossível quebrar só
 * um bloco. Tem momentos em que um simples clique rápido acaba quebrando três
 * blocos em sequência"* — e, no mesmo dia, *"as plantas que encontro na grama
 * nenhuma delas consigo quebrar"*.
 *
 * Os dois são do mesmo lugar do código e se resolvem em camadas diferentes: o
 * primeiro é a quebra acontecer **uma vez por tick**, o segundo é o raio
 * atravessar tudo que é `replaceable`.
 */
import { describe, expect, it } from 'vitest';
import { Interaction, breakProgressPerTick } from '../src/game/interaction';
import { Lighting } from '../src/world/lighting';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, BLOCKS, blockIdOf, makeState } from '../src/data/blocks';
import { ITEMS } from '../src/data/items';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const GRASS = BLOCK_BY_NAME.get('tall_grass')!.id;

/** Mundo com piso de pedra em y=63 e o jogador em cima, olhando para baixo. */
function setup(mode: 'creative' | 'survival' = 'creative'): {
  world: World; player: Player; interaction: Interaction;
} {
  const world = new World(11);
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          for (let y = 0; y <= 63; y++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      world.addChunk(chunk);
    }
  }
  const player = new Player(0.5, 64, 0.5);
  player.mode = mode;
  player.pitch = Math.PI / 2 - 0.01; // olhando para baixo
  const interaction = new Interaction(world, player, new Lighting(world));
  return { world, player, interaction };
}

/** Quantos blocos caem segurando o botão por `ticks` ticks seguidos. */
function brokenWhileHolding(ticks: number, mode: 'creative' | 'survival' = 'creative'): number {
  const { player, interaction } = setup(mode);
  let broken = 0;
  interaction.onBlockBroken = () => { broken++; };
  for (let t = 0; t < ticks; t++) {
    interaction.updateTarget();
    interaction.tickBreaking(true, null);
    // O jogador não se move: o alvo vira o bloco de baixo sozinho.
  }
  void player;
  return broken;
}

describe('um clique, um bloco', () => {
  it('um clique curto no criativo derruba exatamente um bloco', () => {
    // Três ticks são 150 ms: um clique normal de mouse ou de dedo. Antes isso
    // derrubava três blocos em fila.
    expect(brokenWhileHolding(3)).toBe(1);
  });

  it('um clique bem demorado ainda derruba um só', () => {
    expect(brokenWhileHolding(5)).toBe(1);
  });

  it('segurar quebra em ritmo controlável, não 20 por segundo', () => {
    // Um segundo segurando: ~4 blocos, não 20.
    const broken = brokenWhileHolding(20);
    expect(broken).toBeGreaterThan(2);
    expect(broken).toBeLessThanOrEqual(5);
  });

  it('soltar o botão zera a espera: quem clica rápido manda no ritmo', () => {
    const { interaction } = setup();
    let broken = 0;
    interaction.onBlockBroken = () => { broken++; };
    for (let click = 0; click < 3; click++) {
      interaction.updateTarget();
      interaction.tickBreaking(true, null);
      interaction.tickBreaking(false, null);
    }
    expect(broken, 'três cliques, três blocos').toBe(3);
  });

  it('no sobrevivência vale para o que quebra em um tick', () => {
    // Grama alta tem dureza 0: `breakProgressPerTick` devolve 1, e sem o
    // intervalo um clique mowaria a moita inteira.
    const { world, interaction } = setup('survival');
    for (let y = 64; y < 68; y++) world.setBlock(0, y, 0, makeState(GRASS), 'player');

    let broken = 0;
    interaction.onBlockBroken = () => { broken++; };
    for (let t = 0; t < 3; t++) {
      interaction.updateTarget();
      interaction.tickBreaking(true, null);
    }
    expect(broken).toBe(1);
  });

  it('a mineração normal não fica mais lenta', () => {
    /*
     * O intervalo só gate a **conclusão**: o progresso corre durante ele, e
     * qualquer bloco que leve mais de 5 ticks nunca o encontra. Pedra na mão
     * leva mais de um segundo, então o tempo tem que ser o mesmo de antes.
     */
    const { player, interaction } = setup('survival');
    // O jogador nasce sem nunca ter ticado, e fora do chão a quebra é 5× mais
    // lenta (doc 06 §4) — o que mediria outra coisa que não o intervalo.
    player.onGround = true;
    const stone = BLOCKS[STONE]!;
    const perTick = breakProgressPerTick(stone, undefined, true, false, 0);
    const esperado = Math.ceil(1 / perTick);

    let ticks = 0;
    let broken = 0;
    interaction.onBlockBroken = () => { broken++; };
    while (broken === 0 && ticks < 500) {
      interaction.updateTarget();
      interaction.tickBreaking(true, null);
      ticks++;
    }
    expect(broken).toBe(1);
    expect(ticks, 'o intervalo não pode atrasar bloco comum').toBe(esperado);
  });
});

describe('o raio da interação enxerga planta', () => {
  it('a planta pode ser mirada e quebrada', () => {
    const { world, player, interaction } = setup('survival');
    world.setBlock(0, 64, 0, makeState(GRASS), 'player');
    // De pé no bloco acima, olhando para baixo, a grama é o primeiro alvo.
    player.setPosition(0.5, 65, 0.5);

    interaction.updateTarget();
    expect(interaction.state.target, 'a planta não podia nem ser mirada').not.toBe(null);
    expect(blockIdOf(interaction.state.target!.state)).toBe(GRASS);

    interaction.tickBreaking(true, null);
    expect(world.getBlock(0, 64, 0)).toBe(AIR);
  });

  it('sem a planta, o alvo é o chão atrás dela', () => {
    const { player, interaction } = setup('survival');
    player.setPosition(0.5, 65, 0.5);
    interaction.updateTarget();
    expect(blockIdOf(interaction.state.target!.state)).toBe(STONE);
  });

  it('todo bloco de dureza zero é mirável — eram 18 invisíveis ao raio', () => {
    const { world, player, interaction } = setup('survival');
    player.setPosition(0.5, 65, 0.5);

    for (const block of BLOCKS) {
      if (block === undefined || block.hardness !== 0 || block.shape === 'none') continue;
      world.setBlock(0, 64, 0, makeState(block.id), 'player');
      interaction.updateTarget();
      const target = interaction.state.target;
      expect(target, `${block.name} não pode ser mirado`).not.toBe(null);
      expect(blockIdOf(target!.state), block.name).toBe(block.id);
    }
  });
});

describe('inventário de quebras instantâneas', () => {
  it('as combinações que quebram em um tick continuam existindo', () => {
    // Elas não são bug — o bug era não haver intervalo entre uma e a próxima.
    // Este teste guarda o número: se ele explodir, alguém mexeu na tabela de
    // ferramentas sem perceber o efeito no ritmo de quebra.
    const tools = ITEMS.filter((i) => i?.tool !== undefined);
    let instant = 0;
    for (const block of BLOCKS) {
      if (block === undefined || block.hardness < 0) continue;
      for (const tool of [undefined, ...tools]) {
        if (breakProgressPerTick(block, tool?.tool, true, false, 0) >= 1) instant++;
      }
    }
    expect(instant).toBeGreaterThan(400);
  });
});
