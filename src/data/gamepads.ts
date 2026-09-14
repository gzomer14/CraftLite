/**
 * Perfis de controle (doc 09 §3).
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
 * Por isso todo perfil traz os rótulos das oito teclas que a interface cita.
 *
 * O segundo papel é a **rede de segurança**: quando o navegador **não**
 * reconhece o aparelho (`mapping` vazio), os índices viram a ordem crua do
 * relatório HID, que é diferente por família. Aí o perfil empresta a ordem
 * conhecida da família. Isso acontece com o DualSense em Bluetooth em alguns
 * sistemas e em WebView antigo de Android.
 *
 * **Acrescentar um controle é uma entrada nesta tabela.** Nenhum `if` novo em
 * `input/gamepad.ts`.
 */

/**
 * Ações que o jogo lê de um controle. A ordem é a do doc 09 §3.
 *
 * A lista descreve o **layout inteiro** da especificação, e não só o que o
 * jogo usa hoje: `zoom` (R3) e `home` não têm função nenhuma e estão aqui de
 * propósito, para que a tabela de um controle não normalizado possa declarar
 * onde eles ficam — sem isso, o índice deles cairia em cima de outra ação.
 */
export type PadAction =
  | 'jump' | 'sneak' | 'place' | 'drop'
  | 'hotbarPrev' | 'hotbarNext'
  | 'use' | 'break'
  | 'select' | 'start'
  | 'sprint' | 'zoom'
  | 'dpadUp' | 'dpadDown' | 'dpadLeft' | 'dpadRight'
  | 'home';

/**
 * Índices do **layout padrão** da especificação da Gamepad API.
 *
 * É a fonte da verdade quando `mapping === 'standard'`, que é o caso comum.
 * Os nomes dos campos são os da ação, não os do botão: `jump` é o botão de
 * baixo, seja ele `A` ou `✕`.
 */
export const STANDARD_BUTTONS: Readonly<Record<PadAction, number>> = {
  jump: 0,        // A · ✕
  sneak: 1,       // B · ○
  place: 2,       // X · □
  drop: 3,        // Y · △
  hotbarPrev: 4,  // LB · L1
  hotbarNext: 5,  // RB · R1
  use: 6,         // LT · L2
  break: 7,       // RT · R2
  select: 8,      // Select/View · Share/Create
  start: 9,       // Start/Menu · Options
  sprint: 10,     // L3
  zoom: 11,       // R3
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  home: 16,       // Guide · PS
};

/** Eixos do layout padrão: analógico esquerdo e direito. */
export const STANDARD_AXES = { moveX: 0, moveY: 1, lookX: 2, lookY: 3 } as const;

/** Rótulos que a interface mostra. As chaves são as ações citadas em texto. */
export interface PadLabels {
  jump: string;
  sneak: string;
  place: string;
  drop: string;
  use: string;
  break: string;
  start: string;
  select: string;
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
  rawButtons?: Partial<Record<PadAction, number>>;
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
 * ao apertar ✕ — que por acaso está certo — mas colocaria bloco no △.
 *
 * **Não foi verificado em aparelho**: o caminho normal é o padronizado, e este
 * é a rede de segurança. Ver doc 15 §6.
 */
const PLAYSTATION_RAW: Partial<Record<PadAction, number>> = {
  place: 0,       // □
  jump: 1,        // ✕
  sneak: 2,       // ○
  drop: 3,        // △
  hotbarPrev: 4,  // L1
  hotbarNext: 5,  // R1
  use: 6,         // L2
  break: 7,       // R2
  select: 8,      // Share/Create
  start: 9,       // Options
  sprint: 10,     // L3
  zoom: 11,       // R3
  home: 12,       // PS
};

const PLAYSTATION_LABELS = {
  jump: '✕', sneak: '○', place: '□', drop: '△',
  use: 'L2', break: 'R2', start: 'Options', select: 'Create',
} as const;

const XBOX_LABELS = {
  jump: 'A', sneak: 'B', place: 'X', drop: 'Y',
  use: 'LT', break: 'RT', start: 'Menu', select: 'View',
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
      // O A/B e o X/Y do Switch são espelhados em relação ao Xbox, **mas** o
      // navegador já entrega a posição, não a letra: o botão de baixo continua
      // sendo o índice 0. O que muda é só o nome impresso nele.
      jump: 'B', sneak: 'A', place: 'Y', drop: 'X',
      use: 'ZL', break: 'ZR', start: '+', select: '−',
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
    jump: 'A', sneak: 'B', place: 'X', drop: 'Y',
    use: 'LT', break: 'RT', start: 'Start', select: 'Select',
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
