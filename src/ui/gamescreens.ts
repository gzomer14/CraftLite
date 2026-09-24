/**
 * As telas de inventário do jogo: a de contêiner (mochila, bancada, fornalha,
 * baú, mesa de encantamento) e a paleta do criativo, já ligadas à sessão.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { professionOf } from '../data/villagers';
import { itemDef, maxStackOf } from '../data/items';
import { ContainerScreen } from './containers/screen';
import { ANVIL_LEFT, ANVIL_RIGHT, ENCHANT_ITEM } from '../game/container';
import { anvilHelp, enchantHelp } from '../game/stationhelp';
import { CreativeScreen } from './containers/creative';
import type { Atlas } from '../render/atlas';
import type { ItemSprites } from '../render/itemsprites';
import type { Session } from '../game/session';
import type { SettingsStore } from '../game/settings';

export interface GameScreensDeps {
  atlas: Atlas;
  itemSprites: ItemSprites;
  settings: SettingsStore;
  /** A sessão nasce depois das telas: ela é lida na hora do clique. */
  session: () => Session;
  /** A paleta fechou: o jogo volta a receber a entrada. */
  onCreativeClose: () => void;
}

export function createGameScreens(deps: GameScreensDeps): {
  containerScreen: ContainerScreen; creativeScreen: CreativeScreen;
} {
  const { atlas, itemSprites, settings, session } = deps;
  const slotColor = new Float32Array(3);
  const colorOf = (item: number): string => {
    const def = itemDef(item);
    atlas.averageColor(atlas.layerOf(def?.tex ?? 'block/missing'), slotColor);
    return `rgb(${Math.round(slotColor[0] * 255)},${Math.round(slotColor[1] * 255)},`
      + `${Math.round(slotColor[2] * 255)})`;
  };
  const spriteOf = (item: number): string | null => itemSprites.position(item);
  const longPressMs = (): number => settings.get('longPressMs');

  const containerScreen = new ContainerScreen({
    onClose: () => { session().workbench.closeScreen(); },
    colorOf,
    spriteOf,
    recipes: () => session().recipes.entries(),
    onPickRecipe: (entry) => session().workbench.autoFillRecipe(entry),
    enchantOffers: () => session().workbench.enchantOffers,
    onEnchantRefresh: () => session().workbench.refreshEnchantOffers(),
    onBuyEnchant: (slot) => session().workbench.buyEnchant(slot),
    enchantStatus: () => {
      const s = session();
      const table = s.workbench.enchantTable;
      const creative = s.player.mode === 'creative';
      let valid = 0;
      for (const offer of table.offers) if (offer.enchant >= 0) valid++;
      return {
        help: enchantHelp(table.get(ENCHANT_ITEM), table.lapis, valid, s.xp.level, creative),
        level: s.xp.level,
        lapis: table.lapis,
        shelves: table.shelves,
        creative,
      };
    },
    tradeOffers: () => session().tradeOffers,
    onBuyTrade: (slot) => session().buyTrade(slot),
    tradeTitle: () => {
      const s = session();
      const i = s.villages.trader();
      return i < 0 ? 'Aldeão' : `Aldeão — ${professionOf(s.mobs.store.variant[i]).display}`;
    },
    onFurnaceOutput: (furnace, item) => session().workbench.collectFurnaceXp(furnace, item),
    // Bigorna (M15).
    onAnvilChange: (name) => {
      const bench = session().workbench;
      if (name !== undefined) bench.anvilName = name;
      bench.refreshAnvil();
    },
    onAnvilTake: () => session().workbench.takeAnvilResult(),
    anvilStatus: () => {
      const s = session();
      const bench = s.workbench;
      const left = bench.anvil.get(ANVIL_LEFT);
      const blocker = bench.anvilBlocker();
      return {
        help: anvilHelp(
          left, bench.anvil.get(ANVIL_RIGHT), bench.anvilOutcome, blocker, s.xp.level,
          s.player.mode === 'creative',
        ),
        blocked: blocker === 'expensive' || blocker === 'no-level',
        currentName: left?.name ?? '',
        nameable: left !== null && maxStackOf(left.item) === 1,
      };
    },
    longPressMs,
    // O toque longo do slot não tem retorno visual próprio; a vibração é o que
    // diz ao jogador que o gesto pegou.
    vibrate: () => { if (settings.get('vibration')) navigator.vibrate?.(12); },
  });
  const creativeScreen = new CreativeScreen({
    onClose: deps.onCreativeClose,
    // A paleta escolhe o item; a mochila é quem veste. Sem esta ponte, no
    // criativo não havia como chegar aos slots de armadura.
    onOpenInventory: () => { session().workbench.toggleInventory(); },
    longPressMs,
    spriteOf,
    colorOf,
  });
  return { containerScreen, creativeScreen };
}
