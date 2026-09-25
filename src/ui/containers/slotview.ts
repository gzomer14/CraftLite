/**
 * Um slot da tela de contêiner: o DOM, o desenho da pilha e o texto do
 * tooltip. Saiu de `screen.ts` no M18; os gestos estão em `slotgestures.ts`.
 *
 * O desenho é incremental: `renderSlot` guarda a chave da última pilha e não
 * toca no DOM se nada mudou (doc 08 §4.6).
 */

import { t, tf } from '../../core/i18n';
import { itemDef, type ItemStack } from '../../data/items';
import { describeEnchants } from '../../game/enchanting';

/** Um slot desenhado: de onde vem o item e para onde vai o clique. */
export interface SlotView {
  el: HTMLDivElement;
  label: HTMLSpanElement;
  bar: HTMLDivElement;
  /** `'inv'` = inventário do jogador, `'cont'` = contêiner aberto. */
  source: 'inv' | 'cont';
  index: number;
  /** Última chave desenhada, para pular redesenho. */
  rendered: string;
  /** Texto mostrado quando o slot está vazio — o que vai ali (armadura). */
  placeholder?: string;
}

/**
 * O DOM de um slot: rótulo, barra de durabilidade e os atributos que o leitor
 * de tela e os testes leem. Os gestos são de `slotgestures.ts`.
 */
export function makeSlotView(
  source: 'inv' | 'cont', index: number, placeholder?: string,
): SlotView {
  const el = document.createElement('div');
  el.className = 'slot';
  // Identifica o slot no DOM: serve para depurar a tela no aparelho e é como
  // os testes acham o slot de resultado sem depender da ordem de montagem.
  el.dataset.slot = `${source}:${index}`;
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  // Rótulo inicial: `renderSlot` sai cedo quando a chave não mudou, e para um
  // slot que nasce vazio a chave inicial já é a final — sem isto o leitor de
  // tela encontraria um botão sem nome.
  el.setAttribute('aria-label', placeholder ?? t('screen.empty'));

  const label = document.createElement('span');
  if (placeholder !== undefined) {
    el.classList.add('ghost');
    label.textContent = placeholder;
  }
  const bar = document.createElement('div');
  bar.className = 'durability';
  // Nasce escondida: `renderSlot` sai cedo quando a chave não mudou, e para
  // um slot vazio a chave inicial já é a final — a barra nunca seria ocultada.
  bar.hidden = true;
  el.append(label, bar);

  return {
    el, label, bar, source, index, rendered: '',
    ...(placeholder !== undefined ? { placeholder } : {}),
  };
}

export function renderSlot(
  view: SlotView, stack: ItemStack | null,
  spriteOf: ((item: number) => string | null) | undefined, colorOf: (item: number) => string,
): void {
  const key = stack === null
    ? ''
    : `${stack.item}:${stack.count}:${stack.damage}:${stack.ench ?? 0}`;
  if (view.rendered === key) return;
  view.rendered = key;

  if (stack === null) {
    view.label.textContent = view.placeholder ?? '';
    view.bar.hidden = true;
    view.el.classList.remove('filled', 'sprite', 'enchanted');
    view.el.classList.toggle('ghost', view.placeholder !== undefined);
    view.el.style.removeProperty('--item-color');
    view.el.style.removeProperty('background-position');
    view.el.setAttribute('aria-label', view.placeholder ?? t('screen.empty'));
    return;
  }
  view.el.classList.remove('ghost');
  const def = itemDef(stack.item);
  view.el.setAttribute('aria-label', `${def?.display ?? '?'} ×${stack.count}`);

  // Com sprite, o slot mostra o desenho e só o número; sem, cai na cor média
  // do bloco com as duas primeiras letras do nome.
  const sprite = spriteOf?.(stack.item) ?? null;
  if (sprite !== null) {
    view.el.classList.add('sprite');
    view.el.style.backgroundPosition = sprite;
    view.el.style.removeProperty('--item-color');
    view.label.textContent = stack.count > 1 ? String(stack.count) : '';
  } else {
    view.el.classList.remove('sprite');
    view.el.style.removeProperty('background-position');
    view.el.style.setProperty('--item-color', colorOf(stack.item));
    view.label.textContent = labelFor(stack);
  }
  view.el.classList.add('filled');
  // Item encantado ganha um brilho arroxeado — é o único sinal na grade de
  // que aquela picareta não é uma picareta comum.
  view.el.classList.toggle('enchanted', (stack.ench ?? 0) !== 0);

  const durability = def?.durability;
  if (durability !== undefined && stack.damage > 0) {
    view.bar.hidden = false;
    const remaining = 1 - stack.damage / durability;
    view.bar.style.transform = `scaleX(${remaining.toFixed(3)})`;
    view.bar.style.background = remaining > 0.5 ? '#5ad04a' : remaining > 0.2 ? '#d0c04a' : '#d04a4a';
  } else {
    view.bar.hidden = true;
  }
}

/** Nome, encantamentos e durabilidade da pilha, ou `null` se não houver. */
export function describeStack(stack: ItemStack | null): string | null {
  if (stack === null) return null;

  const def = itemDef(stack.item);
  // Nome da bigorna em cima, com o nome do item embaixo (M15).
  let text = stack.name !== undefined ? `"${stack.name}"\n${def?.display ?? '?'}` : def?.display ?? '?';
  // Encantamentos em cima da durabilidade, como no doc 08 §3.5.
  const enchants = describeEnchants(stack.ench ?? 0);
  if (enchants !== '') text += `\n${enchants}`;
  if (def?.durability !== undefined) {
    text += `\n${tf('screen.durability', def.durability - stack.damage, def.durability)}`;
  }
  return text;
}

/** Texto do slot. Sem sprites de item ainda: inicial + contagem. */
export function labelFor(stack: ItemStack): string {
  const def = itemDef(stack.item);
  const name = def?.display ?? '?';
  const short = name.replace(/^(de |da |do )/, '').slice(0, 2);
  return stack.count > 1 ? `${short}\n${stack.count}` : short;
}
