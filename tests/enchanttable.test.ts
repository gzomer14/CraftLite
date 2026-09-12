/**
 * A mesa de encantamento dentro da sessão (M6): abrir, contar estantes, pagar
 * em níveis e lápis, e não perder o item ao fechar.
 *
 * Sem GL nem DOM: a tela é só um `openScreen` e um `ContainerView`.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { ENCHANT_ITEM, ENCHANT_LAPIS } from '../src/game/container';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { itemId, makeStack } from '../src/data/items';
import { MAX_BOOKSHELVES, enchantCount } from '../src/game/enchanting';
import { totalForLevel } from '../src/game/xp';

const GROUND_Y = 63;
const block = (name: string): number => makeState(BLOCK_BY_NAME.get(name)!.id);

function testWorld(): World {
  const world = new World(31337);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, block('stone'));
        }
      }
      chunk.recomputeHeightMap();
      for (const section of chunk.sections) {
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

interface Harness {
  world: World;
  player: Player;
  session: Session;
}

/** Mesa em (8, 64, 8); `openTable` posiciona e mira o jogador. */
function harness(): Harness {
  const world = testWorld();
  const player = new Player(8.5, GROUND_Y + 2, 9.5);
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ },
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
  });
  world.setBlock(8, GROUND_Y + 1, 8, block('enchanting_table'), 'player');
  return { world, player, session };
}

/**
 * Mira a mesa e usa o item na mão.
 *
 * O raio parte do olho do jogador na direção do centro do bloco da mesa — a
 * mesma chamada que o Modo A de toque usa, e mais estável num teste do que
 * acertar yaw e pitch na mão.
 */
function openTable(h: Harness): void {
  h.player.setPosition(8.5, GROUND_Y + 1, 11.5);
  const eyeY = h.player.y + h.player.eyeHeight;
  const dx = 8.5 - h.player.x;
  const dy = GROUND_Y + 1.5 - eyeY;
  const dz = 8.5 - h.player.z;
  const length = Math.hypot(dx, dy, dz);
  h.session.interaction.updateTargetAlong(dx / length, dy / length, dz / length);
  h.session.useHeld();
}

describe('contagem de estantes', () => {
  it('conta só o anel de 2 blocos, com o caminho livre', () => {
    const h = harness();
    expect(h.session.countBookshelves(8, GROUND_Y + 1, 8)).toBe(0);

    // Colada na mesa não conta: é o anel externo que vale.
    h.world.setBlock(9, GROUND_Y + 1, 8, block('bookshelf'), 'player');
    expect(h.session.countBookshelves(8, GROUND_Y + 1, 8)).toBe(0);

    h.world.setBlock(10, GROUND_Y + 1, 8, block('bookshelf'), 'player');
    // O caminho passa por (9, y, 8), que agora tem uma estante opaca no meio.
    expect(h.session.countBookshelves(8, GROUND_Y + 1, 8)).toBe(0);

    h.world.setBlock(9, GROUND_Y + 1, 8, 0, 'player');
    expect(h.session.countBookshelves(8, GROUND_Y + 1, 8)).toBe(1);
  });

  it('não passa do teto de 15', () => {
    const h = harness();
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
          h.world.setBlock(8 + dx, GROUND_Y + 1 + dy, 8 + dz, block('bookshelf'), 'player');
        }
      }
    }
    // Ar em volta da mesa para o caminho não ficar bloqueado.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        h.world.setBlock(8 + dx, GROUND_Y + 1, 8 + dz, 0, 'player');
        h.world.setBlock(8 + dx, GROUND_Y + 2, 8 + dz, 0, 'player');
      }
    }
    expect(h.session.countBookshelves(8, GROUND_Y + 1, 8)).toBe(MAX_BOOKSHELVES);
  });
});

