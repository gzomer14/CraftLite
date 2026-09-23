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
import { AudioStart } from './audio/audiostart';
import { dyeRgbOf } from './data/tints';
import { blockSound } from './audio/synth';
import { EffectsBar } from './ui/effectsbar';
import { startUiNavLoop } from './input/uinavloop';
import { showHint } from './ui/controlhint';
import { fail, hideBootScreen, progress } from './ui/bootscreen';
import { GameLoop } from './core/loop';
import { registerServiceWorker, showUpdateToast } from './core/pwa';
import { detectTier, presetFor, readDeviceInfo } from './core/tier';
import { DEG2RAD } from './core/math';
import { BLOCK_BY_NAME, defOf, texOf } from './data/blocks';
import { ITEM_BY_NAME, makeStack } from './data/items';
import { MOB_BY_NAME } from './data/mobs';
import { nextObjective, objectiveFor } from './data/achievements';

/** Nome legível do alvo de uma conquista, item ou mob. */
const displayOfTarget = (target: string): string =>
  ITEM_BY_NAME.get(target)?.display ?? MOB_BY_NAME.get(target)?.display ?? target;
import { Player } from './entity/player';
import { SaveGame } from './game/savegame';
import { SettingsStore } from './game/settings';
import { Session } from './game/session';
import { Controls } from './input/controls';
import { Keybinds } from './input/keybinds';
import { Gamepads } from './input/gamepad';
import { UiNavigator } from './input/uinav';
import { Atlas } from './render/atlas';
import { DynamicScale } from './render/dynamicscale';
import { EntityAtlas } from './render/entityatlas';
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
import { MenuFlow, newWorldMeta } from './ui/menuflow';
import { DeathScreen } from './ui/screens/death';
import { SignEditor } from './ui/screens/signeditor';
import { SignTextPass } from './render/signtext';
import { SceneFeed } from './render/scenefeed';
import { Ambience } from './render/ambience';
import { PlayerActions } from './input/playeractions';
import { HudFeed } from './ui/hudfeed';
import { Thumbnail } from './save/thumbnail';
import { Playfield } from './game/playfield';
import { createGameScreens } from './ui/gamescreens';
import { attachLifecycle } from './core/lifecycle';
import { GameFlow } from './ui/gameflow';
import { Hud } from './ui/hud';
import { ScreenMode } from './ui/screenmode';
import { TouchUi } from './ui/touchui';
import { DebugOverlay } from './ui/debug';
import { SEA_LEVEL, type ChunkColumn } from './world/chunk';
import { trySpawn } from './game/spawnplacement';
import { ChunkPipeline, type MeshResult } from './world/pipeline';
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
  const sound = new AudioStart(audio, settings);
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
  const effectsBar = new EffectsBar();
  hud.mount(effectsBar.el);
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

  const { containerScreen, creativeScreen } = createGameScreens({
    atlas, itemSprites, settings,
    session: () => session,
    onCreativeClose: () => { controls.reset(); },
  });
  /*
   * O ponto de renascimento pode estar longe, com a coluna ainda por carregar:
   * a física espera o chão, como no nascimento. Antes a altura saía de um "70"
   * de reserva, e quem renascia numa coluna de árvore nascia dentro do tronco.
   * Sem cama, `trySpawn` assenta o jogador no topo quando a coluna chega; com
   * cama, a posição é exata e só espera o chão existir.
   */
  const respawn = (): void => {
    deathScreen.hide();
    restored = session.respawn(meta.spawn[0], meta.spawn[2]);
    spawned = false;
  };
  const deathScreen = new DeathScreen({ onRespawn: respawn, onQuit: respawn });

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
    /*
     * Escrever numa placa (M8). A sessão só avisa; quem sabe o que é um campo
     * de texto é a UI. Solta o ponteiro pela mesma razão que um baú: com o
     * mouse capturado não há como clicar no campo nem ver o cursor.
     */
    onSignEdit: (x, y, z, lines) => {
      controls.mouse.exitLock();
      signEditor.open(x, y, z, lines);
    },
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
      sound.music?.stop();
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
  const signTextPass = new SignTextPass(ctx);
  renderer.signTextPass = signTextPass;
  renderer.fallingBlocks = session.falling;
  /*
   * Gancho do smoke test (`scripts/smoke.mjs`, doc 14 "Testes obrigatórios").
   * Só existe com `?smoke` na URL: o teste precisa ler o mundo por dentro para
   * conferir que o bloco quebrado continua quebrado depois de recarregar, e o
   * jogo de todo dia não expõe nada.
   */
  if (/[?&]smoke\b/.test(location.search)) {
    (window as unknown as { __craftlite?: unknown }).__craftlite = { world, player, session };
  }
  renderer.blockLightAt = (x, y, z) => (world.getSkyLight(x, y, z) << 4) | world.getBlockLight(x, y, z);
  // Item na mão (doc 01 §191). O passe é uma draw call e limpa a profundidade,
  // então não disputa com nada — mas continua desligável em Opções.
  const handRenderer = new HandRenderer(ctx, atlas, itemSprites.raw);
  handRenderer.enabled = settings.get('handItem');
  renderer.handRenderer = handRenderer;

  // --- persistência (doc 11) ------------------------------------------------
  const thumbnail = new Thumbnail();

  const save = db === null
    ? null
    : new SaveGame(new SaveManager(db, meta.id), session, player, meta, {
      onError: (message) => hud.showMessage(`Falha ao salvar: ${message}`, 120),
      captureThumbnail: () => thumbnail.bytes(),
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

  /*
   * Ponto de nascimento em terra firme (2026-09-22). Era sempre a coluna
   * (0, 0), e metade das seeds põe mar ali. O worker procura — é ele que tem o
   * ruído do terreno — e o resultado fica no meta do mundo, para o
   * renascimento e para a próxima vez.
   */
  if (!restored) {
    if (meta.spawnFound !== true) {
      const [sx, sz] = await pipeline.findSpawn();
      meta.spawn = [sx, 0, sz];
      meta.spawnFound = true;
    }
    player.setPosition(meta.spawn[0] + 0.5, SEA_LEVEL + 30, meta.spawn[2] + 0.5);
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
  const sessionBroken = interaction.onBlockBroken;
  interaction.onBlockBroken = (x, y, z, state) => {
    sessionBroken?.(x, y, z, state);
    const layer = atlas.layerOf(texOf(defOf(state), 'side'));
    atlas.averageColor(layer, particleColor);
    // Lã e cama tingidas: o desenho é cinza, a partícula sai da cor (M13).
    const dye = dyeRgbOf(defOf(state));
    if (dye !== null) for (let c = 0; c < 3; c++) particleColor[c] *= dye[c] / 255;
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
    onToggleFly: () => flow.toggleFly(),
    onPause: () => flow.escape(),
    onInventory: () => flow.toggleInventory(),
    // Largar o item da mão no chão (doc 08 §3.5). O `onDrop` do inventário já
    // vai parar na `Session`, que cria a entidade com o arremesso.
    onDropItem: (whole) => { inventory.dropSelected(whole); },
  }, keybinds, gamepads);

  hud.onSlotSelected = (index) => inventory.select(index);
  hud.spriteOf = (item) => itemSprites.position(item);
  inventory.onChange = () => containerScreen.refresh();

  const flow = new GameFlow({
    player, session, controls, hud, containerScreen, creativeScreen,
    touchUi: () => touchUi,
    openOptions: (back) => menu.openOptions(back),
    saveAll: async () => { await save?.saveAll(); },
  });
  const pauseMenu = flow.pauseMenu;

  const signEditor = new SignEditor({
    onDone: (x, y, z, lines) => {
      session.writeSign(x, y, z, lines);
      audio.playUi('ui/click', 0.5);
    },
    onClose: () => { /* o jogo continua rodando: a placa não pausa nada */ },
  });

  const touchUi = new TouchUi(settings, controls.touch.buttons, {
    onPause: () => flow.togglePause(),
    onInventory: () => flow.toggleInventory(),
    onFlyToggle: () => flow.toggleFly(),
    onBreakDown: (down) => { actions.modeBBreaking = down; },
    onPlace: () => { actions.modeBPlace = true; },
  });
  touchUi.setVisible(isTouchDevice);
  flow.applyGameMode();

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
    if (!sound.started) {
      hud.showMessage('Toque na tela ou aperte uma tecla uma vez para ligar o som.', 120);
    }
  });
  audio.onSubtitle = (text, direction) => hud.showSubtitle(text, direction);
  // Primeiro toque: tela cheia + trava de orientação (precisa de gesto).
  controls.touch.onFirstTouch = () => screenMode.enter();

  showHint(controls, isTouchDevice, gamepads);

  const hudFeed = new HudFeed({
    hud, effectsBar, touchUi: isTouchDevice ? touchUi : null, debug, session, controls, settings,
    renderer, pipeline, audio,
  });

  const actions = new PlayerActions(controls, session, renderer.camera, handRenderer);
  const ambience = new Ambience(renderer, session, audio, settings, preset.rainDrops);
  const sceneFeed = new SceneFeed({
    renderer, mobRenderer, itemRenderer, signTextPass, entityAtlas, atlas, world, session, player,
    shadows: () => preset.entityShadows && settings.get('entityShadows'),
  });

  /** Espera o terreno existir antes de soltar o jogador na gravidade. */
  let spawned = false;
  /** Três dedos abrem o debug (doc 02 §6) — dispara uma vez por gesto. */
  let threeFingerArmed = true;

  // Callbacks do laço criados uma vez: uma closure nova por quadro é lixo
  // para o coletor no caminho quente (PROMPT.md §6).
  const applyMesh = (result: MeshResult): void => { renderer.chunks.apply(result); };
  const applyLook = (yawDelta: number, pitchDelta: number): void => {
    // Pausado, o movimento é **consumido e jogado fora**: guardá-lo faria a
    // câmera saltar tudo de uma vez ao voltar ao jogo.
    if (flow.paused) return;
    Controls.applyLookTo(player, yawDelta, pitchDelta);
  };

  const loop = new GameLoop({
    tick() {
      controls.update();

      if (controls.touch.fingerCount >= 3) {
        if (threeFingerArmed) { debug.toggle(); threeFingerArmed = false; }
      } else if (controls.touch.fingerCount === 0) {
        threeFingerArmed = true;
      }

      if (flow.paused) return;

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
      } else if (session.vehicles.isRiding) {
        // Pilotando: o veículo é que anda, e o jogador vai junto (M6/M7).
        session.vehicles.drive(controls.state.forward);
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
        actions.idle();
        return;
      }
      actions.tick();
      ambience.tick();
      save?.tick();
      // Uma foto nova a cada 30 s, para a tela de seleção mostrar o mundo como
      // ele está e não como estava na primeira vez que foi salvo.
      if (loop.stats.tick % 600 === 0) thumbnail.pending = true;
      sound.music?.tick();
      hud.tick();

      pipeline.setCenter(player.x, player.z);
      pipeline.enqueueDirty();
      pipeline.pump();
    },
    pump(budgetMs) {
      pipeline.drainReady(budgetMs, applyMesh);
    },
    render(alpha) {
      /*
       * A câmera é lida **aqui**, e não no tick.
       *
       * `camera.yaw` recebe `player.yaw` direto, sem interpolação — girar a
       * 20 Hz num display de 60 Hz repetiria o mesmo ângulo por três quadros e
       * depois pularia. Ver o comentário de `Controls.updateLook`.
       */
      controls.updateLook(loop.stats.frameMs, applyLook);

      const camera = renderer.camera;
      camera.prevX = player.prevX;
      camera.prevY = player.prevY + player.eyeHeight;
      camera.prevZ = player.prevZ;
      camera.x = player.x;
      camera.y = player.y + player.eyeHeight;
      camera.z = player.z;
      camera.prevYaw = player.yaw; camera.yaw = player.yaw;
      camera.prevPitch = player.pitch; camera.pitch = player.pitch;

      sceneFeed.frame(alpha, flow.paused, dayNight.dayFactor);

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
      if (sound.music !== null) {
        sound.music.mood = player.y < SEA_LEVEL - 6 ? 'underground' : 'surface';
      }
      renderer.render(alpha);
      // Ainda no mesmo quadro: depois disto o navegador descarta o backbuffer.
      thumbnail.grab(canvas);

      if (settings.get('dynamicResolution')) {
        // Enquanto há chunk na fila, o frame time mede carregamento, não o
        // custo de desenhar — medir aí faria a escala oscilar e piscar a tela.
        const loading = pipeline.stats.queued > 0 || pipeline.stats.meshing > 0;
        const nextScale = dynamicScale.update(loop.stats.frameMs, renderer.renderScale, loading);
        if (nextScale !== renderer.renderScale) renderer.setRenderScale(nextScale);
      }

      hudFeed.frame(loop);
    },
  });
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

  const playfield = new Playfield({
    settings, preset, pipeline, renderer, debug, player, hud, session, gamepads,
    touchAimMode: isTouchDevice,
  });
  playfield.apply();
  refreshObjective();
  settings.onChange((next) => {
    loop.maxFps = next.maxFps;
    sound.applyVolumes();
    audio.subtitlesEnabled = next.subtitles;
    session.survival.difficulty = next.difficulty as 0 | 1 | 2 | 3;
    if (sound.music !== null) sound.music.enabled = next.musicVolume > 0;
    handRenderer.enabled = next.handItem;
    playfield.apply();
  });

  attachLifecycle({
    canvas, loop, resize: () => renderer.resize(), resetInput: () => controls.reset(), audio, save,
  });

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

boot().catch(fail);
