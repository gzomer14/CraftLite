/**
 * Tela do mapa (M10): o mapa explorado, o jogador, os marcadores e a lista
 * deles.
 *
 * Abre usando o item `map` ou pela tecla do mapa (`M`), com um mapa no
 * inventário ou no Criativo. O mundo continua rodando por baixo, como numa
 * tela de contêiner. Arrastar move a vista; dois toques (ou duplo clique)
 * num ponto põem um marcador ali; "Marcar aqui" põe onde o jogador está.
 *
 * A pintura é de `ui/mapview.ts`; aqui é só DOM. A vista se redesenha ao abrir,
 * ao mover, ao dar zoom e duas vezes por segundo enquanto aberta — o jogador
 * anda e o mapa enche.
 */

import { dimensionOf } from '../../data/dimensions';
import { MARKER_NAME_MAX, MAX_MARKERS, type Marker } from '../../game/markers';
import {
  MAP_VIEW, MAP_ZOOMS, compassPoint, headingOnView, paintMapView, viewToWorld, worldToView,
} from '../mapview';
import { menuButton, menuPanel, menuRoot, menuRow } from './menu';
import type { Journal } from '../../game/journal';
import type { Player } from '../../entity/player';
import { t, tf } from '../../core/i18n';

export interface MapScreenDeps {
  journal: Journal;
  player: Player;
  /** Dimensão atual: o mapa só existe na que tem céu. */
  dimension: () => number;
  /** Cores do mapa, montadas na primeira abertura (`render/mapcolors.ts`). */
  palette: () => Uint8Array;
  /** Para onde a bússola aponta (o nascimento do mundo). */
  spawn: () => readonly [number, number];
  onClose: () => void;
}

/** Ticks entre redesenhos com a tela aberta. */
const REDRAW_TICKS = 10;
/** Arrasto abaixo disto é toque, não arrasto. */
const DRAG_SLOP = 6;

export class MapScreen {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly image: ImageData | null;
  private readonly coords: HTMLParagraphElement;
  private readonly notice: HTMLParagraphElement;
  private readonly list: HTMLDivElement;
  private readonly addButton: HTMLButtonElement;
  private readonly d: MapScreenDeps;
  private readonly scratch = new Float64Array(2);

  private open_ = false;
  private zoomIndex = 2;
  private centerX = 0;
  private centerZ = 0;
  /** A vista segue o jogador até ele arrastar. */
  private following = true;
  private ticks = 0;
  private listVersion = -1;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;
  private dragCenterX = 0;
  private dragCenterZ = 0;

  constructor(deps: MapScreenDeps) {
    this.d = deps;
    injectStyle();
    this.root = menuRoot('map-screen');
    const { panel, body } = menuPanel(t('map.title'));
    panel.classList.add('map-panel');

    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_VIEW;
    this.canvas.height = MAP_VIEW;
    this.canvas.className = 'map-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', t('map.aria'));
    this.context = this.canvas.getContext('2d');
    this.image = this.context?.createImageData(MAP_VIEW, MAP_VIEW) ?? null;
    this.bindPointer();

    this.coords = document.createElement('p');
    this.coords.className = 'menu-hint map-coords';
    this.notice = document.createElement('p');
    this.notice.className = 'menu-hint';
    this.notice.hidden = true;
    this.notice.textContent = t('map.no_sky');

    this.addButton = menuButton(t('map.mark_here'), () => this.markHere(), 'primary');
    const tools = menuRow(
      menuButton('−', () => this.zoom(-1)),
      menuButton('+', () => this.zoom(1)),
      menuButton(t('map.center'), () => { this.following = true; this.redraw(); }),
      this.addButton,
    );
    tools.classList.add('map-tools');

    this.list = document.createElement('div');
    this.list.className = 'map-markers';

    const hint = document.createElement('p');
    hint.className = 'menu-hint';
    hint.textContent = t('map.hint');

