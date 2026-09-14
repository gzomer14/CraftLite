/**
 * Bootstrap do CraftLite.
 *
 * Ordem do boot (doc 02 §4: a tela aparece antes de qualquer worker subir):
 *   1. contexto GL e detecção de tier
 *   1b. resource pack do jogador, se houver — ele precisa chegar antes do atlas
 *   2. atlas procedural (~15–25 ms, o único trabalho pesado do boot)
 *   3. renderer, mundo, pipeline, jogador, controles, HUD, debug
 *   4. loop 20 Hz + rAF
 */

import { AudioEngine } from './audio/engine';
import { BUSES, BUS_SETTING } from './data/soundbuses';
import { Music } from './audio/music';
import { blockSound } from './audio/synth';
import { GameLoop } from './core/loop';
import { registerServiceWorker, showUpdateToast } from './core/pwa';
import { detectTier, presetFor, readDeviceInfo } from './core/tier';
import { DEG2RAD, createVec3, forwardFrom } from './core/math';
import { BIOMES } from './data/biomes';
import { BLOCK_BY_NAME, defOf, texOf } from './data/blocks';
import { ITEM_BY_NAME, itemDef, makeStack } from './data/items';
import { MOB_BY_NAME, mobDef } from './data/mobs';
import { nextObjective, objectiveFor } from './data/achievements';

/** Nome legível do alvo de uma conquista, item ou mob. */
const displayOfTarget = (target: string): string =>
  ITEM_BY_NAME.get(target)?.display ?? MOB_BY_NAME.get(target)?.display ?? target;
import { modelOf } from './data/mobmodels';
import { Player } from './entity/player';
import { SaveGame } from './game/savegame';
import { SettingsStore } from './game/settings';
import { Session } from './game/session';
import { MAX_AIR } from './game/survival';
import { Controls } from './input/controls';
import { Keybinds } from './input/keybinds';
import { Gamepads } from './input/gamepad';
import { profileById } from './data/gamepads';
import { NAV_STEP_MS, UiNavigator } from './input/uinav';
import { Atlas } from './render/atlas';
import { DynamicScale } from './render/dynamicscale';
import { EntityAtlas, ARROW_LAYER, BOAT_LAYER, MINECART_LAYER } from './render/entityatlas';
import { createContext } from './render/gl';
import { ItemRenderer } from './render/itemrender';
import { HandRenderer } from './render/hand';
import { ItemSprites, SPRITE_SIZE } from './render/itemsprites';
import { HD_SPRITE_SIZE } from './render/itemart3d';
import { loadPack, overridesFor, soundOverridesFor } from './render/pack';
import { MobRenderer } from './render/mobrender';
import { Renderer } from './render/renderer';
import { SaveDatabase, isAvailable as saveAvailable, type WorldMeta } from './save/db';
import { SaveManager } from './save/savemanager';
import { ContainerScreen } from './ui/containers/screen';
import { CreativeScreen } from './ui/containers/creative';
import { MenuFlow, newWorldMeta } from './ui/menuflow';
import { DeathScreen } from './ui/screens/death';
import { PauseMenu } from './ui/screens/pause';
import { Hud } from './ui/hud';
import { ScreenMode } from './ui/screenmode';
import { TouchUi } from './ui/touchui';
import { DebugOverlay, type DebugSource } from './ui/debug';
import { SEA_LEVEL, type ChunkColumn } from './world/chunk';
import { trySpawn } from './game/spawnplacement';
import { ChunkPipeline } from './world/pipeline';
import { World } from './world/world';

/** Blocos que aparecem na hotbar inicial, até o inventário existir (M4). */
/** Acima disto de cota usada, o doc 11 §4 manda avisar o jogador. */
const QUOTA_WARN_RATIO = 0.8;

const STARTING_BLOCKS = [
  'stone', 'cobblestone', 'dirt', 'oak_planks', 'oak_log', 'glass', 'torch', 'glowstone', 'sand',
];

