/**
 * Largar item no mundo (relato de campo 2026-09-14).
 *
 * *"estou conseguindo jogar itens fora... porém ele está indo muito perto do
 * meu personagem então instantaneamente meu personagem coleta ele e volta para
 * meu inventário"*.
 *
 * Eram dois problemas somados: o "arremesso" não arremessava nada — `thrown`
 * dava um empurrão **aleatório** de ±0,05 por eixo, e o item caía a menos de
 * meio bloco, dentro da caixa de coleta de 1,3 — e o atraso de coleta era de
 * meio segundo para todo mundo.
 */
import { describe, expect, it } from 'vitest';
import { ItemEntities } from '../src/entity/itementity';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { itemId } from '../src/data/items';

const STONE = BLOCK_BY_NAME.get('stone')!.id;
const WOOD = itemId('oak_planks');

/** Mundo com piso de pedra em y=63, para o item ter onde parar. */
function makeWorld(): World {
  const world = new World(7);
  for (let cx = -2; cx <= 2; cx++) {
    for (let cz = -2; cz <= 2; cz++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) chunk.setBlock(x, 63, z, makeState(STONE));
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Roda `ticks` com o jogador parado em `(px, py, pz)`. */
function run(
  items: ItemEntities, world: World, ticks: number, px: number, py: number, pz: number,
): void {
  for (let t = 0; t < ticks; t++) items.tick(world, px, py, pz);
}

describe('item largado pelo jogador', () => {
  it('sai na direção do olhar, e não nos próprios pés', () => {
    const world = makeWorld();
    const items = new ItemEntities(32);
    // Olhando para +X.
    items.spawn(0, 65, 0, { item: WOOD, count: 1, damage: 0 }, [1, 0, 0]);
    run(items, world, 40, 0, 64, 0);

    let landedX = 0;
    items.forEach((x) => { landedX = x; }, 1);
    expect(landedX, 'o item precisa ter ido para a frente').toBeGreaterThan(1.3);
  });

  it('o jogador parado não recoleta o que acabou de largar', () => {
    const world = makeWorld();
    const items = new ItemEntities(32);
    let coletou = 0;
    items.onPickup = (stack) => { coletou += stack.count; return 0; };

    // Contra a parede: o item bate e volta para perto de quem o largou. É o
    // caso que o arremesso sozinho não resolve.
    items.spawn(0, 65, 0, { item: WOOD, count: 5, damage: 0 }, [0, -1, 0]);
    run(items, world, 30, 0, 64, 0);
    expect(coletou, 'meio segundo depois ele voltava para a mochila').toBe(0);
  });

  it('mas depois de dois segundos dá para pegar de volta', () => {
    const world = makeWorld();
    const items = new ItemEntities(32);
    let coletou = 0;
    items.onPickup = (stack) => { coletou += stack.count; return 0; };

    items.spawn(0, 65, 0, { item: WOOD, count: 5, damage: 0 }, [0, -1, 0]);
    run(items, world, 60, 0, 64, 0);
    expect(coletou, 'o item não pode ficar inalcançável para sempre').toBe(5);
  });

  it('o que cai de um bloco quebrado continua sendo pego na hora', () => {
    // O atraso longo é **só** do que o jogador jogou fora: minerar e esperar
    // dois segundos por cada item seria o oposto do que se quer.
    const world = makeWorld();
    const items = new ItemEntities(32);
    let coletou = 0;
    items.onPickup = (stack) => { coletou += stack.count; return 0; };

    items.spawn(0, 64.2, 0, { item: WOOD, count: 1, damage: 0 });
    run(items, world, 15, 0, 64, 0);
    expect(coletou).toBe(1);
  });

  it('a direção do arremesso manda no rumo, nos dois sentidos', () => {
    const world = makeWorld();
    const items = new ItemEntities(32);
    // Nascem afastados no eixo X: no mesmo ponto eles se fundiriam antes de
    // sair do lugar, e o teste mediria uma pilha só.
    items.spawn(-6, 65, 0, { item: WOOD, count: 1, damage: 0 }, [0, 0, 1]);
    items.spawn(6, 65, 0, { item: WOOD, count: 1, damage: 0 }, [0, 0, -1]);
    run(items, world, 40, 0, 64, 0);

    const zs: number[] = [];
    items.forEach((_x, _y, z) => { zs.push(z); }, 1);
    expect(zs.length).toBe(2);
    expect(Math.max(...zs)).toBeGreaterThan(1);
    expect(Math.min(...zs)).toBeLessThan(-1);
  });

  it('o slot liberado leva o atraso do item que saiu dele', () => {
    /*
     * Os arrays são compactados trocando com o último: se `pickupAt` não fosse
     * copiado junto, um item largado herdaria o atraso curto de um vizinho
     * removido e voltaria para a mochila na hora.
     */
    const world = makeWorld();
    const items = new ItemEntities(32);
    let coletou = 0;
    items.onPickup = (stack) => { coletou += stack.count; return 0; };

    // Um natural, que some cedo, e um arremessado depois dele.
    items.spawn(20, 64.2, 20, { item: WOOD, count: 1, damage: 0 });
    items.spawn(0, 65, 0, { item: WOOD, count: 3, damage: 0 }, [0, -1, 0]);
    // O natural está longe do jogador e não é coletado; o arremessado, perto.
    run(items, world, 25, 0, 64, 0);
    expect(coletou, 'o arremessado ainda está no prazo dele').toBe(0);
  });
});
