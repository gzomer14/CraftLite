/**
 * Marcadores de ponto de interesse (M10).
 *
 * O jogador marca onde está (ou um ponto do mapa), dá um nome, e o marcador
 * aparece na borda de cima da tela apontando o rumo e a distância
 * (`ui/markerbar.ts`) e no mapa. A morte no Sobrevivência deixa um sozinho,
 * "Última morte", onde o inventário caiu — é o que liga o mapa ao monte de
 * itens que agora sobrevive ao save.
 *
 * Vão no registro do jogador (`PlayerSave.markers`): são do jogador, não do
 * mundo, e assim viajam também no arquivo exportado.
 */

/** Teto: uma borda de tela com mais que isto é ruído, não navegação. */
export const MAX_MARKERS = 24;
/** Nome mais longo aceito. */
export const MARKER_NAME_MAX = 24;
/** Cores dos marcadores, em ordem de uso. */
export const MARKER_COLORS: readonly string[] = [
  '#e8c547', '#5fb4f0', '#7bd66a', '#f08a5f', '#c490f0', '#f06f9a', '#6ae0d0', '#f0f0f0',
];
/** A cor do marcador da morte, fora da roda. */
export const DEATH_COLOR = '#e0413a';

export type MarkerKind = 'user' | 'death';

export interface Marker {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: number;
  color: string;
  kind: MarkerKind;
}

export class Markers {
  readonly list: Marker[] = [];
  /** Sobe a cada mudança: a UI redesenha só quando ele muda. */
  version = 0;
  private nextId = 1;

  /** Novo marcador; `null` se já há `MAX_MARKERS`. */
  add(name: string, x: number, y: number, z: number, dimension: number): Marker | null {
    const users = this.list.filter((m) => m.kind === 'user').length;
    if (users >= MAX_MARKERS) return null;
    const marker: Marker = {
      id: this.nextId++,
      name: cleanName(name) || `Marcador ${users + 1}`,
      x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), dimension,
      color: MARKER_COLORS[users % MARKER_COLORS.length],
      kind: 'user',
    };
    this.list.push(marker);
    this.version++;
    return marker;
  }

  remove(id: number): void {
    const index = this.list.findIndex((m) => m.id === id);
    if (index < 0) return;
    this.list.splice(index, 1);
    this.version++;
  }

  rename(id: number, name: string): void {
    const marker = this.list.find((m) => m.id === id);
    const clean = cleanName(name);
    if (marker === undefined || clean === '' || clean === marker.name) return;
    marker.name = clean;
    this.version++;
  }

  /** Morreu: o marcador da morte vai para cá (só há um). */
  setDeath(x: number, y: number, z: number, dimension: number): void {
    const old = this.list.findIndex((m) => m.kind === 'death');
    if (old >= 0) this.list.splice(old, 1);
    this.list.push({
      id: this.nextId++, name: 'Última morte',
      x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), dimension,
      color: DEATH_COLOR, kind: 'death',
    });
    this.version++;
  }

  snapshot(): Marker[] {
    return this.list.map((m) => ({ ...m }));
  }

  /** Save antigo não tem o campo. Registro estranho é descartado, não quebra. */
  restore(saved: readonly Partial<Marker>[] | undefined): void {
    this.list.length = 0;
    this.nextId = 1;
    for (const m of saved ?? []) {
      if (typeof m.x !== 'number' || typeof m.z !== 'number' || typeof m.name !== 'string') continue;
      const kind: MarkerKind = m.kind === 'death' ? 'death' : 'user';
      this.list.push({
        id: this.nextId++,
        name: cleanName(m.name) || 'Marcador',
        x: m.x, y: typeof m.y === 'number' ? m.y : 64, z: m.z,
        dimension: typeof m.dimension === 'number' ? m.dimension : 0,
        color: typeof m.color === 'string' ? m.color : kind === 'death' ? DEATH_COLOR : MARKER_COLORS[0],
        kind,
      });
      if (this.list.length >= MAX_MARKERS + 1) break;
    }
    this.version++;
  }
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MARKER_NAME_MAX);
}
