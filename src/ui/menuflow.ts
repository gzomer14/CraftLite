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
import { archiveFileName, exportWorld, importWorld } from '../save/archive';
import { newWorldId, type SaveDatabase, type WorldMeta, STORE_WORLDS } from '../save/db';
import { clearPack, decodeImage, loadPack, readPack, savePack } from '../render/pack';
import { WORLD_HEIGHT } from '../world/chunk';
import { OptionsScreen } from './screens/options';
import { PacksScreen, type PackSummary } from './screens/packs';
import { ModsScreen, modName } from './screens/mods';
import { MOD_CATALOG, readEnabledMods, writeEnabledMods } from '../mods/catalog';
import { missingMods } from '../mods/worldmods';
import { TitleScreen } from './screens/title';
import { WorldsScreen } from './screens/worlds';
import type { SettingsStore } from '../game/settings';
import type { Keybinds } from '../input/keybinds';
import type { Gamepads } from '../input/gamepad';
import { t, tf } from '../core/i18n';

export interface MenuFlowCallbacks {
  /** Chamado quando o jogador escolhe um mundo para jogar. */
  start: (meta: WorldMeta) => void;
  /** Entrar numa sala na rede local (M20); `back` volta ao título. */
  join: (back: () => void) => void;
}

export class MenuFlow {
  private readonly db: SaveDatabase | null;
  private readonly title: TitleScreen;
  private readonly worlds: WorldsScreen;
  private readonly options: OptionsScreen;
  private readonly packs: PacksScreen;
  private readonly mods: ModsScreen;
  /** Mundos em memória, quando não há banco. */
  private readonly transient: WorldMeta[] = [];

  constructor(
    db: SaveDatabase | null, settings: SettingsStore, keybinds: Keybinds,
    gamepads: Gamepads | null, callbacks: MenuFlowCallbacks,
  ) {
    this.db = db;
    this.options = new OptionsScreen(settings, keybinds, gamepads);

    this.worlds = new WorldsScreen({
      list: () => this.listWorlds(),
      play: (meta) => {
        if (!this.modsReady(meta)) return;
        this.hideAll();
        callbacks.start(meta);
      },
      create: (name, seed, mode, difficulty) => this.createWorld(name, seed, mode, difficulty),
      remove: (meta) => this.removeWorld(meta),
      exportWorld: (meta) => this.exportWorld(meta),
      importWorld: (file) => this.importWorld(file),
      thumbnail: (worldId) => this.db?.loadThumbnail(worldId) ?? Promise.resolve(undefined),
      back: () => {
        this.worlds.hide();
        this.title.show();
      },
    });

    this.packs = new PacksScreen({
      current: () => this.currentPack(),
      install: (file) => this.installPack(file),
      remove: () => this.removePack(),
      // Recarregar é o que aplica o pacote — ver o comentário de `render/pack.ts`.
      apply: () => location.reload(),
      back: () => {
        this.packs.hide();
        this.title.show();
      },
    });

    this.mods = new ModsScreen(() => {
      this.mods.hide();
      this.title.show();
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
      onPacks: () => {
        this.title.hide();
        void this.packs.show();
      },
      onMods: () => {
        this.title.hide();
        this.mods.show();
      },
      onJoin: () => {
        this.title.hide();
        callbacks.join(() => this.title.show());
      },
    });
  }

  get isOpen(): boolean {
    return this.title.isOpen || this.worlds.isOpen || this.options.isOpen
      || this.packs.isOpen || this.mods.isOpen;
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
    this.packs.hide();
    this.mods.hide();
  }

  /**
   * O mundo pede mods que não estão ligados (M21): oferece ligar e recarregar.
   * Não abre sem eles — ver `mods/worldmods.ts`.
   */
  private modsReady(meta: WorldMeta): boolean {
    const missing = missingMods(meta.mods);
    if (missing.length === 0) return true;
    const known = MOD_CATALOG.filter((info) => missing.includes(info.id));
    if (known.length < missing.length) {
      alert(tf('mods.world_unknown', missing.filter((id) => !known.some((i) => i.id === id)).join(', ')));
      return false;
    }
    if (confirm(tf('mods.world_needs', known.map(modName).join(', ')))) {
      const enabled = readEnabledMods();
      writeEnabledMods(MOD_CATALOG.filter((i) => enabled.includes(i.id) || missing.includes(i.id))
        .map((i) => i.id));
      location.reload();
    }
    return false;
  }

  // --- pacote de texturas (M7) ---------------------------------------------

  private async currentPack(): Promise<PackSummary | null> {
    const pack = await loadPack(this.db);
    return pack === null
      ? null
      : {
        name: pack.name, accepted: pack.textures.size, ignored: 0,
        sounds: pack.sounds?.size ?? 0,
      };
  }

  /**
   * Lê o `.zip` escolhido e guarda o pacote.
   *
   * O nome do pacote é o do arquivo, sem extensão: é o que o jogador reconhece,
   * e nenhum formato de pacote do gênero tem metadado que a gente possa ler sem
   * inventar convenção nova.
   */
  private async installPack(file: File): Promise<PackSummary> {
    if (this.db === null) throw new Error(t('store.no_pack'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/\.zip$/i, '');
    const { pack, ignored } = await readPack(name, bytes, decodeImage);
    await savePack(this.db, pack);
    return {
      name: pack.name, accepted: pack.textures.size, ignored: ignored.length,
      sounds: pack.sounds?.size ?? 0,
    };
  }

  private async removePack(): Promise<void> {
    if (this.db === null) return;
    await clearPack(this.db);
  }

  /**
   * Exporta o mundo para um arquivo que o navegador baixa (M7).
   *
   * O download é um `<a download>` com uma URL de blob — o único jeito de
   * escrever no disco sem permissão especial, e o que funciona no WebView
   * antigo tanto quanto no Chrome de hoje. A URL é revogada logo depois, senão
   * o arquivo inteiro fica preso na memória da aba.
   */
  private async exportWorld(meta: WorldMeta): Promise<void> {
    if (this.db === null) throw new Error(t('store.no_export'));
    const bytes = await exportWorld(this.db, meta.id);
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = archiveFileName(meta.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /** Lê o arquivo escolhido e cria o mundo. Devolve o nome que ele ganhou. */
  private async importWorld(file: File): Promise<string> {
    if (this.db === null) throw new Error(t('store.no_import'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = await importWorld(this.db, bytes);
    return meta.name;
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
    name: name.trim() === '' ? t('worlds.new_world') : name.trim(),
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
