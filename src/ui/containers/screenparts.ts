/**
 * Os blocos que montam as telas de contêiner: mochila (armadura e boneco),
 * grade de criação, fornalha, fileira de slots e estação de trabalho. Saíram
 * de `screen.ts` no M32, que passou do teto de 700 linhas com a interface
 * nova; lá fica o comportamento (abrir, fechar, redesenhar, caber na tela).
 *
 * Cada montador recebe `make`, que cria o slot com os gestos ligados e o
 * registra na tela, e devolve o bloco pronto para ir na coluna.
 */

import { t } from '../../core/i18n';
import { ARMOR_START, CRAFT_RESULT, OFFHAND } from '../../game/inventory';

/** Cria um slot da tela (com gestos) e devolve o elemento. */
export type SlotMaker = (source: 'inv' | 'cont', index: number, placeholder?: string) => HTMLDivElement;

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function caption(text: string): HTMLDivElement {
  const el = div('slot-caption');
  el.textContent = text;
  return el;
}

/**
 * Armadura em coluna ao lado do boneco, a mão secundária embaixo dele (M32).
 * A casa vazia mostra o contorno da peça (`data-ghost`, no CSS) — o nome
 * escrito dentro dela não cabia nem se lia num celular.
 */
export function buildLoadout(make: SlotMaker, doll: HTMLElement): HTMLDivElement {
  const loadout = div('section loadout');
  const armor = div('armor');
  const names = [t('screen.helmet'), t('screen.chest_armor'), t('screen.legs'), t('screen.boots')];
  const ghosts = ['head', 'chest', 'legs', 'feet'];
  for (let i = 0; i < 4; i++) {
    const slot = make('inv', ARMOR_START + i, names[i]);
    slot.dataset.ghost = ghosts[i];
    armor.appendChild(slot);
  }
  const figure = div('figure');
  const offhand = make('inv', OFFHAND, t('screen.offhand'));
  offhand.dataset.ghost = 'offhand';
  figure.append(doll, offhand);
  loadout.append(armor, figure);
  return loadout;
}

/** Grade de criação, a seta e o resultado grande embaixo dela. */
export function buildCraft(
  make: SlotMaker, columns: number, indices: readonly number[], source: 'inv' | 'cont',
): HTMLDivElement {
  const block = div('section craft');
  const heading = div('section-title');
  heading.textContent = t('screen.crafting_grid');
  const row = div('slots');
  row.style.setProperty('--cols', String(columns));
  for (const index of indices) row.appendChild(make(source, index));
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.textContent = '↓';
  arrow.setAttribute('aria-hidden', 'true');
  const result = make('inv', CRAFT_RESULT);
  result.classList.add('big');
  block.append(heading, row, arrow, result);
  return block;
}

/**
 * Fornalha (M32): a entrada em cima, a chama no meio, o combustível embaixo,
 * e a barra que anda até a saída — o desenho do caminho do item, em vez de
 * três casas empilhadas com o nome embaixo.
 */
export function buildFurnace(make: SlotMaker): HTMLDivElement {
  const row = div('section furnace');
  const stack = div('stack');
  const flame = div('flame');
  flame.appendChild(document.createElement('i'));
  stack.append(
    make('cont', 0, t('screen.input')), caption(t('screen.input')), flame,
    make('cont', 1, t('screen.fuel')), caption(t('screen.fuel')),
  );
  const bar = div('arrow-bar');
  bar.appendChild(document.createElement('i'));
  const out = div('stack');
  const output = make('cont', 2, t('screen.output'));
  output.classList.add('big');
  out.append(output, caption(t('screen.output')));
  row.append(stack, bar, out);
  return row;
}

/**
 * Título e fileira juntos num bloco. O rótulo do slot único ("Entrada")
 * vai escrito embaixo: até 2026-09-24 ele ia para um `data-hint` que nenhum
 * CSS lia (relato de campo da mesa de encantamento).
 */
export function buildSection(
  make: SlotMaker, label: string, columns: number, indices: readonly number[],
  source: 'inv' | 'cont', hint?: string, placeholders?: readonly string[],
): HTMLDivElement {
  const section = div('section');
  if (label !== '') {
    const heading = div('section-title');
    heading.textContent = label;
    section.appendChild(heading);
  }
  const row = div('slots');
  row.style.setProperty('--cols', String(columns));
  for (let i = 0; i < indices.length; i++) row.appendChild(make(source, indices[i], placeholders?.[i]));
  section.appendChild(row);
  if (hint !== undefined) section.appendChild(caption(hint));
  return section;
}

/**
 * Os slots de uma estação de trabalho numa fileira, cada um com o rótulo
 * embaixo, e sinais entre eles: `Item + Material → Resultado`. Dentro do
 * slot o nome só vale para o leitor de tela; embaixo, ele se lê.
 */
export function buildStation(
  make: SlotMaker, parts: readonly (readonly [number, string] | string)[],
): HTMLDivElement {
  const row = div('section station');
  for (const part of parts) {
    if (typeof part === 'string') {
      const sign = document.createElement('span');
      sign.className = 'station-sign';
      sign.textContent = part;
      sign.setAttribute('aria-hidden', 'true');
      row.appendChild(sign);
      continue;
    }
    const cell = div('station-cell');
    cell.append(make('cont', part[0], part[1]), caption(part[1]));
    row.appendChild(cell);
  }
  return row;
}
