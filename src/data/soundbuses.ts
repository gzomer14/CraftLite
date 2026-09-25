/**
 * Roteamento de som para barramento (doc 08 §3.11 e doc 10 §1).
 *
 * O doc 08 pede **nove sliders** de volume — Principal, Música, Blocos, Mobs
 * Hostis, Mobs Amigáveis, Jogadores, Ambiente, Clima e Interface —, e o doc 10
 * §1 desenhou cinco barramentos. A diferença não é contradição: o doc 10
 * descreve o **grafo de áudio** (quantos `GainNode` pendurados no master) e o
 * doc 08 descreve o **controle**. Aqui os dois se encontram: o grafo ganhou os
 * barramentos que faltavam e cada som sabe em qual entra.
 *
 * O roteamento é tabela, não `if`: acrescentar um som é uma linha em
 * `audio/synth.ts` e, se ele não cair em nenhum prefixo, uma linha aqui.
 */

import { MOBS } from './mobs';
import { t } from '../core/i18n';

/** Barramentos do grafo. `master` não é barramento: é o ganho de saída. */
export type Bus =
  | 'music' | 'block' | 'hostile' | 'friendly' | 'player' | 'ambient' | 'weather' | 'ui';

export const BUSES: readonly Bus[] = [
  'music', 'block', 'hostile', 'friendly', 'player', 'ambient', 'weather', 'ui',
];

/** Rótulo de cada barramento na tela de opções, na ordem do doc 08. */
export const BUS_LABELS: Readonly<Record<Bus, string>> = {
  music: t('bus.music'),
  block: t('bus.block'),
  hostile: t('bus.hostile'),
  friendly: t('bus.friendly'),
  player: t('bus.player'),
  ambient: t('bus.ambient'),
  weather: t('bus.weather'),
  ui: t('bus.ui'),
};

/**
 * Chave de `Settings` que controla cada barramento.
 *
 * Fica aqui, ao lado da lista de barramentos, para que acrescentar um
 * barramento sem o slider correspondente não compile.
 */
export const BUS_SETTING = {
  music: 'musicVolume',
  block: 'blockVolume',
  hostile: 'hostileVolume',
  friendly: 'friendlyVolume',
  player: 'playerVolume',
  ambient: 'ambientVolume',
  weather: 'weatherVolume',
  ui: 'uiVolume',
} as const satisfies Record<Bus, string>;

/**
 * Prefixo de nome de som → barramento.
 *
 * A ordem importa: o primeiro prefixo que casa vence, então o específico vem
 * antes do genérico.
 */
const BY_PREFIX: readonly (readonly [string, Bus])[] = [
  ['step/', 'block'],
  ['break/', 'block'],
  ['place/', 'block'],
  ['weather/', 'weather'],
  ['ui/', 'ui'],
  ['player/', 'player'],
  ['block/', 'block'],
];

/**
 * Sons de bloco que são, na verdade, ambiente.
 *
 * A fornalha crepitando e o portal zunindo tocam **sozinhos, em loop**, sem
 * ninguém ter acabado de mexer no bloco — é ruído de fundo do lugar, e é isso
 * que o slider "Ambiente" do doc 08 controla. Sem esta exceção o barramento
 * nasceria vazio, e um controle que não controla nada é pior que não tê-lo.
 */
const AMBIENT_SOUNDS: readonly string[] = ['block/furnace', 'block/portal'];

/**
 * Voz de mob → barramento, derivado da categoria da tabela de mobs.
 *
 * Hostil é hostil; passivo, neutro, aquático e ambiente vão todos para
 * "amigáveis". O jogador que baixa "Mobs Hostis" quer parar de ouvir o zumbi na
 * caverna, não a vaca do curral — e o lobo, que é neutro, é da casa.
 *
 * Mobs que **dividem a voz** (o porco zumbi usa a do zumbi) ficam com a
 * categoria do primeiro da tabela, que é o dono original do som.
 */
const BY_VOICE: ReadonlyMap<string, Bus> = buildVoiceMap();

function buildVoiceMap(): Map<string, Bus> {
  const out = new Map<string, Bus>();
  for (const mob of MOBS) {
    if (out.has(mob.sound)) continue;
    out.set(mob.sound, mob.category === 'hostile' ? 'hostile' : 'friendly');
  }
  return out;
}

/**
 * Barramento de um som pelo nome. Nome desconhecido cai em `block`, que é o
 * barramento de tudo que acontece no mundo.
 */
export function busFor(name: string): Bus {
  if (AMBIENT_SOUNDS.includes(name)) return 'ambient';
  if (name.startsWith('mob/')) {
    // `mob/<voz>_<tipo>`: a voz é o que está entre a barra e o último `_`.
    const rest = name.slice(4);
    const underscore = rest.lastIndexOf('_');
    const voice = underscore < 0 ? rest : rest.slice(0, underscore);
    return BY_VOICE.get(voice) ?? 'hostile';
  }
  for (const [prefix, bus] of BY_PREFIX) {
    if (name.startsWith(prefix)) return bus;
  }
  return 'block';
}
