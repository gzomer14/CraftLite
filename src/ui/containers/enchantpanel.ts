/**
 * O miolo da tela da mesa de encantamento: a frase do que fazer, as três
 * ofertas e as estantes em volta.
 *
 * Saiu de `screen.ts` em 2026-09-24, junto com a correção de um relato de
 * campo: o jogador não conseguiu encantar. Os slots não tinham rótulo e os
 * três botões ficavam apagados com um "—", sem dizer se faltava item, lápis ou
 * nível. Agora a frase de cima diz o próximo passo (`game/stationhelp.ts`), e
 * a oferta que existe mas não cabe no bolso continua **tocável**: o toque diz
 * o que faltou, em vez de não fazer nada.
 */

import { t, tf } from '../../core/i18n';
import { enchantDef } from '../../data/enchants';
import { MAX_BOOKSHELVES, type EnchantOffer } from '../../game/enchanting';
import { levels } from '../../game/stationhelp';

/** Por que uma oferta de encantamento não pôde ser comprada. */
export type EnchantResult = 'ok' | 'no-offer' | 'no-level' | 'no-lapis';

/** O estado da mesa que o painel mostra. */
export interface EnchantStatus {
  /** A frase do próximo passo. */
  help: string;
  level: number;
  lapis: number;
  shelves: number;
  creative: boolean;
}

export interface EnchantPanelCallbacks {
  offers(): readonly EnchantOffer[];
  status(): EnchantStatus;
  /** Compra a oferta; quem chama redesenha a tela. */
  buy(slot: number): EnchantResult;
}

const RESULT_MESSAGES: Readonly<Record<EnchantResult, string>> = {
  ok: t('enchant.ok'),
  'no-offer': t('enchant.no_offer'),
  'no-level': t('enchant.no_level'),
  'no-lapis': t('enchant.no_lapis'),
};

export class EnchantPanel {
  readonly element: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly shelves: HTMLDivElement;
  /** Resposta do último toque numa oferta. */
  private readonly result: HTMLDivElement;
  private readonly callbacks: EnchantPanelCallbacks;

  constructor(callbacks: EnchantPanelCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'section enchant';
    this.help = document.createElement('div');
    this.help.className = 'station-help';
    this.help.setAttribute('role', 'status');
    const list = document.createElement('div');
    list.className = 'offers';
    for (let slot = 0; slot < 3; slot++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'offer';
      button.addEventListener('click', () => this.buy(slot));
      list.appendChild(button);
      this.buttons.push(button);
    }
    this.shelves = document.createElement('div');
    this.shelves.className = 'station-note';
    this.result = document.createElement('div');
    this.result.className = 'offer-hint';
    this.result.hidden = true;
    this.element.append(this.help, list, this.result, this.shelves);
  }

  /** Nova abertura: a resposta da compra anterior some. */
  reset(): void {
    this.result.hidden = true;
  }

  private buy(slot: number): void {
    this.result.textContent = RESULT_MESSAGES[this.callbacks.buy(slot)];
    this.result.hidden = false;
  }

  refresh(): void {
    const status = this.callbacks.status();
    const offers = this.callbacks.offers();
    this.help.textContent = status.help;
    this.shelves.textContent = tf('enchant.shelves', status.shelves, MAX_BOOKSHELVES);

    for (let slot = 0; slot < this.buttons.length; slot++) {
      const button = this.buttons[slot];
      const offer = offers[slot];
      if (offer === undefined || offer.enchant < 0) {
        button.disabled = true;
        button.textContent = '—';
        button.classList.remove('affordable', 'short');
        button.setAttribute('aria-label', tf('enchant.offer_none', slot + 1));
        continue;
      }
      const name = `${enchantDef(offer.enchant)?.display ?? '?'} ${offer.level}`;
      const noLevel = !status.creative && status.level < offer.cost;
      const noLapis = !status.creative && status.lapis < offer.lapis;
      const price = tf('enchant.price', levels(offer.cost), offer.lapis);
      const missing = noLevel ? t('enchant.missing_level') : noLapis ? t('enchant.missing_lapis') : '';
      button.disabled = false;
      button.classList.toggle('affordable', !noLevel && !noLapis);
      button.classList.toggle('short', noLevel || noLapis);
      button.textContent = `${name}\n${price}${missing}`;
      button.setAttribute(
        'aria-label',
        tf('enchant.offer_aria', name, levels(offer.cost), offer.lapis, missing),
      );
    }
  }
}