describe('encantar pela sessão', () => {
  it('abre a mesa ao usar nela', () => {
    const h = harness();
    openTable(h);
    expect(h.session.openScreen).toBe('enchanting');
    expect(h.session.openContainer?.kind).toBe('enchanting');
  });

  it('cobra níveis e lápis, e grava o encantamento no item', () => {
    const h = harness();
    h.player.mode = 'survival';
    openTable(h);
    const table = h.session.openContainer!;
    table.set(ENCHANT_ITEM, makeStack(itemId('diamond_pickaxe')));
    table.set(ENCHANT_LAPIS, makeStack(itemId('lapis_lazuli'), 5));
    h.session.refreshEnchantOffers();

    h.session.xp.setTotal(totalForLevel(30));
    const offer = h.session.enchantOffers[0];
    expect(offer.enchant).toBeGreaterThanOrEqual(0);

    expect(h.session.buyEnchant(0)).toBe('ok');
    expect(h.session.xp.level).toBe(30 - offer.cost);
    expect(table.get(ENCHANT_LAPIS)?.count).toBe(5 - offer.lapis);
    expect(enchantCount(table.get(ENCHANT_ITEM)?.ench ?? 0)).toBe(1);
  });

  it('recusa sem níveis e sem lápis, sem consumir nada', () => {
    const h = harness();
    h.player.mode = 'survival';
    openTable(h);
    const table = h.session.openContainer!;
    table.set(ENCHANT_ITEM, makeStack(itemId('diamond_pickaxe')));
    h.session.refreshEnchantOffers();

    expect(h.session.buyEnchant(0)).toBe('no-lapis');

    table.set(ENCHANT_LAPIS, makeStack(itemId('lapis_lazuli'), 3));
    h.session.xp.setTotal(0);
    expect(h.session.buyEnchant(2)).toBe('no-level');
    expect(table.get(ENCHANT_LAPIS)?.count).toBe(3);
    expect(table.get(ENCHANT_ITEM)?.ench ?? 0).toBe(0);
  });

  it('slot vazio não tem oferta', () => {
    const h = harness();
    openTable(h);
    h.session.refreshEnchantOffers();
    expect(h.session.enchantOffers.every((o) => o.enchant < 0)).toBe(true);
    expect(h.session.buyEnchant(0)).toBe('no-offer');
  });

  it('fechar a tela devolve o item encantado ao inventário', () => {
    const h = harness();
    h.player.mode = 'survival';
    openTable(h);
    const table = h.session.openContainer!;
    const pick = makeStack(itemId('diamond_pickaxe'));
    table.set(ENCHANT_ITEM, pick);
    table.set(ENCHANT_LAPIS, makeStack(itemId('lapis_lazuli'), 3));
    h.session.refreshEnchantOffers();
    h.session.xp.setTotal(totalForLevel(30));
    h.session.buyEnchant(0);

    h.session.closeScreen();
    expect(table.get(ENCHANT_ITEM)).toBeNull();
    expect(table.get(ENCHANT_LAPIS)).toBeNull();

    // A picareta voltou **com** o encantamento: `give` carrega o campo.
    let found: number | null = null;
    for (let i = 0; i < 36; i++) {
      const stack = h.session.inventory.get(i);
      if (stack?.item === pick.item) found = stack.ench ?? 0;
    }
    expect(found).not.toBeNull();
    expect(enchantCount(found!)).toBe(1);
  });

  it('a oferta muda depois de usada', () => {
    const h = harness();
    h.player.mode = 'survival';
    openTable(h);
    const table = h.session.openContainer!;
    table.set(ENCHANT_ITEM, makeStack(itemId('diamond_sword')));
    table.set(ENCHANT_LAPIS, makeStack(itemId('lapis_lazuli'), 9));
    h.session.refreshEnchantOffers();
    h.session.xp.setTotal(totalForLevel(60));

    const before = h.session.enchantOffers.map((o) => `${o.enchant}:${o.level}`);
    expect(h.session.buyEnchant(0)).toBe('ok');
    h.session.refreshEnchantOffers();
    const after = h.session.enchantOffers.map((o) => `${o.enchant}:${o.level}`);
    expect(after).not.toEqual(before);
  });
});