    body.append(this.canvas, this.coords, this.notice, tools, hint, this.list,
      menuRow(menuButton(t('common.close'), () => this.close())));
    this.root.append(panel);
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    this.open_ = true;
    this.following = true;
    this.ticks = 0;
    this.listVersion = -1;
    this.root.hidden = false;
    this.redraw();
    this.addButton.focus();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.hidden = true;
    this.d.onClose();
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /** Um tick do jogo com a tela aberta: redesenha de vez em quando. */
  tick(): void {
    if (!this.open_) return;
    if (++this.ticks % REDRAW_TICKS === 0) this.redraw();
  }

  private zoom(step: number): void {
    this.zoomIndex = Math.max(0, Math.min(MAP_ZOOMS.length - 1, this.zoomIndex + step));
    this.redraw();
  }

  private markHere(): void {
    const p = this.d.player;
    this.d.journal.markers.add('', p.x, p.y, p.z, this.d.dimension());
    this.redraw();
  }

  private redraw(): void {
    const { player, journal } = this.d;
    if (this.following) {
      this.centerX = player.x;
      this.centerZ = player.z;
    }
    const hasSky = dimensionOf(this.d.dimension()).hasSky;
    this.notice.hidden = hasSky;
    this.canvas.hidden = !hasSky;
    this.coords.textContent = `X ${Math.floor(player.x)} · Y ${Math.floor(player.y)} · Z ${Math.floor(player.z)}`;
    this.addButton.disabled = journal.markers.list.filter((m) => m.kind === 'user').length >= MAX_MARKERS;
    if (hasSky) this.paint();
    if (journal.markers.version !== this.listVersion) this.renderList();
    else this.refreshDistances();
  }

  private paint(): void {
    const ctx = this.context;
    const image = this.image;
    if (ctx === null || image === null) return;
    const zoom = MAP_ZOOMS[this.zoomIndex];
    paintMapView(this.d.journal.map, this.d.palette(), image.data, this.centerX, this.centerZ, zoom);
    ctx.putImageData(image, 0, 0);

    const dimension = this.d.dimension();
    const spawn = this.d.spawn();
    // O nascimento do mundo, para onde a bússola aponta: branco, sem letra —
    // um "N" ali se leria como norte.
    this.drawPin(spawn[0], spawn[1], '#ffffff', '', zoom);
    for (const marker of this.d.journal.markers.list) {
      if (marker.dimension !== dimension) continue;
      this.drawPin(marker.x + 0.5, marker.z + 0.5, marker.color, marker.kind === 'death' ? '✝' : '', zoom);
    }
    this.drawPlayer(zoom);
  }

