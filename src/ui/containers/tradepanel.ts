/**
 * Lista de ofertas do aldeão na tela de contêiner (M9).
 *
 * É o padrão das ofertas da mesa de encantamento — um botão por oferta, com o
 * mesmo estilo, o mesmo foco de controle e a mesma navegação —, com o desenho
 * dos itens no lugar do texto: o que ele quer, uma seta, o que ele dá. Clicar
 * compra; a oferta que o jogador não pode pagar fica apagada, e a esgotada diz
 * que esgotou. A tela não tem slot de troca: quem move os itens é
 * `game/trading.ts`, direto no inventário.
 */

import { t, tf } from '../../core/i18n';
import { itemDef } from '../../data/items';
import type { TradeOfferView, TradeResult } from '../../game/trading';

export interface TradePanelCallbacks {
  offers: () => readonly TradeOfferView[];
  buy: (slot: number) => TradeResult;
  spriteOf?: (item: number) => string | null;
  colorOf: (item: number) => string;
}

const MESSAGES: Record<TradeResult, string> = {
  ok: t('trade.ok'),
  'no-offer': t('trade.no_offer'),
  'no-items': t('trade.no_items'),
  'sold-out': t('trade.sold_out'),
  closed: t('trade.closed'),
};

export class TradePanel {
  readonly element: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly callbacks: TradePanelCallbacks;
  /** Última lista desenhada, para pular redesenho igual. */
  private rendered = '';

  constructor(callbacks: TradePanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'section trades';
    this.list = document.createElement('div');
    this.list.className = 'offers';
    this.hint = document.createElement('div');
    this.hint.className = 'offer-hint';
    this.hint.hidden = true;
    this.element.append(this.list, this.hint);
  }

  /** Tela abriu: começa sem mensagem e redesenha do zero. */
  reset(): void {
    this.hint.hidden = true;
    this.rendered = '';
  }

  refresh(): void {
    const offers = this.callbacks.offers();
    let key = '';
    for (const o of offers) key += `${o.wantItem}:${o.remaining}:${o.affordable ? 1 : 0};`;
    if (key === this.rendered) return;
    this.rendered = key;

    while (this.buttons.length < offers.length) this.buttons.push(this.makeButton(this.buttons.length));
    for (let slot = 0; slot < this.buttons.length; slot++) {
      const button = this.buttons[slot];
      const offer = offers[slot];
      if (offer === undefined) { button.hidden = true; continue; }
      button.hidden = false;
      const sold = offer.remaining <= 0;
      button.disabled = sold || !offer.affordable;
      button.classList.toggle('affordable', !button.disabled);
      button.textContent = '';
      const want = itemDef(offer.wantItem)?.display ?? '?';
      const give = itemDef(offer.giveItem)?.display ?? '?';
      const arrow = document.createElement('span');
      arrow.className = 'trade-arrow';
      arrow.textContent = '→';
      const left = document.createElement('span');
      left.className = 'trade-left';
      left.textContent = sold ? t('trade.sold') : tf('trade.left', offer.remaining);
      button.append(
        this.icon(offer.wantItem, offer.wantCount), arrow, this.icon(offer.giveItem, offer.giveCount), left,
      );
      button.setAttribute(
        'aria-label',
        tf(
          'trade.aria', offer.wantCount, want, offer.giveCount, give,
          sold ? t('trade.sold') : tf('trade.left', offer.remaining),
        ),
      );
    }
  }

  private makeButton(slot: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'offer trade';
    button.addEventListener('click', () => {
      const result = this.callbacks.buy(slot);
      this.hint.textContent = MESSAGES[result];
      this.hint.hidden = false;
      this.rendered = '';
      this.refresh();
    });
    this.list.appendChild(button);
    return button;
  }

  /** O desenho do item com a quantidade, como num slot. */
  private icon(item: number, count: number): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = 'slot trade-icon';
    const label = document.createElement('span');
    label.textContent = count > 1 ? String(count) : '';
    const sprite = this.callbacks.spriteOf?.(item) ?? null;
    if (sprite !== null) {
      el.classList.add('sprite');
      el.style.backgroundPosition = sprite;
    } else {
      el.classList.add('filled');
      el.style.setProperty('--item-color', this.callbacks.colorOf(item));
      label.textContent = `${(itemDef(item)?.display ?? '?').slice(0, 2)}${count > 1 ? ` ${count}` : ''}`;
    }
    el.appendChild(label);
    return el;
  }
}
