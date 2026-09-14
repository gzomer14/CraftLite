/**
 * Perfis de controle e o mapa de botões (doc 09 §3).
 *
 * A Gamepad API já resolve **quase** tudo: quando o navegador reconhece o
 * aparelho, ele reporta `mapping: 'standard'` e os índices são os mesmos para
 * DualSense, Xbox e qualquer outro — é o layout que a especificação desenha.
 * Esse é o caminho normal no Chrome e no Firefox, no computador e no Android,
 * e é por isso que **a maior parte deste arquivo não é sobre mapeamento**.
 *
 * O que muda de verdade entre um DualSense e um Xbox é o **nome do botão**. O
 * jogo que diz "aperte A para colocar" para quem está segurando um controle de
 * PlayStation está mentindo, e o jogador vai procurar um botão que não existe.
 * Por isso todo perfil traz os rótulos das teclas que a interface cita.
 *
 * O segundo papel é a **rede de segurança**: quando o navegador **não**
 * reconhece o aparelho (`mapping` vazio), os índices viram a ordem crua do
 * relatório HID, que é diferente por família. Aí o perfil empresta a ordem
 * conhecida da família. Isso acontece com o DualSense em Bluetooth em alguns
 * sistemas e em WebView antigo de Android.
 *
 * **Acrescentar um controle é uma entrada nesta tabela.** Nenhum `if` novo em
 * `input/gamepad.ts`.
 *
 * ## Botão e intenção são duas coisas
 *
 * Até 2026-09-14 este arquivo tinha uma tabela só, e os nomes dela eram os da
 * **ação** (`place: 2`). Parecia econômico e escondia uma armadilha: mudar o
 * que o □ faz obrigava a mexer no índice, e o índice é do aparelho, não do
 * jogo. Agora são duas tabelas — `STANDARD_BUTTONS` diz **onde o botão fica**
 * e `PAD_BINDINGS` diz **o que ele faz**. Remapear é uma linha na segunda.
 */

/**
 * Os botões de um controle, **pela posição**. Nenhum destes nomes carrega o
 * que o botão faz no jogo: `faceLeft` é o □ do DualSense e o X do Xbox, e o
 * que ele dispara é assunto de `PAD_BINDINGS`.
 *
 * A lista descreve o layout inteiro da especificação, e não só o que o jogo
 * usa: `r3` e `home` não têm função nenhuma e estão aqui de propósito, para
 * que a tabela de um controle não normalizado possa declarar onde eles ficam —
 * sem isso, o índice deles cairia em cima de outro botão.
 */
export type PadButton =
  | 'faceDown' | 'faceRight' | 'faceLeft' | 'faceUp'
  | 'l1' | 'r1' | 'l2' | 'r2'
  | 'select' | 'start'
  | 'l3' | 'r3'
  | 'dpadUp' | 'dpadDown' | 'dpadLeft' | 'dpadRight'
  | 'home';

/**
 * Índices do **layout padrão** da especificação da Gamepad API.
 *
 * É a fonte da verdade quando `mapping === 'standard'`, que é o caso comum.
 */
export const STANDARD_BUTTONS: Readonly<Record<PadButton, number>> = {
  faceDown: 0,   // A · ✕
  faceRight: 1,  // B · ○
  faceLeft: 2,   // X · □
  faceUp: 3,     // Y · △
  l1: 4,         // LB · L1
  r1: 5,         // RB · R1
  l2: 6,         // LT · L2
  r2: 7,         // RT · R2
  select: 8,     // Select/View · Create/Share
  start: 9,      // Start/Menu · Options
  l3: 10,
  r3: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  home: 16,      // Guide · PS
};

/** Eixos do layout padrão: analógico esquerdo e direito. */
export const STANDARD_AXES = { moveX: 0, moveY: 1, lookX: 2, lookY: 3 } as const;

/**
 * O que o jogo pede de um controle. Cada intenção lista os botões que a
 * disparam — mais de um quando há dois caminhos naturais para a mesma coisa.
 */
export type PadIntent =
  | 'jump' | 'sneak' | 'sprint'
  | 'place' | 'break' | 'drop'
  | 'hotbarPrev' | 'hotbarNext'
  | 'inventory' | 'pause'
  | 'navUp' | 'navDown' | 'navLeft' | 'navRight'
  | 'navConfirm' | 'navCancel' | 'navSecondary';