async function boot(): Promise<void> {
  const view = document.getElementById('view') as HTMLCanvasElement | null;
  if (view === null) throw new Error('Canvas #view não encontrado.');
  // Cópia não-nula: o `startGame` é uma função aninhada e o TypeScript não
  // carrega o estreitamento do `if` para dentro dela.
  const canvas: HTMLCanvasElement = view;

  const settings = new SettingsStore();
  /*
   * As teclas nascem **antes** do mundo, como as opções: a tela de opções é
   * alcançável pelo título, e ela precisa da mesma instância que o `Controls`
   * vai usar lá na frente — senão remapear no menu não valeria em jogo.
   */
  const keybinds = new Keybinds();
  /*
   * O controle e a navegação de interface também nascem antes do mundo: a tela
   * de título é a primeira coisa que aparece, e ela precisa ser navegável por
   * gamepad (doc 08 §4.3) sem depender de um mundo carregado.
   */
  const gamepads = new Gamepads();
  const uiNav = new UiNavigator();
  startUiNavLoop(gamepads, uiNav, settings);
  const pwa = registerServiceWorker();
  pwa.onUpdateAvailable = showUpdateToast;

  progress(0.1, 'criando contexto gráfico…');
  const ctx = createContext(canvas, settings.get('vsync'));

  const device = readDeviceInfo(ctx.caps);
  /*
   * A escolha do jogador vence a detecção (doc 02 §1, e o comentário de
   * `core/tier.ts` desde sempre). Ela lê quatro números do navegador, dois dos
   * quais saturam — `deviceMemory` para em 8 —, e num celular topo de linha
   * errou para baixo em campo. Quem sabe que aparelho tem é quem está com ele.
   */
  const forced = settings.get('quality');
  const tier = forced >= 0 ? (forced as 0 | 1 | 2) : detectTier(device);
  const preset = presetFor(tier, device);
  // Override manual das opções vence a detecção, que erra com frequência.
  const rdOverride = settings.get('renderDistance');
  if (rdOverride > 0) preset.renderDistance = rdOverride;

  /*
   * Banco e resource pack antes do atlas (M7).
   *
   * O pack é do jogador e mora no banco dele (doc 13 §7). Ele precisa estar na
   * mão **antes** de o atlas gerar um pixel, porque mipmap, média de cor das
   * partículas e a folha de sprites de item derivam todos dos mesmos arrays.
   * É uma leitura só e o banco ia abrir daqui a três linhas de qualquer jeito.
   */
  const db = saveAvailable() ? new SaveDatabase() : null;
  /*
   * Armazenamento persistente (doc 11 §4), pedido o quanto antes.
   *
   * Sem `persist()` o navegador trata a base como descartável e pode limpá-la
   * sozinho sob pressão de espaço — num aparelho de 2 GB isso não é hipótese.
   * O método existia em `save/db.ts` desde o M4 e **nunca tinha sido chamado**
   * (relato de campo 2026-09-12). Não bloqueia o boot: negado ou não
   * implementado, o jogo entra igual. Os avisos ao jogador ficam no
   * `startGame`, que é onde existe HUD para mostrá-los.
   */
  void db?.requestPersistence();
  const pack = await loadPack(db);

  progress(0.35, 'gerando texturas…');
  /*
   * Estilo de textura (`data/texturestyle.ts`), lido uma vez e só aqui.
   *
   * Ele não chega a existir depois do boot: o que ele muda são os bytes que o
   * atlas, o atlas de entidade e a folha de sprites geram. Nenhum caminho de
   * render, tick ou mesh pergunta o estilo — é por isso que o Clássico custa
   * exatamente o que sempre custou.
   */
  const style = settings.get('textureStyle');
  const atlas = new Atlas(ctx, overridesFor(pack, 'block'), style);
  const entityAtlas = new EntityAtlas(ctx, overridesFor(pack, 'entity'), style);
  // Folha de sprites de item: cubo isométrico para bloco, máscara para o resto.
  const itemSprites = new ItemSprites(atlas, overridesFor(pack, 'item'), {
    size: style === 'nitido' ? HD_SPRITE_SIZE : SPRITE_SIZE,
    style,
  });
  itemSprites.installCssVariables();

  progress(0.65, 'preparando renderizador…');
  const renderer = new Renderer(ctx, atlas, preset);
  const mobRenderer = new MobRenderer(ctx, entityAtlas, preset.tier === 0 ? 320 : 768);
  renderer.mobRenderer = mobRenderer;
  // Áudio só nasce no primeiro gesto (doc 10 §1); até lá tudo é descartado.
  const audio = new AudioEngine({
    voices: preset.tier === 0 ? 8 : 16,
    soundOverrides: soundOverridesFor(pack),
  });
  audio.subtitlesEnabled = settings.get('subtitles');
  let music: Music | null = null;
  const dynamicScale = new DynamicScale(preset.targetFps);
  dynamicScale.enabled = settings.get('dynamicResolution');
  const debug = new DebugOverlay(tier, preset, ctx.caps, device, atlas.layerCount, atlas.buildMs);

  progress(1, 'pronto');
  hideBootScreen();

  // --- fluxo de menus: título → mundos → jogo ------------------------------
  const menu = new MenuFlow(db, settings, keybinds, gamepads, {
    start: (meta) => { void startGame(meta); },
  });

  const params = new URLSearchParams(location.search);
  if (params.has('seed') || params.has('mode')) {
    // Atalho de desenvolvimento: `?seed=` entra direto, sem passar pelo menu.
    void startGame(newWorldMeta(
      'Mundo rápido',
      params.get('seed') ?? '',
      params.get('mode') === 'creative' ? 'creative' : 'survival',
      settings.get('difficulty') as 0 | 1 | 2 | 3,
    ));
  } else {
    menu.showTitle();
  }

  /**
   * Constrói o mundo escolhido e entra em jogo.
   *
   * Tudo que depende de mundo vive aqui dentro: antes disso o jogo é só a tela
   * de título, e é isso que permite escolher o save antes de gerar terreno.
   */
  async function startGame(meta: WorldMeta): Promise<void> {
  const seed = meta.seedHash;
  const world = new World(seed);
  // A sessão só existe mais abaixo; o pipeline avisa por esta referência.
  let sessionUnloaded: ((chunk: ChunkColumn) => void) | null = null;
  const pipeline = new ChunkPipeline(world, {
    workers: preset.workers,
    renderDistance: preset.renderDistance,
    packed: ctx.gl2 !== null,
    // Recarrega, como a qualidade: o AO é assado no mesh de cada section.
    smoothLighting: settings.get('smoothLighting'),
    targetFps: preset.targetFps,
  });
  pipeline.onChunkUnloaded = (chunk) => {
    save?.unloadChunk(chunk);
    sessionUnloaded?.(chunk);
    renderer.chunks.releaseColumn(chunk.cx, chunk.cz);
  };

  const player = new Player(0.5, SEA_LEVEL + 30, 0.5);
  player.mode = meta.gameMode;
  player.flying = player.mode === 'creative';
  player.pitch = 15 * DEG2RAD;

  const hud = new Hud(settings);
  /*
   * Avisos de armazenamento (doc 11 §4), agora que há HUD para mostrá-los.
   *
   * Os dois chegam **ao entrar no mundo**, que é o momento em que ainda dá para
   * agir: descobrir que o progresso não seria salvo depois de duas horas de
   * construção é tarde demais.
   */
  if (db === null) {
    hud.showMessage('Sem armazenamento neste navegador: o progresso não será salvo.', 400);
  } else {
    void db.estimate().then((estimate) => {
      if (estimate === null || estimate.quota <= 0) return;
      if (estimate.usage / estimate.quota <= QUOTA_WARN_RATIO) return;
      const used = Math.round((estimate.usage / estimate.quota) * 100);
      hud.showMessage(`Armazenamento em ${used}% — apague mundos antigos.`, 400);
    });
  }
  const screenMode = new ScreenMode();
  const isTouchDevice = matchMedia('(pointer: coarse)').matches;

  const slotColor = new Float32Array(3);
  const containerScreen = new ContainerScreen({
    onClose: () => { session.closeScreen(); },
    colorOf: (item) => {
      const def = itemDef(item);
      atlas.averageColor(atlas.layerOf(def?.tex ?? 'block/missing'), slotColor);
      return `rgb(${Math.round(slotColor[0] * 255)},${Math.round(slotColor[1] * 255)},`
        + `${Math.round(slotColor[2] * 255)})`;
    },
    spriteOf: (item) => itemSprites.position(item),
    recipes: () => session.recipes.entries(),
    onPickRecipe: (entry) => session.autoFillRecipe(entry),
    enchantOffers: () => session.enchantOffers,
    onEnchantRefresh: () => session.refreshEnchantOffers(),
    onBuyEnchant: (slot) => session.buyEnchant(slot),
    xpLevel: () => session.xp.level,
    onFurnaceOutput: (furnace, item) => session.collectFurnaceXp(furnace, item),
    longPressMs: () => settings.get('longPressMs'),
    // O toque longo do slot não tem retorno visual próprio; a vibração é o que
    // diz ao jogador que o gesto pegou.
    vibrate: () => { if (settings.get('vibration')) navigator.vibrate?.(12); },
  });
  const creativeScreen = new CreativeScreen({
    onClose: () => { controls.reset(); },
    // A paleta escolhe o item; a mochila é quem veste. Sem esta ponte, no
    // criativo não havia como chegar aos slots de armadura.
    onOpenInventory: () => { session.toggleInventory(); },
    longPressMs: () => settings.get('longPressMs'),
    spriteOf: (item) => itemSprites.position(item),
    colorOf: (item) => {
      const def = itemDef(item);
      atlas.averageColor(atlas.layerOf(def?.tex ?? 'block/missing'), slotColor);
      return `rgb(${Math.round(slotColor[0] * 255)},${Math.round(slotColor[1] * 255)},`
        + `${Math.round(slotColor[2] * 255)})`;
    },
  });
  const deathScreen = new DeathScreen({
    onRespawn: () => { deathScreen.hide(); session.respawn(0, 0); },
    onQuit: () => { deathScreen.hide(); session.respawn(0, 0); },
  });

  const session = new Session(world, player, {
    onDimensionChange: (dimension) => {
      /*
       * Trocar de dimensão é uma troca de mundo inteira: o pipeline descarrega
       * tudo e recomeça, o save passa a gravar com a chave da dimensão nova, e
       * o céu muda de tabela. A ordem importa — `pipeline.setDimension` dispara
       * `onChunkUnloaded` para cada coluna, e o save precisa gravá-las ainda
       * com a chave **antiga**.
       */
      // `world.dimension` é escrito pela própria `Session`, **depois** deste
      // evento: quem ouve ainda precisa ver a dimensão que está sendo deixada.
      pipeline.setDimension(dimension);
      save?.switchDimension(dimension);
      renderer.setDimension(dimension);
      renderer.chunks.clear();
    },
    onOpenScreen: (screen, container) => {
      if (screen === 'none') containerScreen.close();
      else containerScreen.open(screen, session.inventory, container);
      if (screen !== 'none') controls.mouse.exitLock();
      audio.playUi('ui/click', 0.5);
    },
    onDeath: (message) => deathScreen.show(message),
    onPickup: () => {
      if (settings.get('vibration')) navigator.vibrate?.(6);
      audio.playUi('player/pickup', 0.5);
    },
    // O barramento sai do nome do som (`data/soundbuses.ts`); quem dispara não
    // precisa saber em qual slider de volume ele cai.
    onSound: (name, x, y, z) => audio.play(name, x, y, z),
    onMessage: (text) => hud.showMessage(text),
    onAchievement: (title, description) => hud.showAchievement(title, description),
    onHurt: () => {
      hud.flashDamage();
      if (settings.get('vibration')) navigator.vibrate?.(20);
      // Combate corta a música (doc 10 §3).
      music?.stop();
    },
  }, {
    maxMobs: preset.maxMobs,
    simulationDistance: preset.simulationDistance,
  });
  const dayNight = session.dayNight;
  /*
   * Trovão: o único som do jogo que não vem de perto do jogador. Toca sem
   * posição, porque um raio a 300 blocos continua sendo ouvido.
   */
  session.weather.onLightning = () => { audio.playUi('weather/thunder', 0.9, 'weather'); };
  session.survival.difficulty = meta.difficulty;
  const inventory = session.inventory;
  const interaction = session.interaction;
  const itemRenderer = new ItemRenderer(ctx, itemSprites.raw);
  // Item na mão (doc 01 §191). O passe é uma draw call e limpa a profundidade,
  // então não disputa com nada — mas continua desligável em Opções.
  const handRenderer = new HandRenderer(ctx, atlas, itemSprites.raw);
  handRenderer.enabled = settings.get('handItem');
  renderer.handRenderer = handRenderer;

  // --- persistência (doc 11) ------------------------------------------------
  /*
   * Miniatura do mundo (doc 08 §3.2).
   *
   * O contexto nasce com `preserveDrawingBuffer: false` — ligá-lo custaria uma
   * cópia do backbuffer **todo frame** —, então o canvas só pode ser lido
   * dentro do mesmo quadro em que foi desenhado. Daí o desenho em duas partes:
   * o render copia para um canvas pequeno logo depois de desenhar, e o save
   * pega os bytes quando precisar deles.
   */
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 160;
  thumbCanvas.height = 90;
  const thumbCtx = thumbCanvas.getContext('2d');
  let thumbPending = true;
  let thumbData = '';

  /** Copia o quadro recém-desenhado para o canvas pequeno. */
  function grabThumbnail(): void {
    if (!thumbPending || thumbCtx === null) return;
    thumbPending = false;
    try {
      thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      thumbData = thumbCanvas.toDataURL('image/png');
    } catch {
      // Canvas "sujo" ou contexto perdido: o mundo fica sem miniatura.
      thumbData = '';
    }
  }

  const save = db === null
    ? null
    : new SaveGame(new SaveManager(db, meta.id), session, player, meta, {
      onError: (message) => hud.showMessage(`Falha ao salvar: ${message}`, 120),
      captureThumbnail: () => decodeDataUrl(thumbData),
    });

  let restored = false;
  if (save !== null) {
    save.attach();
    pipeline.loadSaved = (cx, cz) => save.loadChunk(cx, cz);
    try {
      restored = await save.load();
    } catch {
      // Save corrompido ou banco indisponível: começa um mundo novo em vez de
      // travar na tela preta.
      restored = false;
    }
  }

  if (!restored) {
    // Modo criativo começa com blocos para experimentar.
    if (player.mode === 'creative') {
      for (let i = 0; i < STARTING_BLOCKS.length; i++) {
        const block = BLOCK_BY_NAME.get(STARTING_BLOCKS[i]);
        if (block !== undefined) inventory.set(i, makeStack(block.id, 64));
      }
    } else {
      // Sobrevivência começa sem nada — é o ponto do marco.
      const axe = ITEM_BY_NAME.get('wooden_axe');
      if (axe !== undefined) inventory.set(0, makeStack(axe.id, 1));
    }
  }

  // Partículas com a cor média do bloco quebrado (doc 06 §4) + haptics.
  // A `Session` já registrou o próprio handler; aqui só encadeamos o efeito.
  const particleColor = new Float32Array(3);
  /** Reusado por frame para medir o brilho do bloco mirado. */
  const crackColor = new Float32Array(3);
  const sessionBroken = interaction.onBlockBroken;
  interaction.onBlockBroken = (x, y, z, state) => {
    sessionBroken?.(x, y, z, state);
    const layer = atlas.layerOf(texOf(defOf(state), 'side'));
    atlas.averageColor(layer, particleColor);
    renderer.particles.emitBlockBreak(
      x, y, z, 8, particleColor[0], particleColor[1], particleColor[2],
    );
    audio.play(blockSound(defOf(state).sound, 'break'), x + 0.5, y + 0.5, z + 0.5);
    if (settings.get('vibration')) navigator.vibrate?.(10);
    controls.gamepad.rumble();
  };
  const sessionPlaced = interaction.onBlockPlaced;
  interaction.onBlockPlaced = (x, y, z, state) => {
    sessionPlaced?.(x, y, z, state);
    audio.play(blockSound(defOf(state).sound, 'place'), x + 0.5, y + 0.5, z + 0.5, 0.7);
  };

  // Passivos já nascem com o chunk (doc 07 §4) e a roça que veio do save entra
  // no registro de crescimento. A luz do chunk já vem pronta do worker.
  pipeline.onChunkLoaded = (chunk) => session.onChunkLoaded(chunk);
  sessionUnloaded = (chunk) => session.onChunkUnloaded(chunk);

  const controls = new Controls(canvas, settings, {
    onHotbarSelect: (index) => inventory.select(index),
    onHotbarScroll: (delta) => inventory.scroll(delta),
    onPickBlock: () => {
      const target = interaction.state.target;
      if (target !== null) inventory.pickBlock(defOf(target.state).id, player.mode === 'creative');
    },
    onToggleDebug: () => debug.toggle(),
    onToggleFly: () => {
      if (player.mode !== 'creative') return;
      player.flying = !player.flying;
      if (player.flying) player.vy = 0;
    },
    // Esc fecha uma camada por vez (doc 08 §4.1).
    onPause: () => {
      if (creativeScreen.isOpen) creativeScreen.close();
      else if (containerScreen.isOpen) session.closeScreen();
      else togglePause();
    },
    onInventory: () => toggleInventory(),
    // Largar o item da mão no chão (doc 08 §3.5). O `onDrop` do inventário já
    // vai parar na `Session`, que cria a entidade com o arremesso.
    onDropItem: (whole) => { inventory.dropSelected(whole); },
  }, keybinds, gamepads);

  /** No criativo, `E` abre a paleta de itens; no sobrevivência, a mochila. */
  function toggleInventory(): void {
    if (player.mode !== 'creative') { session.toggleInventory(); return; }
    if (creativeScreen.isOpen) { creativeScreen.close(); return; }
    // Mochila aberta pelo atalho da paleta: `E` fecha ela em vez de abrir a
    // paleta por cima — uma camada por vez, como o `Esc` (doc 08 §4.1).
    if (containerScreen.isOpen) { session.closeScreen(); return; }
    controls.mouse.exitLock();
    creativeScreen.open(inventory);
  }

  hud.onSlotSelected = (index) => inventory.select(index);
  hud.spriteOf = (item) => itemSprites.position(item);
  inventory.onChange = () => containerScreen.refresh();

  const pauseMenu = new PauseMenu({
    onResume: () => { paused = false; pauseMenu.hide(); },
    onOptions: () => {
      pauseMenu.hide();
      menu.openOptions(() => pauseMenu.show());
    },
    achievements: () => session.achievements.mask,
    onSaveAndQuit: () => {
      pauseMenu.setStatus('salvando…');
      void (async () => {
        await save?.saveAll();
        // Recarregar é a saída honesta para voltar ao título: garante que nada
        // do mundo antigo (workers, VBOs, listeners) sobreviva ao próximo.
        location.reload();
      })();
    },
  });

  const touchUi = new TouchUi(settings, controls.touch.buttons, {
    onPause: () => togglePause(),
    onInventory: () => toggleInventory(),
    onFlyToggle: () => {
      if (player.mode !== 'creative') return;
      player.flying = !player.flying;
      if (player.flying) player.vy = 0;
    },
    onBreakDown: (down) => { modeBBreaking = down; },
    onPlace: () => { modeBPlace = true; },
  });
  touchUi.setVisible(isTouchDevice);
  touchUi.setCreative(player.mode === 'creative');

  // Estado dos botões dedicados do Modo B.
  let modeBBreaking = false;
  let modeBPlace = false;

  /**
   * O `AudioContext` só pode nascer dentro de um gesto (doc 10 §1). Qualquer
   * um serve — tocar a tela, clicar ou apertar uma tecla.
   */
  let audioStarted = false;
  function startAudio(): void {
    if (audioStarted) return;
    audioStarted = true;
    void audio.start().then(() => {
      applyVolumes();
      music = new Music(audio.context, audio.busNode('music'));
      music.enabled = settings.get('musicVolume') > 0;
    });
  }
  /** Os nove sliders de volume do doc 08 §3.11, em uma passada. */
  function applyVolumes(): void {
    audio.setVolume('master', settings.get('masterVolume'));
    for (const bus of BUSES) audio.setVolume(bus, settings.get(BUS_SETTING[bus]));
  }

  /*
   * Controle ligado: diz qual foi reconhecido, porque é a única forma de o
   * jogador saber que o rótulo dos botões mudou — e porque um controle que o
   * navegador **não** normalizou merece aviso, já que aí o mapeamento é
   * palpite de família e não a especificação.
   */
  gamepads.onConnect((profile) => {
    hud.showMessage(`Controle conectado: ${profile.labels.family}`, 80);
    /*
     * O som não liga sozinho aqui.
     *
     * A política de autoplay pede um **gesto do usuário**, e aperto de botão de
     * controle não conta como gesto em navegador nenhum. Quem só tem o controle
     * na mão jogaria mudo sem entender por quê, então o jogo avisa o que fazer.
     */
    if (!audioStarted) {
      hud.showMessage('Toque na tela ou aperte uma tecla uma vez para ligar o som.', 120);
    }
  });
  audio.onSubtitle = (text, direction) => hud.showSubtitle(text, direction);
  for (const event of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(event, startAudio, { once: false, passive: true });
  }

  // Primeiro toque: tela cheia + trava de orientação (precisa de gesto).
  controls.touch.onFirstTouch = () => screenMode.enter();

  let paused = false;
  function togglePause(): void {
    paused = !paused;
    controls.reset();
    if (paused) {
      controls.mouse.exitLock();
      pauseMenu.show();
    } else {
      pauseMenu.hide();
    }
  }

  showHint(controls, isTouchDevice, gamepads);

  const debugSource: DebugSource = {
    stats: undefined as never,
    camera: renderer.camera,
    drawCalls: 0,
    vertices: 0,
    renderScale: 1,
    chunks: {
      loaded: 0, total: 0, queued: 0, generating: 0, meshing: 0, visibleSections: 0,
    },
    maxFps: 0,
    biome: '—',
    blockLight: 0,
    skyLight: 15,
    entities: { mobs: 0, items: 0, arrows: 0, paths: 0 },
    redstone: 0,
    fire: 0,
    clock: '00:00',
    sounds: 0,
  };

  /** Direção do olhar reusada — `forwardFrom` escreve nela, sem alocar. */
  const aimDirection = createVec3();

  /**
   * Som de passo a cada ~2,2 blocos andados no chão, com a superfície pisada.
   * Um som por tick andando seria uma metralhadora.
   */
  let stepDistance = 0;
  function tickFootsteps(): void {
    if (!player.onGround) return;
    const moved = Math.hypot(player.x - player.prevX, player.z - player.prevZ);
    stepDistance += moved;
    if (stepDistance < 2.2) return;
    stepDistance = 0;
    const below = defOf(world.getBlock(
      Math.floor(player.x), Math.floor(player.y - 0.2), Math.floor(player.z),
    ));
    if (below.shape === 'none') return;
    audio.play(blockSound(below.sound, 'step'), player.x, player.y, player.z, 0.5);
  }

  /**
   * Monta o batch de mobs e flechas do frame (doc 07 §5).
   *
   * A luz é **uma amostra por entidade** — por vértice não mudaria nada na tela
   * e multiplicaria por 24 o número de consultas ao mundo.
   */
  const shadowsEnabled = preset.entityShadows;
  function drawEntities(alpha: number): void {
    mobRenderer.begin();
    const store = session.mobs.store;
    const dayFactor = dayNight.dayFactor;

    for (let i = 0; i < store.active; i++) {
      const def = mobDef(store.type[i]);
      const x = store.renderX(i, alpha);
      const y = store.renderY(i, alpha);
      const z = store.renderZ(i, alpha);
      const bx = Math.floor(x);
      const by = Math.floor(y + store.height(i) * 0.5);
      const bz = Math.floor(z);
      const light = Math.max(
        world.getBlockLight(bx, by, bz), world.getSkyLight(bx, by, bz) * dayFactor,
      );
      // Creeper com o pavio aceso pisca branco: é o aviso de que dá tempo de correr.
      const flash = store.hurtTicks[i] > 0
        ? 1
        : store.fuse[i] > 0 ? (store.fuse[i] % 8 < 4 ? 0.8 : 0) : 0;

      mobRenderer.addModel(
        modelOf(def.model), entityAtlas.layerOf(def.skin),
        x, y, z,
        store.renderYaw(i, alpha), 0,
        store.headYaw[i], store.pitch[i],
        store.limbSwing[i], store.limbAmount[i], store.age[i],
        light, flash, store.scale[i], store.squash[i],
      );
    }

    // Barco e carrinho: mesmo batcher dos mobs, como a flecha (doc 07 §6).
    const cartModel = modelOf(MINECART_LAYER);
    const cartLayer = entityAtlas.layerOf(MINECART_LAYER);
    session.carts.forEach((x, y, z, yaw) => {
      const light = world.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z)) * dayFactor;
      mobRenderer.addModel(
        cartModel, cartLayer, x, y, z, yaw, 0, yaw, 0, 0, 0, 0,
        Math.max(4, light), 0, 1, 0,
      );
    }, alpha);

    const boatModel = modelOf(BOAT_LAYER);
    const boatLayer = entityAtlas.layerOf(BOAT_LAYER);
    session.boats.forEach((x, y, z, yaw) => {
      const light = world.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z)) * dayFactor;
      mobRenderer.addModel(
        boatModel, boatLayer, x, y, z, yaw, 0, yaw, 0, 0, 0, 0,
        Math.max(4, light), 0, 1, 0,
      );
    }, alpha);

    const arrowModel = modelOf(ARROW_LAYER);
    const arrowLayer = entityAtlas.layerOf(ARROW_LAYER);
    session.projectiles.forEach((x, y, z, vx, vy, vz) => {
      const yaw = Math.atan2(vx, vz);
      const pitch = -Math.atan2(vy, Math.hypot(vx, vz) || 0.001);
      mobRenderer.addModel(
        arrowModel, arrowLayer, x, y, z, yaw, pitch, yaw, 0, 0, 0, 0, 12, 0, 1, 0,
      );
    }, alpha);

    // Sombras por último: elas fecham o buffer para poderem ser desenhadas com
    // blending numa segunda chamada.
    if (!shadowsEnabled || !settings.get('entityShadows')) return;
    for (let i = 0; i < store.active; i++) {
      const x = store.renderX(i, alpha);
      const z = store.renderZ(i, alpha);
      const groundY = Math.floor(store.y[i]);
      const light = world.getSkyLight(Math.floor(x), groundY, Math.floor(z)) * dayFactor;
      mobRenderer.addShadow(x, groundY, z, store.width(i) * 0.8, Math.max(4, light));
    }
  }

  /** Espera o terreno existir antes de soltar o jogador na gravidade. */
  let spawned = false;
  /** Três dedos abrem o debug (doc 02 §6) — dispara uma vez por gesto. */
  let threeFingerArmed = true;

  const loop = new GameLoop({
    tick() {
      controls.update((yawDelta, pitchDelta) => {
        Controls.applyLookTo(player, yawDelta, pitchDelta);
      });

      if (controls.touch.fingerCount >= 3) {
        if (threeFingerArmed) { debug.toggle(); threeFingerArmed = false; }
      } else if (controls.touch.fingerCount === 0) {
        threeFingerArmed = true;
      }

      if (paused) return;

      if (!spawned) {
        spawned = trySpawn(world, player, restored);
        player.prevX = player.x; player.prevY = player.y; player.prevZ = player.z;
      } else if (session.travel.isTravelling) {
        /*
         * Atravessando o portal: o mundo de destino ainda está carregando, e
         * rodar a física aqui derrubaria o jogador pelo vazio. A `Session`
         * continua ticando — é ela que espera o chunk chegar e o reposiciona.
         */
        player.prevX = player.x; player.prevY = player.y; player.prevZ = player.z;
      } else if (session.isRiding) {
        // Pilotando: o veículo é que anda, e o jogador vai junto (M6/M7).
        session.driveVehicle(controls.state.forward);
      } else if (!session.survival.isDead) {
        const fallBefore = player.fallDistance;
        const wasAirborne = !player.onGround;
        player.tick(world, controls.state);
        // Encostou no chão neste tick: cobra o dano da queda acumulada.
        if (wasAirborne && player.onGround) session.applyFallDamage(fallBefore);
      }

      session.tick();

      // Com uma tela de contêiner aberta o mundo continua rodando, mas o
      // jogador não interage com ele (doc 08 §4.2).
      if (containerScreen.isOpen || creativeScreen.isOpen || deathScreen.isOpen) {
        interaction.tickBreaking(false, null);
        session.cancelEating();
        /*
         * A mão continua animando, parada.
         *
         * Sair do tick antes de `handRenderer.tick()` congela o golpe no meio:
         * `previous` e `current` ficam em valores diferentes para sempre e o
         * render interpola entre os dois a cada frame. Abrir a bancada com a
         * mão vazia — um clique de usar, que dispara o golpe e abre a tela no
         * mesmo tick — deixava a mão vibrando para frente e para trás até
         * fechar (relato de campo 2026-09-12).
         */
        const heldNow = inventory.held;
        handRenderer.setHeld(heldNow === null ? -1 : heldNow.item);
        handRenderer.tick(0);
        return;
      }

      // Mira: no Modo A vem do dedo; senão, do centro da tela.
      if (controls.hasAim) {
        const ray = renderer.camera.rayFromNdc(controls.aimNdcX, controls.aimNdcY);
        interaction.updateTargetAlong(ray[0], ray[1], ray[2]);
      } else {
        interaction.updateTarget();
      }

      const breaking = controls.state.breaking || modeBBreaking;
      // Mob na frente do bloco: o golpe vai nele, não na parede atrás.
      //
      // Vale **nos dois modos**. Com o golpe restrito ao sobrevivência, bater
      // em qualquer bicho no criativo não fazia nada visível: o clique caía
      // direto no `tickBreaking`, que no criativo quebra o bloco atrás do mob.
      let attacked = false;
      if (breaking) {
        if (controls.hasAim) {
          const ray = renderer.camera.rayFromNdc(controls.aimNdcX, controls.aimNdcY);
          attacked = session.attackAlong(ray[0], ray[1], ray[2]);
        } else {
          forwardFrom(aimDirection, player.yaw, player.pitch);
          attacked = session.attackAlong(aimDirection[0], aimDirection[1], aimDirection[2]);
        }
      }
      interaction.tickBreaking(breaking && !attacked, inventory.held);

      // Mão: o item vem do slot selecionado, o balanço de bater ou usar, e o
      // passo do quanto o jogador andou neste tick.
      const heldStack = inventory.held;
      handRenderer.setHeld(heldStack === null ? -1 : heldStack.item);
      if (attacked || interaction.state.stage >= 0) handRenderer.swing();
      handRenderer.tick(Math.hypot(player.x - player.prevX, player.z - player.prevZ));

      // Soltar o botão de usar é o que **encerra** comer, carregar o arco e
      // baixar o escudo. Antes a condição olhava o botão de quebrar, e comer
      // era zerado no mesmo tick em que começava — nunca completava.
      const placing = controls.consumePlace() || modeBPlace;
      if (!placing) session.cancelEating();

      if (placing) {
        // Clicar num mob (domar) vence colocar bloco: o jogador está mirando
        // no bicho, não na parede atrás dele.
        let used = false;
        if (controls.hasAim) {
          const ray = renderer.camera.rayFromNdc(controls.aimNdcX, controls.aimNdcY);
          used = session.useOnMob(ray[0], ray[1], ray[2]);
        } else {
          forwardFrom(aimDirection, player.yaw, player.pitch);
          used = session.useOnMob(aimDirection[0], aimDirection[1], aimDirection[2]);
        }
        if (!used) session.useHeld();
        handRenderer.swing();
      }
      modeBPlace = false;

      /*
       * Balanço da câmera: a fase avança com a distância andada no chão.
       *
       * Ligar pelo tempo em vez da distância faria a câmera balançar parada de
       * costas para a parede, empurrando contra ela.
       */
      const camera = renderer.camera;
      if (settings.get('cameraBob') && player.onGround) {
        const walked = Math.hypot(player.x - player.prevX, player.z - player.prevZ);
        camera.bobPhase += walked * 2.4;
        // A intensidade acompanha a velocidade: passo lento balança pouco.
        camera.bobStrength = Math.min(1, walked * 5);
      } else {
        camera.bobStrength = 0;
      }

      renderer.particles.tick();
      // Chuva: um punhado de gotas por tick em volta do jogador, no mesmo pool
      // das outras partículas (doc 03 §8).
      if (session.weather.isRaining) {
        const drops = Math.round(session.weather.intensity * preset.rainDrops);
        if (drops > 0) {
          renderer.particles.emitRain(player.x, player.y, player.z, 10, drops);
        }
      }
      /*
       * Chuva no ouvido: um loop só, com o ganho seguindo a intensidade.
       *
       * Fica embaixo de telhado? Continua chovendo — o som atravessa, e medir
       * cobertura por raycast a cada tick custaria mais do que o realismo vale.
       */
      audio.setLoop('weather/rain', session.weather.intensity * 0.9);
      save?.tick();
      // Uma foto nova a cada 30 s, para a tela de seleção mostrar o mundo como
      // ele está e não como estava na primeira vez que foi salvo.
      if (loop.stats.tick % 600 === 0) thumbPending = true;
      tickFootsteps();
      music?.tick();
      hud.tick();

      pipeline.setCenter(player.x, player.z);
      pipeline.enqueueDirty();
      pipeline.pump();
    },
    pump(budgetMs) {
      pipeline.drainReady(budgetMs, (result) => renderer.chunks.apply(result));
    },
    render(alpha) {
      const camera = renderer.camera;
      camera.prevX = player.prevX;
      camera.prevY = player.prevY + player.eyeHeight;
      camera.prevZ = player.prevZ;
      camera.x = player.x;
      camera.y = player.y + player.eyeHeight;
      camera.z = player.z;
      camera.prevYaw = player.yaw; camera.yaw = player.yaw;
      camera.prevPitch = player.pitch; camera.pitch = player.pitch;

      const target = interaction.state.target;
      const h = renderer.highlight;
      h.visible = target !== null && !paused;
      if (target !== null) {
        h.x = target.x; h.y = target.y; h.z = target.z;
        h.stage = interaction.state.stage;
        // Brilho do bloco mirado: é ele que decide se a fissura sai clara ou
        // escura. `averages` do atlas já está pronto desde o boot, então é
        // leitura de array, não cálculo por frame.
        atlas.averageColor(atlas.layerOf(texOf(defOf(target.state), 'side')), crackColor);
        h.brightness = crackColor[0] * 0.299 + crackColor[1] * 0.587 + crackColor[2] * 0.114;
      }

      drawEntities(alpha);

      // Itens no chão: um billboard por entidade, tudo numa draw call.
      itemRenderer.begin();
      session.items.forEach((x, y, z, item, _count, age) => {
        itemRenderer.add(x, y, z, item, age);
      }, alpha);
      renderer.itemRenderer = itemRenderer;

      // Orbes de XP: um brilho verde por orbe no pool de partículas, em vez de
      // um passe de render novo. Custa zero draw call a mais e some sozinho.
      session.orbs.forEach((x, y, z) => {
        renderer.particles.emitGlow(x, y + 0.15, z, 0.48, 0.84, 0.23);
      }, alpha);

      // A mão acompanha a luz de onde o jogador está: sem isto ela fica acesa
      // dentro da caverna, como se tivesse luz própria.
      const eyeX = Math.floor(player.x);
      const eyeY = Math.floor(player.y + player.eyeHeight);
      const eyeZ = Math.floor(player.z);
      renderer.handLight = Math.max(
        world.getBlockLight(eyeX, eyeY, eyeZ),
        world.getSkyLight(eyeX, eyeY, eyeZ) * dayNight.dayFactor,
      ) / 15;

      /*
       * Campo de visão: o valor das opções mais o "puxão" de correr, escalado
       * pelo controle de distorção da Acessibilidade (doc 08 §6). Em 0% a
       * câmera não mexe — que é exatamente o que quem tem enjoo de movimento
       * precisa —, em 100% ela abre 12% ao correr.
       */
      const distortion = settings.get('distortion') / 100;
      const wantFov = settings.get('fov') * (controls.state.sprint ? 1 + 0.12 * distortion : 1);
      // Interpolação por frame: um salto de FOV é mais desagradável que o efeito.
      camera.fovDeg += (wantFov - camera.fovDeg) * 0.18;

      renderer.skyFlash = session.weather.flash;
      renderer.setDayTime(dayNight.time, dayNight.dayFactor, session.weather.intensity);
      audio.setListener(camera.x, camera.y, camera.z, player.yaw);
      if (music !== null) {
        music.mood = player.y < SEA_LEVEL - 6 ? 'underground' : 'surface';
      }
      renderer.render(alpha);
      // Ainda no mesmo quadro: depois disto o navegador descarta o backbuffer.
      grabThumbnail();

      if (settings.get('dynamicResolution')) {
        // Enquanto há chunk na fila, o frame time mede carregamento, não o
        // custo de desenhar — medir aí faria a escala oscilar e piscar a tela.
        const loading = pipeline.stats.queued > 0 || pipeline.stats.meshing > 0;
        const nextScale = dynamicScale.update(loop.stats.frameMs, renderer.renderScale, loading);
        if (nextScale !== renderer.renderScale) renderer.setRenderScale(nextScale);
      }

      hud.setSelected(inventory.selected);
      hud.render(inventory.slots);
      hud.setStats(
        session.survival.health, session.survival.hunger, session.survival.air, MAX_AIR,
        session.armorPoints,
      );
      hud.setExperience(session.xp.level, session.xp.progress);
      hud.setFps(loop.stats.fps, settings.get('showFps'));
      if (isTouchDevice) {
        const stick = controls.touch.joystick;
        const aimX = ((controls.aimNdcX + 1) / 2) * window.innerWidth;
        const aimY = ((1 - controls.aimNdcY) / 2) * window.innerHeight;
        touchUi.draw(stick, controls.holdProgress, aimX, aimY);
      }

      const now = performance.now();
      // A taxa do display se mede sempre: precisa estar pronta ao abrir o F3.
      debug.sampleDisplayRate(now);
      // O resto só com o overlay aberto — em T0 nem a varredura do anel nem as
      // leituras de estado precisam acontecer 60 vezes por segundo à toa.
      if (debug.isVisible) {
        debugSource.maxFps = loop.maxFps;
        debugSource.entities.mobs = session.mobs.count;
        debugSource.entities.items = session.items.active;
        debugSource.entities.arrows = session.projectiles.active;
        debugSource.entities.paths = session.mobs.pathsComputed;
        debugSource.redstone = session.redstone.lastUpdates;
        debugSource.fire = session.fire.burning;
        debugSource.clock = dayNight.clock;
        debugSource.sounds = audio.loadedSounds;
        updateDebugSource(debugSource, renderer, pipeline, world, player);
        debug.update(now, debugSource);
      }
    },
  });
  debugSource.stats = loop.stats;
  loop.maxFps = settings.get('maxFps');
  /**
   * A linha de objetivo do HUD: o próximo passo da árvore de conquistas.
   *
   * É o único lugar onde o jogo diz o que fazer. A dica de teclas some ao
   * travar o ponteiro, e a tela de conquistas está atrás de duas telas — quem
   * entra pela primeira vez precisa de uma frase visível.
   */
  function refreshObjective(): void {
    const next = nextObjective(session.achievements.mask);
    hud.setObjective(next === undefined ? null : objectiveFor(next, displayOfTarget));
  }

  /** Opções que só se aplicam em algum lugar do render ou da física. */
  /**
   * Distância de render efetiva: o override das opções vence, 0 = seguir o
   * preset do tier.
   *
   * Ela era lida **uma vez, no boot** (ver o `rdOverride` lá em cima): mexer no
   * controle durante a partida não fazia absolutamente nada, e de dentro do
   * jogo isso é indistinguível de a opção estar quebrada (relato de campo
   * 2026-09-12). Agora o pipeline, o plano distante e a névoa acompanham.
   */
  function applyRenderDistance(): void {
    const override = settings.get('renderDistance');
    const distance = override > 0 ? override : preset.renderDistance;
    if (distance === pipeline.renderDistance) return;
    pipeline.setRenderDistance(distance);
    renderer.setRenderDistance(distance);
    // Senão o overlay segue anunciando o valor do boot, e quem está medindo o
    // mundo mede errado (relato de campo 2026-09-13).
    debug.setRenderDistance(distance);
  }

  function applyPlayfieldSettings(): void {
    applyRenderDistance();
    player.autoJump = settings.get('autoJump');
    // Brilho 0–100 → piso de luz ambiente do shader. 50 mantém o 0.06 de antes,
    // e o topo clareia a caverna sem apagar a diferença entre dia e noite.
    renderer.minSkyLight = 0.02 + (settings.get('brightness') / 100) * 0.16;
    hud.applyAccessibility(
      settings.get('highContrast'), settings.get('textScale'), settings.get('damageFlash'),
      settings.get('colorBlind'),
    );

    /*
     * O resto da tabela de Vídeo do doc 08 §3.11.
     *
     * Tudo que é `auto` cai no preset do tier (`core/tier.ts`), que continua
     * sendo o padrão do aparelho; o jogador só sobrescreve o que quiser.
     */
    const clouds = settings.get('clouds');
    renderer.clouds.mode = clouds === 'auto' ? preset.clouds : clouds;
    const particles = settings.get('particles');
    renderer.particles.setMode(particles === 'auto' ? preset.particles : particles);
    renderer.fogMode = settings.get('fog');
    renderer.applyFog();
    renderer.highContrastOutline = settings.get('highContrastOutline');

    // Distância de simulação: é o raio em que mob nasce e some (doc 07 §4).
    const simulation = settings.get('simulationDistance');
    session.spawner.simulationDistance = simulation > 0 ? simulation : preset.simulationDistance;

    session.weather.showFlashes = !settings.get('hideSkyFlashes');

    // Modo A mira no dedo: a mira central apontaria para outro lugar.
    hud.setCrosshairVisible(!(isTouchDevice && settings.get('touchMode') === 'A'));

    // Layout de controle forçado (`auto` deixa a detecção decidir).
    const forced = settings.get('padProfile');
    gamepads.forcedProfile = forced === 'auto' ? null : profileById(forced);

    renderer.resize();
  }
  applyPlayfieldSettings();
  refreshObjective();
  settings.onChange((next) => {
    loop.maxFps = next.maxFps;
    applyVolumes();
    audio.subtitlesEnabled = next.subtitles;
    session.survival.difficulty = next.difficulty as 0 | 1 | 2 | 3;
    if (music !== null) music.enabled = next.musicVolume > 0;
    handRenderer.enabled = next.handItem;
    applyPlayfieldSettings();
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop.stop();
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  window.addEventListener('resize', () => renderer.resize(), { passive: true });
  window.addEventListener('blur', () => controls.reset());
  document.addEventListener('visibilitychange', () => {
    // Suspender o áudio ao perder o foco é regra do doc 10 §5.
    if (document.hidden) {
      controls.reset(); loop.stop(); audio.suspend();
      /*
       * Esconder a aba é o **único** aviso confiável no celular.
       *
       * `beforeunload` não dispara ao trocar de app ou fechar o navegador no
       * Android: quem dispara é isto. Sem gravar aqui, sair do jogo pelo botão
       * de início do aparelho perdia tudo desde o último autosave — e, antes
       * de hoje, o conteúdo dos baús perdia desde sempre.
       *
       * A rede de segurança síncrona vai primeiro, porque ela **sempre**
       * termina; o save completo é assíncrono e pode ser interrompido.
       */
      save?.writeEmergency();
      void save?.saveAll();
    } else { loop.start(); audio.resume(); }
  });

  // Rede de segurança do doc 11 §3: `beforeunload` não espera o IndexedDB, mas
  // o `localStorage` grava na hora.
  window.addEventListener('beforeunload', () => save?.writeEmergency());

  loop.start();

  Object.assign(window as unknown as Record<string, unknown>, {
    craftlite: {
      loop, renderer, atlas, preset, tier, device, world, pipeline, debug, seed,
      player, session, inventory, interaction, settings, controls, touchUi, screenMode,
      audio, entityAtlas, mobRenderer, itemSprites, save, meta, menu,
      mobs: session.mobs, spawner: session.spawner,
      containerScreen, creativeScreen, deathScreen, pauseMenu,
    },
  });
  }
}