  /** Losango colorido no ponto; preso na borda quando sai da vista. */
  private drawPin(x: number, z: number, color: string, label: string, zoom: number): void {
    const ctx = this.context;
    if (ctx === null) return;
    worldToView(x, z, this.centerX, this.centerZ, zoom, this.scratch);
    const px = Math.max(5, Math.min(MAP_VIEW - 5, this.scratch[0]));
    const py = Math.max(5, Math.min(MAP_VIEW - 5, this.scratch[1]));
    ctx.beginPath();
    ctx.moveTo(px, py - 5);
    ctx.lineTo(px + 4, py);
    ctx.lineTo(px, py + 5);
    ctx.lineTo(px - 4, py);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (label !== '') {
      ctx.fillStyle = '#000';
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px, py + 0.5);
    }
  }

  private drawPlayer(zoom: number): void {
    const ctx = this.context;
    if (ctx === null) return;
    const p = this.d.player;
    worldToView(p.x, p.z, this.centerX, this.centerZ, zoom, this.scratch);
    const angle = headingOnView(p.yaw);
    ctx.save();
    ctx.translate(this.scratch[0], this.scratch[1]);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();
  }

  // --- lista de marcadores ----------------------------------------------------

  private renderList(): void {
    const { markers } = this.d.journal;
    this.listVersion = markers.version;
    this.list.textContent = '';
    if (markers.list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'menu-hint';
      empty.textContent = t('map.no_markers');
      this.list.append(empty);
      return;
    }
    for (const marker of markers.list) this.list.append(this.row(marker));
    this.refreshDistances();
  }

  private row(marker: Marker): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'map-marker';
    row.dataset.id = String(marker.id);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = marker.color;
    const name = document.createElement('input');
    name.type = 'text';
    name.value = marker.name;
    name.maxLength = MARKER_NAME_MAX;
    name.setAttribute('aria-label', t('map.marker_name'));
    name.addEventListener('change', () => {
      this.d.journal.markers.rename(marker.id, name.value);
      this.listVersion = this.d.journal.markers.version;
      this.paint();
    });
    const where = document.createElement('span');
    where.className = 'where';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', tf('map.delete_marker', marker.name));
    remove.addEventListener('click', () => {
      this.d.journal.markers.remove(marker.id);
      this.redraw();
    });
    row.append(swatch, name, where, remove);
    return row;
  }

  /** Distância e rumo de cada marcador, sem refazer a lista. */
  private refreshDistances(): void {
    const p = this.d.player;
    const dimension = this.d.dimension();
    const rows = this.list.querySelectorAll<HTMLDivElement>('.map-marker');
    rows.forEach((row) => {
      const marker = this.d.journal.markers.list.find((m) => String(m.id) === row.dataset.id);
      const where = row.querySelector<HTMLSpanElement>('.where');
      if (marker === undefined || where === null) return;
      if (marker.dimension !== dimension) {
        where.textContent = t('map.other_dimension');
        return;
      }
      const distance = Math.round(Math.hypot(marker.x + 0.5 - p.x, marker.z + 0.5 - p.z));
      where.textContent = `${distance} m ${compassPoint(p.x, p.z, marker.x + 0.5, marker.z + 0.5)}`;
    });
  }

  // --- arrastar e marcar --------------------------------------------------------

  private bindPointer(): void {
    let lastTap = 0;
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragCenterX = this.centerX;
      this.dragCenterZ = this.centerZ;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.dragStartX;
      const dy = event.clientY - this.dragStartY;
      if (!this.dragMoved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      this.dragMoved = true;
      this.following = false;
      const scale = this.pixelsPerBlockOnScreen();
      // X cresce para a esquerda na vista (ver `ui/mapview.ts`).
      this.centerX = this.dragCenterX + dx / scale;
      this.centerZ = this.dragCenterZ + dy / scale;
      this.redraw();
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.dragMoved) return;
      const now = performance.now();
      if (now - lastTap < 350) this.markAt(event.clientX, event.clientY);
      lastTap = now;
    });
    this.canvas.addEventListener('pointercancel', () => { this.dragging = false; });
  }

  /** Pixels de tela por bloco no zoom atual. */
  private pixelsPerBlockOnScreen(): number {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / MAP_VIEW : 1;
    return MAP_ZOOMS[this.zoomIndex] * scale;
  }

  private markAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = ((clientX - rect.left) / rect.width) * MAP_VIEW;
    const py = ((clientY - rect.top) / rect.height) * MAP_VIEW;
    viewToWorld(px, py, this.centerX, this.centerZ, MAP_ZOOMS[this.zoomIndex], this.scratch);
    this.d.journal.markers.add('', this.scratch[0], this.d.player.y, this.scratch[1], this.d.dimension());
    this.redraw();
  }
}

let styled = false;

function injectStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
#map-screen .map-panel{max-width:min(96vw,560px)}
.map-canvas{display:block;width:min(86vw,62vh,512px);aspect-ratio:1;margin:0 auto;
  image-rendering:pixelated;border:2px solid #000;background:#363028;touch-action:none;cursor:grab}
.map-coords{text-align:center}
.map-tools{flex-wrap:wrap;justify-content:center}
.map-tools button{min-width:44px}
.map-markers{display:flex;flex-direction:column;gap:6px;max-height:30vh;overflow-y:auto}
.map-marker{display:flex;align-items:center;gap:8px}
.map-marker .swatch{width:14px;height:14px;border:2px solid #000;flex:none}
.map-marker input{flex:1;min-width:0;min-height:36px;background:#0e141b;color:#fff;
  border:2px solid #000;padding:4px 8px;font:13px ui-monospace,monospace}
.map-marker .where{font:12px ui-monospace,monospace;opacity:.8;white-space:nowrap}
#map-screen .map-marker button{flex:none;width:44px;min-width:44px;min-height:36px;padding:0}`;
  document.head.appendChild(style);
}