/**
 * De botão para ação. **Esta é a tabela que se edita para remapear.**
 *
 * Três escolhas que valem a explicação:
 *
 * 1. **Colocar é o gatilho esquerdo, quebrar é o direito.** É o par que todo
 *    jogo de bloco usa, e libera as quatro faces para outra coisa. Até
 *    2026-09-14 o □ também colocava, duplicando o L2 — e era a única coisa que
 *    ele fazia, o que deixava a mochila sem botão de face nenhum.
 * 2. **□ abre o inventário**, junto com o Create/View. Pedido de campo
 *    (2026-09-14): o botão de face é onde a mão procura, e o Create do
 *    DualSense é pequeno e mal colocado para uma ação usada o tempo todo.
 * 3. **Nos menus, o gatilho esquerdo é o botão direito do mouse.** Fora dos
 *    menus L2 coloca e R2 quebra; dentro deles R2 e ✕ valem clique esquerdo e
 *    L2 vale clique direito. É a mesma mão fazendo a mesma coisa nos dois
 *    lados — sem isso não havia como pegar meia pilha ou soltar um item de
 *    cada vez com o controle.
 * 4. **O direcional também troca o item da mão**, junto com L1/R1. Fora dos
 *    menus ele não tinha função nenhuma, e um relato de campo (2026-09-14) diz
 *    que L1/R1 não trocam item num DualSense por Bluetooth — o que este código
 *    não explica, já que os dois estão nos índices 4 e 5 do layout padrão.
 *    Enquanto o teste de controle em Opções não disser o que o aparelho manda
 *    de verdade, o direcional é o caminho que com certeza existe. Com uma tela
 *    aberta ele volta a ser navegação: `uiCapture` zera a hotbar.
 */
export const PAD_BINDINGS: Readonly<Record<PadIntent, readonly PadButton[]>> = {
  jump: ['faceDown'],
  sneak: ['faceRight'],
  sprint: ['l3'],
  place: ['l2'],
  break: ['r2'],
  drop: ['faceUp'],
  hotbarPrev: ['l1', 'dpadLeft'],
  hotbarNext: ['r1', 'dpadRight'],
  inventory: ['faceLeft', 'select'],
  pause: ['start'],
  navUp: ['dpadUp'],
  navDown: ['dpadDown'],
  navLeft: ['dpadLeft'],
  navRight: ['dpadRight'],
  navConfirm: ['faceDown', 'r2'],
  navCancel: ['faceRight'],
  navSecondary: ['l2'],
};

/** Rótulos que a interface mostra, na mesma chave posicional do botão. */
export interface PadLabels extends Readonly<Record<PadButton, string>> {
  /** Nome da família, para a tela de opções dizer o que foi reconhecido. */
  family: string;
}

export interface PadProfile {
  id: string;
  labels: PadLabels;
  /**
   * Índices de botão quando o navegador **não** normaliza (`mapping` vazio).
   * Ausente = usa os índices padrão mesmo assim, que é o melhor palpite.
   */
  rawButtons?: Partial<Record<PadButton, number>>;
  /** Eixos quando o navegador não normaliza. */
  rawAxes?: Partial<typeof STANDARD_AXES>;
  /**
   * Casa com `Gamepad.id`. O id varia por navegador — o Chrome escreve
   * `... (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)` e o Firefox escreve
   * `054c-0ce6-DualSense Wireless Controller` —, então a regra procura o par
   * fabricante/produto **ou** o nome, em qualquer lugar da string.
   */
  match: RegExp;
}

/**
 * Ordem crua de um controle de PlayStation quando o navegador não normaliza.
 *
 * É o relatório HID da Sony: as quatro faces vêm na ordem □ ✕ ○ △, e não na
 * ordem da especificação. Sem esta tabela, um DualSense não reconhecido pularia
 * ao apertar □ — e abriria o inventário no ✕.
 *
 * **Não foi verificado em aparelho**: o caminho normal é o padronizado, e este
 * é a rede de segurança. Ver doc 15 §6.
 */
const PLAYSTATION_RAW: Partial<Record<PadButton, number>> = {
  faceLeft: 0,   // □
  faceDown: 1,   // ✕
  faceRight: 2,  // ○
  faceUp: 3,     // △
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  select: 8,     // Share/Create
  start: 9,      // Options
  l3: 10,
  r3: 11,
  home: 12,      // PS
};

