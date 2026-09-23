/**
 * Troca com aldeão (M9, doc 14): o que ele oferece, se o jogador pode pagar, e
 * a troca em si.
 *
 * A tela é a das telas de contêiner (`ui/containers/screen.ts`), com a lista de
 * ofertas no lugar dos slots — o mesmo padrão das três ofertas da mesa de
 * encantamento. Não há slot de troca: o pagamento sai do inventário e o item
 * entra nele (ou cai no chão, se não couber). Cada oferta tem um limite de usos
 * por dia, e o aldeão reabastece ao virar o dia.
 */

import { ITEM_BY_NAME } from '../data/items';
import { professionOf } from '../data/villagers';
import { MAX_TRADES } from '../entity/villagestate';
import type { Inventory } from './inventory';
import type { MobStore } from '../entity/mobstore';
import type { ItemStack } from '../data/items';

/** Uma oferta como a tela a desenha. */
export interface TradeOfferView {
  wantItem: number;
  wantCount: number;
  giveItem: number;
  giveCount: number;
  /** Usos que sobram hoje. */
  remaining: number;
  /** O jogador tem o pagamento agora. */
  affordable: boolean;
}

export type TradeResult = 'ok' | 'no-offer' | 'no-items' | 'sold-out' | 'closed';

export interface TradingHost {
  readonly mobs: MobStore;
  readonly inventory: Inventory;
  /** Dia inteiro desde o começo do mundo — o relógio do reabastecimento. */
  day(): number;
  /** Criativo não paga (como na mesa de encantamento). */
  creative(): boolean;
  dropItem(stack: ItemStack): void;
  sound(name: string, x: number, y: number, z: number): void;
  noteObtained(item: number): void;
}

export class Trading {
  private readonly host: TradingHost;
  /** Lista reusada entre chamadas da tela. */
  private readonly views: TradeOfferView[] = [];

  constructor(host: TradingHost) {
    this.host = host;
  }

  /** As ofertas do aldeão `i`, com o que sobra de cada uma hoje. */
  offers(i: number): readonly TradeOfferView[] {
    const { mobs, inventory } = this.host;
    this.restock(i);
    const trades = professionOf(mobs.variant[i]).trades;
    const count = Math.min(trades.length, MAX_TRADES);
    this.views.length = count;
    for (let t = 0; t < count; t++) {
      const trade = trades[t];
      const view = this.views[t] ?? (this.views[t] = {
        wantItem: -1, wantCount: 0, giveItem: -1, giveCount: 0, remaining: 0, affordable: false,
      });
      view.wantItem = ITEM_BY_NAME.get(trade.want[0])?.id ?? -1;
      view.wantCount = trade.want[1];
      view.giveItem = ITEM_BY_NAME.get(trade.give[0])?.id ?? -1;
      view.giveCount = trade.give[1];
      view.remaining = Math.max(0, trade.maxUses - mobs.village.tradeUses[i * MAX_TRADES + t]);
      view.affordable = this.host.creative() || inventory.countOf(view.wantItem) >= view.wantCount;
    }
    return this.views;
  }

  /** Faz a troca `slot` com o aldeão `i`. */
  buy(i: number, slot: number): TradeResult {
    const { mobs, inventory } = this.host;
    if (i < 0) return 'closed';
    const offer = this.offers(i)[slot];
    if (offer === undefined || offer.wantItem < 0 || offer.giveItem < 0) return 'no-offer';
    if (offer.remaining <= 0) return 'sold-out';
    if (!this.host.creative() && !inventory.take(offer.wantItem, offer.wantCount)) return 'no-items';

    mobs.village.tradeUses[i * MAX_TRADES + slot]++;
    const leftover = inventory.give(offer.giveItem, offer.giveCount);
    if (leftover > 0) this.host.dropItem({ item: offer.giveItem, count: leftover, damage: 0 });
    this.host.noteObtained(offer.giveItem);
    this.host.sound('mob/villager_ambient', mobs.x[i], mobs.centerY(i), mobs.z[i]);
    return 'ok';
  }

  /** Virou o dia desde a última conversa: as ofertas voltam cheias. */
  private restock(i: number): void {
    const v = this.host.mobs.village;
    const today = this.host.day();
    if (v.restockDay[i] === today) return;
    v.restockDay[i] = today;
    v.tradeUses.fill(0, i * MAX_TRADES, (i + 1) * MAX_TRADES);
  }
}
