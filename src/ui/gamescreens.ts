/**
 * As telas de inventário do jogo: a de contêiner (mochila, bancada, fornalha,
 * baú, mesa de encantamento) e a paleta do criativo, já ligadas à sessão.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { itemDef } from '../data/items';
import { ContainerScreen } from './containers/screen';
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
    xpLevel: () => session().xp.level,
    onFurnaceOutput: (furnace, item) => session().workbench.collectFurnaceXp(furnace, item),
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
