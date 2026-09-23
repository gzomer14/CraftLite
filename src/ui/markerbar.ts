/**
 * Marcadores na borda de cima da tela (M10, doc 14 "visível na borda da tela").
 *
 * Cada marcador da dimensão atual vira um losango na faixa do topo, na posição
 * horizontal em que ele **está** na tela — a conta é a da perspectiva, então o
 * losango fica exatamente acima do lugar marcado. Fora do campo de visão ele
 * encosta na borda do lado para onde é preciso virar, com uma seta. Embaixo, a
 * distância; perto do centro, também o nome.
 *
 * Sem alocação por quadro: os elementos são de um pool, e o DOM só é tocado
 * quando a posição anda um pixel ou a distância muda um metro.
 */

import type { Markers } from '../game/markers';
import type { Player } from '../entity/player';

/** Distância mínima do centro do rótulo até a borda da tela. */
const EDGE = 48;
/** Abaixo disto do centro, o nome aparece junto da distância. */
const NAME_ANGLE = (14 * Math.PI) / 180;

interface Slot {
  el: HTMLDivElement;
  pin: HTMLSpanElement;
  text: HTMLSpanElement;
  x: number;
  distance: number;
  mode: number;
  name: string;
  color: string;
}

export class MarkerBar {
  readonly element: HTMLDivElement;
  private readonly slots: Slot[] = [];

  constructor() {
    injectStyle();
    this.element = document.createElement('div');
    this.element.className = 'marker-bar';
    this.element.setAttribute('aria-hidden', 'true');
  }

  /**
   * Um quadro. `fovDeg` é o campo de visão vertical da câmera e `aspect` a
   * razão largura/altura da tela.
   */
  update(markers: Markers, player: Player, dimension: number, fovDeg: number, aspect: number): void {
    const halfV = (fovDeg * Math.PI) / 360;
    const tanHalfH = Math.tan(halfV) * aspect;
    const halfH = Math.atan(tanHalfH);
    // A faixa ocupa a largura da janela; ler `clientWidth` a cada quadro forçaria layout.
    const width = window.innerWidth;

    let used = 0;
    const list = markers.list;
    for (let i = 0; i < list.length; i++) {
      const marker = list[i];
      if (marker.dimension !== dimension) continue;
      const slot = this.slot(used++);
      const dx = marker.x + 0.5 - player.x;
      const dz = marker.z + 0.5 - player.z;
      // Mesmo sinal da bússola (`ui/dials.ts`): positivo é à direita.
      let relative = player.yaw - Math.atan2(dx, dz);
      relative = Math.atan2(Math.sin(relative), Math.cos(relative));
      const inside = Math.abs(relative) < halfH;
      const fraction = inside ? 0.5 + Math.tan(relative) / tanHalfH / 2 : relative > 0 ? 1 : 0;
      // O rótulo tem 120 px de largura centrado no losango: longe da borda o
      // bastante para a seta de "vire para cá" não ficar cortada.
      const x = Math.round(Math.min(width - EDGE, Math.max(EDGE, fraction * width)));

      const distance = Math.round(Math.hypot(dx, dz));
      // 0 no centro com nome, 1 na tela, 2 fora à direita, 3 fora à esquerda.
      const mode = !inside ? (relative > 0 ? 2 : 3) : Math.abs(relative) < NAME_ANGLE ? 0 : 1;

      if (slot.x !== x) {
        slot.x = x;
        slot.el.style.transform = `translateX(${x}px)`;
      }
      // O texto só é remontado quando muda: nada de string nova a cada quadro.
      if (slot.distance !== distance || slot.mode !== mode || slot.name !== marker.name) {
        slot.distance = distance;
        slot.mode = mode;
        slot.name = marker.name;
        slot.text.textContent = mode === 0 ? `${marker.name} · ${distance} m`
          : mode === 1 ? `${distance} m`
            : mode === 2 ? `${distance} m ▶` : `◀ ${distance} m`;
      }
      if (slot.color !== marker.color) {
        slot.color = marker.color;
        slot.pin.style.background = marker.color;
      }
      slot.el.hidden = false;
    }
    for (let i = used; i < this.slots.length; i++) this.slots[i].el.hidden = true;
    this.element.hidden = used === 0;
  }

  private slot(index: number): Slot {
    let slot = this.slots[index];
    if (slot !== undefined) return slot;
    const el = document.createElement('div');
    el.className = 'marker';
    const pin = document.createElement('span');
    pin.className = 'pin';
    const text = document.createElement('span');
    text.className = 'label';
    el.append(pin, text);
    this.element.append(el);
    slot = { el, pin, text, x: -1, distance: -1, mode: -1, name: '', color: '' };
    this.slots.push(slot);
    return slot;
  }
}

let styled = false;

function injectStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
.marker-bar{position:absolute;left:0;right:0;top:0;height:34px;pointer-events:none;
  background:linear-gradient(#00000066,#00000000)}
.marker-bar .marker{position:absolute;left:0;top:3px;display:flex;flex-direction:column;
  align-items:center;margin-left:-60px;width:120px}
.marker-bar .pin{width:9px;height:9px;transform:rotate(45deg);border:2px solid #000}
.marker-bar .label{margin-top:2px;font:11px/1 ui-monospace,monospace;color:#fff;
  text-shadow:1px 1px 0 #000;white-space:nowrap}`;
  document.head.appendChild(style);
}
