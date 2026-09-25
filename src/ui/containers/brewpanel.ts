/**
 * O miolo da tela do suporte de preparo (M16): a barra da fervura, as bolhas
 * do combustível e a frase do próximo passo.
 *
 * Os cinco slots são slots comuns da grade de `screen.ts`, em estação
 * (`Ingrediente`, `Combustível`, três `Frasco`); aqui fica só o que a grade não
 * sabe desenhar. Módulo à parte como a bigorna e a mesa.
 */

import type { BrewingStand } from '../../game/brewing';
import { brewingHelp } from '../../game/stationhelp';
import { BREWS_PER_FUEL } from '../../data/potions';

export class BrewPanel {
  readonly element: HTMLDivElement;
  private readonly bar: HTMLElement;
  private readonly fuel: HTMLDivElement;
  private readonly help: HTMLDivElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'section brew';
    const track = document.createElement('div');
    track.className = 'arrow-bar brew-bar';
    this.bar = document.createElement('i');
    track.appendChild(this.bar);
    this.fuel = document.createElement('div');
    this.fuel.className = 'station-note';
    this.help = document.createElement('div');
    this.help.className = 'station-help';
    this.help.setAttribute('role', 'status');
    this.element.append(track, this.fuel, this.help);
  }

  refresh(stand: BrewingStand): void {
    this.bar.style.transform = `scaleX(${stand.progress.toFixed(3)})`;
    this.fuel.textContent = `Combustível: ${stand.fuel} de ${BREWS_PER_FUEL} preparos`;
    this.help.textContent = brewingHelp(stand);
  }
}
