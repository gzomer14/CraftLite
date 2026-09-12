/**
 * Fluxo dos menus: título → mundos → jogo, mais as opções (doc 08 §3.1–§3.3).
 *
 * Existe para tirar do `main.ts` a parte que **não depende de mundo nenhum**:
 * antes de haver terreno, jogador ou sessão, o jogo já precisa listar saves,
 * criar mundo e ajustar opções.
 *
 * Quando o IndexedDB não está disponível (modo privado, WebView antiga), o
 * fluxo continua funcionando: os mundos ficam só na memória e o jogo avisa. É
 * melhor que uma tela de erro — dá para jogar, só não dá para voltar amanhã.
 */

import { seedFromString } from '../core/rng';
import { newWorldId, type SaveDatabase, type WorldMeta, STORE_WORLDS } from '../save/db';
import { WORLD_HEIGHT } from '../world/chunk';
import { OptionsScreen } from './screens/options';
import { TitleScreen } from './screens/title';
import { WorldsScreen } from './screens/worlds';
import type { SettingsStore } from '../game/settings';

export interface MenuFlowCallbacks {
  /** Chamado quando o jogador escolhe um mundo para jogar. */
  start: (meta: WorldMeta) => void;
}

export class MenuFlow {
  private readonly db: SaveDatabase | null;
  private readonly title: TitleScreen;
  private readonly worlds: WorldsScreen;
  private readonly options: OptionsScreen;
  /** Mundos em memória, quando não há banco. */
  private readonly transient: WorldMeta[] = [];

  constructor(db: SaveDatabase | null, settings: SettingsStore, callbacks: MenuFlowCallbacks) {
    this.db = db;
    this.options = new OptionsScreen(settings);

    this.worlds = new WorldsScreen({
      list: () => this.listWorlds(),
      play: (meta) => {
        this.hideAll();
        callbacks.start(meta);
      },
      create: (name, seed, mode, difficulty) => this.createWorld(name, seed, mode, difficulty),
      remove: (meta) => this.removeWorld(meta),
      back: () => {
        this.worlds.hide();
        this.title.show();
      },
    });

    this.title = new TitleScreen({
      onPlay: () => {
        this.title.hide();
        void this.worlds.show();
      },
      onOptions: () => {
        this.title.hide();
        this.options.show(() => this.title.show());
      },
    });
  }

  get isOpen(): boolean {
    return this.title.isOpen || this.worlds.isOpen || this.options.isOpen;
  }

  showTitle(): void {
    this.title.show();
  }

  /** Abre as opções de dentro do jogo (menu de pausa). */
  openOptions(onClose?: () => void): void {
    this.options.show(onClose);
  }

  hideAll(): void {
    this.title.hide();
    this.worlds.hide();
    this.options.hide();
  }

  private async listWorlds(): Promise<WorldMeta[]> {
    if (this.db === null) return this.transient;
    try {
      return await this.db.getAll<WorldMeta>(STORE_WORLDS);
    } catch {
      return this.transient;
    }
  }

  private async createWorld(
    name: string, seed: string, gameMode: 'survival' | 'creative', difficulty: 0 | 1 | 2 | 3,
  ): Promise<WorldMeta> {
    const meta = newWorldMeta(name, seed, gameMode, difficulty);
    if (this.db === null) {
      this.transient.push(meta);
      return meta;
    }
    try {
      await this.db.put(STORE_WORLDS, meta);
    } catch {
      this.transient.push(meta);
    }
    return meta;
  }

  private async removeWorld(meta: WorldMeta): Promise<void> {
    const index = this.transient.indexOf(meta);
    if (index >= 0) this.transient.splice(index, 1);
    if (this.db === null) return;
    try {
      await this.db.deleteWorld(meta.id);
    } catch {
      // Falhou apagar: a lista recarrega e o mundo continua lá, o que é
      // preferível a fingir que sumiu.
    }
  }
}

/** Meta de um mundo novo, com os padrões do doc 11 §1. */
export function newWorldMeta(
  name: string, seed: string, gameMode: 'survival' | 'creative', difficulty: 0 | 1 | 2 | 3,
): WorldMeta {
  return {
    id: newWorldId(),
    name: name.trim() === '' ? 'Novo Mundo' : name.trim(),
    seed,
    seedHash: seedFromString(seed),
    version: 1,
    worldHeight: WORLD_HEIGHT,
    gameMode,
    difficulty,
    // 1000 ticks = manhã, o mesmo início do `DayNight`.
    time: 1000,
    totalTicks: 0,
    spawn: [0, 0, 0],
    createdAt: Date.now(),
    lastPlayed: Date.now(),
    sizeBytes: 0,
  };
}