/**
 * `data:image/png;base64,…` → bytes. Sem `fetch`, que é assíncrono e teria que
 * esperar por um dado que já está na mão.
 */
function decodeDataUrl(url: string): Uint8Array | null {
  const comma = url.indexOf(',');
  if (comma < 0 || !url.startsWith('data:image/png;base64,')) return null;
  try {
    const binary = atob(url.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Laço da navegação de interface por controle.
 *
 * Roda em `requestAnimationFrame` próprio, e **não** no tick do jogo, porque a
 * tela de título existe muito antes de haver um `GameLoop`: sem isto, quem só
 * tem controle na mão não conseguiria nem entrar num mundo.
 *
 * Dentro do jogo ele continua rodando de graça — `tick` devolve `false` na
 * hora quando não há tela aberta, e o polling do controle é o mesmo que o
 * `Controls` já faria.
 */
function startUiNavLoop(gamepads: Gamepads, uiNav: UiNavigator, settings: SettingsStore): void {
  /*
   * A navegação anda a ~20 Hz, não a 120: a repetição de `UiNavigator` é
   * contada em ticks, e num painel rápido a lista passaria seis vezes mais
   * depressa do que no lento. Amarrar ao relógio deixa o menu igual em
   * qualquer aparelho.
   */
  const stepMs = NAV_STEP_MS;
  let last = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    if (now - last < stepMs) return;
    last = now;
    gamepads.deadZone = settings.get('padDeadZone');
    gamepads.vibration = settings.get('vibration');
    // `pollNav` e não `poll`: a borda de subida é consumida no tick do jogo, e
    // lê-la aqui roubaria o aperto de lá.
    gamepads.pollNav();
    // Quem decide se o mundo recebe o analógico é esta linha: com uma tela
    // aberta, o controle é da tela.
    gamepads.uiCapture = uiNav.tick(gamepads.nav);
  };
  requestAnimationFrame(frame);
}

function updateDebugSource(
  source: DebugSource, renderer: Renderer, pipeline: ChunkPipeline, world: World, player: Player,
): void {
  source.drawCalls = renderer.drawCalls;
  source.vertices = renderer.vertices;
  source.renderScale = renderer.renderScale;
  source.chunks.visibleSections = renderer.chunks.visibleSections;
  source.chunks.queued = pipeline.stats.queued;
  source.chunks.generating = pipeline.stats.generating;
  source.chunks.meshing = pipeline.stats.meshing;
  pipeline.ringProgress(source.chunks);

  const x = Math.floor(player.x);
  const y = Math.floor(player.y + player.eyeHeight);
  const z = Math.floor(player.z);
  source.blockLight = world.getBlockLight(x, y, z);
  source.skyLight = world.getSkyLight(x, y, z);

  const chunk = world.getChunk(x >> 4, z >> 4);
  if (chunk !== undefined) {
    const biome = BIOMES[chunk.biomeMap[((z & 15) << 4) | (x & 15)]];
    source.biome = biome !== undefined ? biome.display : '—';
  } else {
    source.biome = 'carregando…';
  }
}


function showHint(controls: Controls, isTouch: boolean, gamepads: Gamepads): void {
  const hint = document.createElement('div');
  hint.id = 'hint';
  const base = isTouch
    ? 'Esquerda: joystick · Direita: arrastar para olhar, toque curto coloca, toque longo quebra'
    : 'Clique para jogar · WASD mover · Espaço pular · Shift agachar · Ctrl correr · '
      + 'botões do mouse quebrar/colocar · 1-9 e roda trocam de item · F3 debug';
  hint.textContent = base;

  /*
   * A dica de controle só aparece quando há um ligado, e com os rótulos **do
   * controle na mão**: dizer "aperte A" para quem segura um DualSense manda o
   * jogador procurar um botão que não existe no aparelho dele.
   */
  const showPadHint = (): void => {
    if (!gamepads.connected) return;
    const l = gamepads.labels;
    hint.textContent = `${base}\n`
      + `Controle: analógicos mover/olhar · ${l.faceDown} pular · ${l.faceRight} agachar · `
      + `${l.l2} colocar · ${l.r2} quebrar · ${l.faceUp} largar · `
      + `${l.l1}/${l.r1} trocar item · ${l.start} pausa · ${l.faceLeft} mochila`;
  };
  gamepads.onConnect(showPadHint);
  showPadHint();

  document.body.appendChild(hint);
  const style = document.createElement('style');
  // `pre-line` porque a linha do controle entra como um segundo parágrafo.
  style.textContent = `#hint{position:fixed;left:50%;bottom:calc(30 * var(--px, 3px));
    transform:translateX(-50%);padding:6px 12px;background:#00000080;color:#fff;
    font:12px/1.4 ui-monospace,monospace;pointer-events:none;transition:opacity .3s;
    text-align:center;max-width:90vw;z-index:5;white-space:pre-line}`;
  document.head.appendChild(style);

  if (isTouch) {
    // No toque a dica some sozinha; não há pointer lock para servir de sinal.
    setTimeout(() => { hint.style.opacity = '0'; }, 6000);
  } else {
    controls.mouse.onLockChange = (locked) => { hint.style.opacity = locked ? '0' : '1'; };
    /*
     * Quem joga **só de controle** no computador nunca trava o ponteiro, e a
     * dica ficaria na tela para sempre. Com um controle ligado ela some pelo
     * relógio, como no toque — e um pouco mais devagar, porque ela tem uma
     * linha a mais para ler.
     */
    gamepads.onConnect(() => {
      setTimeout(() => {
        if (!controls.mouse.locked) hint.style.opacity = '0';
      }, 9000);
    });
  }
}

function progress(value: number, message: string): void {
  const bar = document.getElementById('boot-bar');
  const msg = document.getElementById('boot-msg');
  if (bar !== null) bar.style.width = `${Math.round(value * 100)}%`;
  if (msg !== null) msg.textContent = message;
}

function hideBootScreen(): void {
  const boot = document.getElementById('boot');
  if (boot === null) return;
  boot.classList.add('hidden');
  setTimeout(() => boot.remove(), 300);
}

function fail(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  const boot = document.getElementById('boot');
  if (boot !== null) {
    boot.classList.remove('hidden');
    boot.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = 'Não foi possível iniciar';
    const p = document.createElement('p');
    p.textContent = msg;
    boot.append(h, p);
  }
  console.error(error);
}

boot().catch(fail);
