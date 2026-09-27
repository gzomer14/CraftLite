/**
 * A porta do jogo para a rede local (M20).
 *
 * O código de rede (`src/net/room.ts` e o que ele puxa) é um pedaço de bundle à
 * parte: quem joga sozinho não baixa nem roda nada dele. Este módulo é o
 * **único** do jogo com `import()` (`tests/modsisolation.test.ts` cobra): ele
 * guarda as alças do jogo em andamento e baixa a rede quando o jogador abre ou
 * entra numa sala.
 *
 * O pedaço de rede importa módulos do jogo, e isso não custa requisição: o
 * Rollup os entrega a partir do próprio pedaço principal, que já está na
 * memória (o `size-report` confere que o principal não importa nada).
 */

import type { ChunkColumn } from '../world/chunk';
import type { ChunkPipeline } from '../world/pipeline';
import type { World } from '../world/world';
import type { Player } from '../entity/player';
import type { Session } from './session';
import type { SaveGame } from './savegame';
import type { PlayerSave, WorldMeta } from '../save/db';
import type { Hud } from '../ui/hud';
import type { GameFlow } from '../ui/gameflow';
import type { Controls } from '../input/controls';
import type { SceneFeed } from '../render/scenefeed';
import type { MobRenderer } from '../render/mobrender';
import type { EntityAtlas } from '../render/entityatlas';

/** O jogo em andamento, visto pelo código de rede. */
export interface GameHandles {
  world: World;
  player: Player;
  session: Session;
  pipeline: ChunkPipeline;
  meta: WorldMeta;
  /** `null` no convidado: o mundo não é dele, e nada vai para o banco dele. */
  save: SaveGame | null;
  hud: Hud;
  flow: GameFlow;
  controls: Controls;
  sceneFeed: SceneFeed;
  mobRenderer: MobRenderer;
  entityAtlas: EntityAtlas;
  /** Tier do aparelho: o limite da sala é 4 jogadores em T0, 6 acima (doc 14). */
  tier: number;
}

/**
 * Como o convidado entra num mundo que não é dele: o que o anfitrião mandou
 * na entrada, de onde vêm os chunks, e quem assume quando o mundo estiver de pé.
 */
export interface RemoteStart {
  /** O convidado como o anfitrião o guardou; `null` na primeira vez. */
  saved: PlayerSave | null;
  loadChunk(cx: number, cz: number): Promise<ChunkColumn | null>;
  attach(game: GameHandles): void;
}

let current: GameHandles | null = null;
let roomLabel: (() => string) | null = null;
let leaving: (() => Promise<void>) | null = null;

/** O `main` registra o jogo assim que ele está de pé. */
export function setGame(game: GameHandles): void {
  current = game;
}

/**
 * A URL do pedaço de rede, preenchida pelo build (`craftlite-net-chunk` no
 * `vite.config.ts`). O `import()` por variável é de propósito: o Vite embrulha
 * em `__vitePreload` todo `import()` de caminho escrito, e esse ajudante viraria
 * um pedaço que o jogo sem sala teria de baixar.
 */
declare const __CRAFTLITE_NET_URL__: string;

function loadNet(): Promise<typeof import('../net/room')> {
  const url: string = __CRAFTLITE_NET_URL__;
  return import(/* @vite-ignore */ url) as Promise<typeof import('../net/room')>;
}

/** Abre a sala (ou o painel dela, se já aberta), a partir da pausa. */
export function openRoom(): void {
  const game = current;
  if (game === null) return;
  void loadNet().then((net) => {
    roomLabel = net.roomLabel;
    net.openRoom(game);
  });
}

/** O rótulo do botão da pausa: "Abrir para a rede local" até a sala existir. */
export function roomButtonLabel(fallback: string): string {
  return roomLabel?.() ?? fallback;
}

/** Entra numa sala, a partir do título. `start` sobe o jogo como convidado. */
export function joinRoom(start: (meta: WorldMeta, remote: RemoteStart) => void, back: () => void): void {
  void loadNet().then((net) => net.joinRoom(start, back));
}

/** O código de rede diz o que fazer ao sair do mundo (fechar a sala, se despedir). */
export function onLeaveRoom(fn: () => Promise<void>): void {
  leaving = fn;
}

/** *Salvar e Sair*: sem sala, não faz nada. */
export async function leaveRoom(): Promise<void> {
  const fn = leaving;
  leaving = null;
  await fn?.();
}