/** Direcional e botões sem nome impresso: iguais em todas as famílias. */
const SHARED_LABELS = {
  l3: 'L3', r3: 'R3',
  dpadUp: '↑', dpadDown: '↓', dpadLeft: '←', dpadRight: '→',
  home: 'Home',
} as const;

const PLAYSTATION_LABELS = {
  ...SHARED_LABELS,
  faceDown: '✕', faceRight: '○', faceLeft: '□', faceUp: '△',
  l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2',
  start: 'Options', select: 'Create',
} as const;

const XBOX_LABELS = {
  ...SHARED_LABELS,
  faceDown: 'A', faceRight: 'B', faceLeft: 'X', faceUp: 'Y',
  l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT',
  start: 'Menu', select: 'View',
} as const;

/**
 * Perfis conhecidos, na ordem em que são testados — o específico antes do
 * genérico.
 */
export const PAD_PROFILES: readonly PadProfile[] = [
  {
    id: 'dualsense',
    labels: { ...PLAYSTATION_LABELS, family: 'DualSense (PS5)' },
    rawButtons: PLAYSTATION_RAW,
    // 0ce6 é o DualSense; 0df2 é o DualSense Edge.
    match: /0ce6|0df2|dualsense/i,
  },
  {
    id: 'dualshock4',
    labels: { ...PLAYSTATION_LABELS, family: 'DualShock 4 (PS4)', select: 'Share' },
    rawButtons: PLAYSTATION_RAW,
    /*
     * 05c4 é a primeira revisão; 09cc é a segunda.
     *
     * **Sem "wireless controller" na regra**, por mais que seja o nome que o
     * DS4 reporta em alguns sistemas: o Xbox reporta "Xbox Wireless
     * Controller" e cairia aqui, ganhando rótulos de PlayStation. Vale o par
     * fabricante/produto, que é o que não é ambíguo.
     */
    match: /05c4|09cc|dualshock/i,
  },
  {
    id: 'xbox',
    labels: { ...XBOX_LABELS, family: 'Xbox' },
    // 02ea/02fd são o Xbox One S; 0b12/0b13 são o Series X|S; 028e é o 360.
    // O nome cobre o resto: o Chrome escreve "Xbox" no id de todos eles.
    match: /02ea|02fd|0b12|0b13|028e|xbox|xinput/i,
  },
  {
    id: 'switch',
    labels: {
      ...SHARED_LABELS,
      // O A/B e o X/Y do Switch são espelhados em relação ao Xbox, **mas** o
      // navegador já entrega a posição, não a letra: o botão de baixo continua
      // sendo o índice 0. O que muda é só o nome impresso nele.
      faceDown: 'B', faceRight: 'A', faceLeft: 'Y', faceUp: 'X',
      l1: 'L', r1: 'R', l2: 'ZL', r2: 'ZR',
      start: '+', select: '−',
      family: 'Nintendo Switch Pro',
    },
    match: /057e|switch pro|joy-con/i,
  },
];

/**
 * Perfil genérico: os rótulos da especificação. É o que vale para um controle
 * que não está na tabela — e ele continua **jogável**, porque o layout padrão
 * já resolve o mapeamento.
 *
 * O `match` nunca casa com nada de propósito: ele é alcançado por queda, não
 * por busca, e `profileFor` nem chega a testá-lo.
 */
export const GENERIC_PROFILE: PadProfile = {
  id: 'generic',
  labels: {
    ...SHARED_LABELS,
    faceDown: 'A', faceRight: 'B', faceLeft: 'X', faceUp: 'Y',
    l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT',
    start: 'Start', select: 'Select',
    family: 'Controle genérico',
  },
  match: /.^/,
};

/** Perfil de um `Gamepad.id`. Nunca devolve nulo: sem perfil, o genérico. */
export function profileFor(id: string): PadProfile {
  for (const profile of PAD_PROFILES) {
    if (profile.match.test(id)) return profile;
  }
  return GENERIC_PROFILE;
}

/** Perfil por identificador, para a opção de forçar um layout. */
export function profileById(id: string): PadProfile | null {
  if (id === GENERIC_PROFILE.id) return GENERIC_PROFILE;
  return PAD_PROFILES.find((p) => p.id === id) ?? null;
}
