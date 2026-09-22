/**
 * Os sistemas que fazem o mundo reagir sozinho: luz, fluidos, crescimento,
 * fogo, circuito, trilho, areia que cai e os blocos de duas células.
 *
 * Saiu da `Session` em 2026-09-22 (M13). Cada sistema continua no seu módulo
 * de `world/`; aqui fica **a montagem**: quem avisa a luz, quem dropa o que
 * caiu e em que ordem os ouvintes de `world.setBlock` são ligados — a ordem
 * importa (ver o comentário de `attachMultiBlocks` abaixo).
 */

import { AIR, defOf } from '../data/blocks';
import { ITEM_BY_NAME, type ItemStack } from '../data/items';
import { blockSound } from '../audio/synth';
import { Lighting } from '../world/lighting';
import { Fluids } from '../world/fluids';
import { Growth } from '../world/growth';
import { Fire } from '../world/fire';
import { FallingBlocks } from '../world/falling';
import { Redstone } from '../world/redstone';
import { Rails } from '../world/rails';
import { attachMultiBlocks } from '../world/multiblock';
import type { ChunkColumn } from '../world/chunk';
import type { World } from '../world/world';

export interface WorldSystemEvents {
  /** Um bloco quebrou sozinho (planta sem chão, peça sem apoio): vira o drop dele. */
  spawnDrops(x: number, y: number, z: number, state: number): void;
  drop(stack: ItemStack, x: number, y: number, z: number): void;
  sound(name: string, x: number, y: number, z: number): void;
}

export class WorldSystems {
  readonly lighting: Lighting;
  readonly fluids: Fluids;
  readonly growth: Growth;
  readonly redstone: Redstone;
  readonly rails: Rails;
  readonly fire: Fire;
  readonly falling: FallingBlocks;

  constructor(world: World, events: WorldSystemEvents) {
    const lighting = new Lighting(world);
    this.lighting = lighting;
    const changed = (x: number, y: number, z: number, previous: number, state: number): void => {
      lighting.onBlockChanged(x, y, z, previous, state);
    };
    this.fluids = new Fluids(world);
    this.fluids.onEvaporate = (x, y, z) => { events.sound('block/evaporate', x, y, z); };
    this.growth = new Growth(world, {
      // Plantação sem chão vira item no lugar, como se tivesse sido quebrada.
      onCropBroken: (x, y, z, state) => { events.spawnDrops(x, y, z, state); },
      onGrown: () => { /* silencioso: uma roça inteira crescendo seria barulho */ },
      // Árvore nascendo e grama pegando mudam a luz: a copa faz sombra.
      onChanged: changed,
    });
    // O circuito avisa a luz (lâmpada e tocha mudam de emissão) e dropa o que
    // perdeu o apoio, como faz o crescimento.
    this.redstone = new Redstone(world, {
      onChanged: changed,
      onBroken: (x, y, z, state) => { events.spawnDrops(x, y, z, state); },
      onSound: (name, x, y, z) => { events.sound(name, x, y, z); },
    });
    this.rails = new Rails(world, {
      onBroken: (x, y, z, state) => { events.spawnDrops(x, y, z, state); },
    });
    this.fire = new Fire(world, {
      // O que queima solta o que soltaria ao ser quebrado? **Não.** Queimar
      // consome: é o que separa derrubar a floresta com machado de tocar fogo
      // nela. O som e a luz, sim, são os mesmos de qualquer mudança de bloco.
      onBurned: (x, y, z) => { events.sound('block/fire', x, y, z); },
      onIgnited: (x, y, z) => {
        lighting.onBlockChanged(x, y, z, AIR, world.getBlock(x, y, z));
      },
    });
    /*
     * Areia e cascalho que caem (doc 03 §9). Pousar em célula ocupada — uma
     * tocha no caminho — solta o bloco como item **em qualquer modo**: não é o
     * jogador quebrando, é o bloco que não coube.
     */
    this.falling = new FallingBlocks(world, {
      onChanged: changed,
      onBroken: (x, y, z, state) => {
        const item = ITEM_BY_NAME.get(defOf(state).name);
        if (item !== undefined) {
          events.drop({ item: item.id, count: 1, damage: 0 }, x + 0.5, y + 0.25, z + 0.5);
        }
      },
      onLanded: (x, y, z, state) => {
        events.sound(blockSound(defOf(state).sound, 'place'), x + 0.5, y + 0.5, z + 0.5);
      },
    });

    this.growth.attach();
    this.fire.attach();
    this.falling.attach();
    this.redstone.attach();
    this.rails.attach();
    /*
     * Porta e cama ocupam duas células (M8). O ouvinte fica **depois** dos
     * outros de propósito: quando a metade órfã sai, o circuito e a luz já
     * reagiram à primeira, e a segunda chega como uma mudança comum.
     */
    attachMultiBlocks(world, { onChanged: changed });
  }

  /** Fluidos, queda, crescimento e fogo, nesta ordem. O circuito é da `Session`. */
  tick(raining: boolean): void {
    this.fluids.tick();
    this.falling.tick();
    this.growth.tick();
    // A chuva apaga o fogo (doc 03 §8); quem sabe se chove é o clima.
    this.fire.raining = raining;
    this.fire.tick();
  }

  /** Coluna nova: cada sistema cataloga o que é dele. */
  scanChunk(chunk: ChunkColumn): void {
    this.growth.scanChunk(chunk);
    this.fire.scanChunk(chunk);
    this.redstone.scanChunk(chunk);
    this.rails.scanChunk(chunk);
  }

  /** Coluna saindo de alcance: para de crescer e de queimar o que era dela. */
  forgetChunk(cx: number, cz: number): void {
    this.growth.forgetChunk(cx, cz);
    this.fire.forgetChunk(cx, cz);
  }
}
