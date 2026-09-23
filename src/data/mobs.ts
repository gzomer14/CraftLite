/**
 * Tabela declarativa de mobs (doc 07 §1–§2).
 *
 * **Os ids são estáveis e vão para o save — nunca reordene esta tabela.**
 *
 * A IA é declarada como uma lista de `goals` em ordem de prioridade: o primeiro
 * goal que "pega" o mob no tick manda, e os outros não rodam. Adicionar um
 * comportamento novo é acrescentar um nome aqui e a função correspondente em
 * `entity/ai/goals.ts` — nunca um `case` novo em um `switch` de tipo de mob.
 */

import type { Drop } from './loot';

export type MobCategory = 'passive' | 'neutral' | 'hostile' | 'ambient' | 'water';

/** Nome de um goal de IA. A ordem na lista do mob é a prioridade. */
export type GoalName =
  | 'floatInWater'
  | 'panic'
  | 'explode'
  | 'shoot'
  | 'attackMelee'
  | 'breakDoor'
  | 'leapAtTarget'
  | 'moveToTarget'
  | 'avoidSunlight'
  | 'followItem'
  | 'followOwner'
  | 'breed'
  | 'wander'
  | 'lookAtPlayer'
  // --- aldeia (M9, `entity/ai/villagegoals.ts`) ---
  | 'trade'
  | 'avoidHostile'
  | 'goHome'
  | 'work'
  | 'stayInVillage'
  | 'patrol'
  | 'defendVillage';

/** Traços que o motor consulta direto, sem passar por goal. */
export interface MobTraits {
  /** Pega fogo com luz do céu 15 de dia (zumbi, esqueleto). */
  burnsInSunlight?: boolean;
  fireImmune?: boolean;
  /** Sobe parede quando o horizontal trava (aranha). */
  climbsWalls?: boolean;
  /** Cai devagar, sem dano de queda (galinha). */
  glides?: boolean;
  /** Nada livremente em vez de andar no chão (lula). */
  swims?: boolean;
  /** Voa: sem gravidade, e o destino de movimento inclui o Y (ghast). */
  flies?: boolean;
  /** Atira bola de fogo em vez de flecha (ghast). */
  shootsFireball?: boolean;
  /**
   * Escala do modelo **e** da hitbox, como o slime já fazia por tamanho.
   *
   * É o que deixa o ghast ter 4 blocos sem um modelo de 64 px: `width` e
   * `height` da tabela são os do modelo base, e a escala multiplica os dois.
   */
  modelScale?: number;

  /** Fica hostil só depois de provocado (lobo, enderman, aranha na luz). */
  neutralUntilProvoked?: boolean;
  /** Chama os da mesma espécie por perto ao ser atacado (lobo). */
  callsForHelp?: boolean;
  /** Teleporta ao levar dano (enderman). */
  teleportsOnDamage?: boolean;
  /** Divide-se em dois menores ao morrer (slime). */
  splitsOnDeath?: boolean;
  /** Item que faz o mob seguir o jogador (goal `followItem`). */
  temptItem?: string;
  /** Item que coloca o mob no amor e apressa o filhote (goal `breed`). */
  breedItem?: string;
  /** Item que doma o mob, com a chance de sucesso (lobo). */
  tameItem?: string;
  tameChance?: number;

  // --- produtos (2026-09-22, ver `entity/husbandry.ts`) ----------------------
  /**
   * Tem lã de cor (ovelha, doc 07 §1): nasce com uma cor, dá lã dela ao morrer
   * e à tesoura, se tinge com corante e volta a ter lã comendo grama.
   */
  woolly?: boolean;
  /** Põe um item de tempos em tempos (galinha, doc 07 §1: ovo a cada 5–10 min). */
  lays?: { item: string; minTicks: number; maxTicks: number };
  /** Dá leite no balde (vaca). */
  milkable?: boolean;
  /** Pega e põe blocos do chão (enderman, doc 07 §1). */
  carriesBlocks?: boolean;
  /**
   * Uma pele por `variant` (M9): a profissão do aldeão. Índice fora da lista
   * usa a pele base do mob.
   */
  variantSkins?: readonly string[];
}

export interface SpawnRule {
  /** `dark`: luz de bloco 0 e (céu ≤ 7 ou noite). `bright`: luz do céu ≥ 9. */
  light: 'dark' | 'bright' | 'any';
  /** Nomes de bloco aceitos como chão. Vazio = qualquer bloco sólido. */
  ground: readonly string[];
  /** Nasce dentro de água em vez de sobre um chão sólido. */
  inWater?: boolean;
  minY: number;
  maxY: number;
  /** Biomas permitidos por nome; vazio = todos. */
  biomes: readonly string[];
  /** Tamanho do grupo sorteado. */
  packMin: number;
  packMax: number;
  /** Peso relativo no sorteio da categoria. */
  weight: number;
  /** Só nasce de noite (slime no pântano). */
  nightOnly?: boolean;
  /**
   * Dimensão em que a regra vale (`DIM_*`). Ausente = superfície.
   * É o que mantém o zumbi fora do Nether e o ghast fora da superfície.
   */
  dimension?: number;
}

export interface MobAttack {
  /** Dano por dificuldade: [fácil, normal, difícil]. */
  damage: readonly [number, number, number];
  reach: number;
  cooldownTicks: number;
}

export interface MobDef {
  id: number;
  name: string;
  display: string;
  category: MobCategory;
  health: number;
  width: number;
  height: number;
  /** Blocos por segundo caminhando. */
  /**
   * Velocidade em **blocos/s** ao caminhar, na mesma régua do jogador, que
   * anda a 4,317 e corre a 5,612 (doc 06 §2). Hostil fica entre os dois: não
   * dá para escapar caminhando, dá correndo.
   */
  speed: number;
  attack?: MobAttack;
  /** Raio de detecção do jogador, em blocos. */
  followRange: number;
  drops: readonly Drop[];
  /** XP solto ao morrer: [min, max]. */
  xp: readonly [number, number];
  goals: readonly GoalName[];
  /** Geometria em `data/mobmodels.ts`. */
  model: string;
  /** Skin procedural em `data/mobskins.ts`. */
  skin: string;
  /** Prefixo dos sons: `mob/<sound>_ambient`, `_hurt`, `_death`. */
  sound: string;
  /** Hostis somem longe do jogador; passivos não. */
  despawnable: boolean;
  traits: MobTraits;
}

type MobSpec = Omit<MobDef, 'traits' | 'spawn'> & { traits?: MobTraits };

/** Regra de spawn por mob, separada da definição para caber na tela. */
export const SPAWN_RULES: Record<string, SpawnRule> = {
  cow: { light: 'bright', ground: ['grass_block'], minY: 60, maxY: 110, biomes: ['plains', 'forest', 'taiga', 'savanna'], packMin: 2, packMax: 4, weight: 8 },
  pig: { light: 'bright', ground: ['grass_block'], minY: 60, maxY: 110, biomes: ['plains', 'forest', 'swamp'], packMin: 2, packMax: 4, weight: 8 },
  sheep: { light: 'bright', ground: ['grass_block'], minY: 60, maxY: 120, biomes: ['plains', 'forest', 'mountains', 'snowy_plains'], packMin: 2, packMax: 3, weight: 8 },
  chicken: { light: 'bright', ground: ['grass_block'], minY: 60, maxY: 110, biomes: ['plains', 'forest', 'swamp', 'savanna'], packMin: 4, packMax: 4, weight: 6 },
  squid: { light: 'any', ground: [], inWater: true, minY: 45, maxY: 62, biomes: [], packMin: 1, packMax: 3, weight: 6 },
  wolf: { light: 'bright', ground: ['grass_block', 'podzol', 'snow_block'], minY: 60, maxY: 120, biomes: ['taiga', 'forest'], packMin: 2, packMax: 4, weight: 4 },
  enderman: { light: 'dark', ground: [], minY: 0, maxY: 127, biomes: [], packMin: 1, packMax: 1, weight: 2 },
  spider: { light: 'dark', ground: [], minY: 0, maxY: 127, biomes: [], packMin: 1, packMax: 2, weight: 8 },
  zombie: { light: 'dark', ground: [], minY: 0, maxY: 127, biomes: [], packMin: 3, packMax: 4, weight: 12 },
  skeleton: { light: 'dark', ground: [], minY: 0, maxY: 127, biomes: [], packMin: 1, packMax: 3, weight: 10 },
  creeper: { light: 'dark', ground: [], minY: 0, maxY: 127, biomes: [], packMin: 1, packMax: 2, weight: 8 },
  slime: { light: 'any', ground: [], minY: 0, maxY: 40, biomes: [], packMin: 1, packMax: 3, weight: 4, nightOnly: false },
  /*
   * Morcego: a única regra da categoria `ambient`, que tinha cap no spawner
   * desde o M5 e nenhum mob atrás dela. Nasce no escuro e abaixo do nível do
   * mar — ele é o que diz "você está numa caverna" antes de o zumbi dizer.
   */
  bat: { light: 'dark', ground: [], minY: 0, maxY: 58, biomes: [], packMin: 1, packMax: 2, weight: 10 },

  // --- Nether (M7): luz não filtra nada aqui, porque lá tudo é escuro ------
  zombified_piglin: { light: 'any', ground: ['netherrack', 'soul_sand', 'nether_bricks'], minY: 32, maxY: 120, biomes: [], packMin: 2, packMax: 4, weight: 12, dimension: 1 },
  ghast: { light: 'any', ground: ['netherrack', 'soul_sand'], minY: 40, maxY: 110, biomes: [], packMin: 1, packMax: 1, weight: 4, dimension: 1 },
};

/**
 * Comportamento padrão de um hostil corpo-a-corpo (doc 07 §2).
 * A ordem é a prioridade: não afogar vence atacar, que vence perseguir.
 */
const HOSTILE_GOALS: readonly GoalName[] = [
  'floatInWater', 'attackMelee', 'moveToTarget', 'avoidSunlight', 'wander', 'lookAtPlayer',
];

/**
 * Zumbi: igual ao hostil padrão, mais o arrombamento de porta do Difícil
 * (doc 06 §10). Vem antes de `moveToTarget` porque a porta é o que está
 * impedindo o caminho — perseguir sem abrir não leva a lugar nenhum.
 */
const ZOMBIE_GOALS: readonly GoalName[] = [
  'floatInWater', 'attackMelee', 'breakDoor', 'moveToTarget', 'avoidSunlight',
  'wander', 'lookAtPlayer',
];

/** Comportamento padrão de um passivo. */
const PASSIVE_GOALS: readonly GoalName[] = [
  'floatInWater', 'panic', 'breed', 'followItem', 'wander', 'lookAtPlayer',
];

const SPECS: MobSpec[] = [
  // --- passivos -----------------------------------------------------------
  {
    id: 0, name: 'cow', display: 'Vaca', category: 'passive',
    health: 10, width: 0.9, height: 1.4, speed: 1.25,
    followRange: 12, xp: [1, 3],
    drops: [{ item: 'leather', count: [0, 2] }, { item: 'beef', count: [1, 3] }],
    goals: PASSIVE_GOALS, model: 'quadruped', skin: 'cow', sound: 'cow',
    despawnable: false, traits: { temptItem: 'wheat', breedItem: 'wheat', milkable: true },
  },
  {
    id: 1, name: 'pig', display: 'Porco', category: 'passive',
    health: 10, width: 0.9, height: 0.9, speed: 1.25,
    followRange: 12, xp: [1, 3],
    drops: [{ item: 'porkchop', count: [1, 3] }],
    goals: PASSIVE_GOALS, model: 'quadruped_short', skin: 'pig', sound: 'pig',
    despawnable: false, traits: { temptItem: 'carrot', breedItem: 'carrot' },
  },
  {
    id: 2, name: 'sheep', display: 'Ovelha', category: 'passive',
    health: 8, width: 0.9, height: 1.3, speed: 1.25,
    followRange: 12, xp: [1, 3],
    // A lã sai pela cor da ovelha (`woolly`), não pela tabela de drops.
    drops: [{ item: 'mutton', count: [1, 2] }],
    goals: PASSIVE_GOALS, model: 'quadruped', skin: 'sheep', sound: 'sheep',
    despawnable: false, traits: { temptItem: 'wheat', breedItem: 'wheat', woolly: true },
  },
  {
    id: 3, name: 'chicken', display: 'Galinha', category: 'passive',
    health: 4, width: 0.4, height: 0.7, speed: 1.1,
    followRange: 10, xp: [1, 3],
    drops: [{ item: 'feather', count: 1 }, { item: 'chicken', count: 1 }],
    goals: PASSIVE_GOALS, model: 'bird', skin: 'chicken', sound: 'chicken',
    despawnable: false,
    traits: {
      glides: true, temptItem: 'wheat_seeds', breedItem: 'wheat_seeds',
      lays: { item: 'egg', minTicks: 6000, maxTicks: 12000 },
    },
  },
  {
    id: 4, name: 'squid', display: 'Lula', category: 'water',
    health: 10, width: 0.8, height: 0.8, speed: 1.0,
    followRange: 8, xp: [1, 3],
    drops: [{ item: 'ink_sac', count: [1, 3] }],
    goals: ['wander'], model: 'squid', skin: 'squid', sound: 'squid',
    despawnable: true, traits: { swims: true },
  },

  // --- neutros ------------------------------------------------------------
  {
    id: 5, name: 'wolf', display: 'Lobo', category: 'neutral',
    health: 8, width: 0.6, height: 0.85, speed: 4.8,
    attack: { damage: [3, 4, 6], reach: 1.4, cooldownTicks: 20 },
    followRange: 16, xp: [1, 3],
    drops: [],
    goals: [
      'floatInWater', 'attackMelee', 'moveToTarget', 'followOwner', 'followItem',
      'wander', 'lookAtPlayer',
    ],
    model: 'wolf', skin: 'wolf', sound: 'wolf',
    despawnable: false,
    traits: {
      neutralUntilProvoked: true, callsForHelp: true,
      tameItem: 'bone', tameChance: 1 / 3, temptItem: 'bone',
    },
  },
  {
    id: 6, name: 'enderman', display: 'Enderman', category: 'neutral',
    health: 40, width: 0.6, height: 2.9, speed: 4.5,
    attack: { damage: [4, 7, 10], reach: 1.8, cooldownTicks: 20 },
    followRange: 16, xp: [5, 5],
    drops: [{ item: 'ender_pearl', count: [0, 1] }],
    goals: HOSTILE_GOALS, model: 'enderman', skin: 'enderman', sound: 'enderman',
    despawnable: true,
    traits: { neutralUntilProvoked: true, teleportsOnDamage: true, carriesBlocks: true },
  },
  {
    id: 7, name: 'spider', display: 'Aranha', category: 'hostile',
    health: 16, width: 1.4, height: 0.9, speed: 4.2,
    attack: { damage: [2, 2, 3], reach: 1.6, cooldownTicks: 20 },
    followRange: 16, xp: [2, 4],
    drops: [{ item: 'string', count: [0, 2] }, { item: 'spider_eye', count: [0, 1], chance: 0.33 }],
    goals: ['floatInWater', 'attackMelee', 'leapAtTarget', 'moveToTarget', 'wander', 'lookAtPlayer'],
    model: 'spider', skin: 'spider', sound: 'spider',
    despawnable: true,
    // Neutra na luz: o alvo só é adquirido se a luz na posição dela for ≤ 11.
    traits: { climbsWalls: true, neutralUntilProvoked: false },
  },

  // --- hostis -------------------------------------------------------------
  {
    id: 8, name: 'zombie', display: 'Zumbi', category: 'hostile',
    health: 20, width: 0.6, height: 1.95, speed: 3.7,
    attack: { damage: [2, 3, 4], reach: 1.6, cooldownTicks: 20 },
    followRange: 16, xp: [5, 5],
    drops: [
      { item: 'rotten_flesh', count: [0, 2] },
      { item: 'iron_ingot', count: 1, chance: 0.025 },
    ],
    goals: ZOMBIE_GOALS, model: 'humanoid', skin: 'zombie', sound: 'zombie',
    despawnable: true, traits: { burnsInSunlight: true },
  },
  {
    id: 9, name: 'skeleton', display: 'Esqueleto', category: 'hostile',
    health: 20, width: 0.6, height: 1.95, speed: 4.0,
    attack: { damage: [1, 2, 3], reach: 15, cooldownTicks: 40 },
    followRange: 16, xp: [5, 5],
    drops: [{ item: 'bone', count: [0, 2] }, { item: 'arrow', count: [0, 2] }],
    goals: ['floatInWater', 'shoot', 'moveToTarget', 'avoidSunlight', 'wander', 'lookAtPlayer'],
    model: 'humanoid', skin: 'skeleton', sound: 'skeleton',
    despawnable: true, traits: { burnsInSunlight: true },
  },
  {
    id: 10, name: 'creeper', display: 'Creeper', category: 'hostile',
    health: 20, width: 0.6, height: 1.7, speed: 3.4,
    // O dano vem da explosão, não de um golpe; `reach` é a distância do pavio.
    attack: { damage: [0, 0, 0], reach: 3, cooldownTicks: 30 },
    followRange: 16, xp: [5, 5],
    drops: [{ item: 'gunpowder', count: [0, 2] }],
    goals: ['floatInWater', 'explode', 'moveToTarget', 'wander', 'lookAtPlayer'],
    model: 'creeper', skin: 'creeper', sound: 'creeper',
    despawnable: true, traits: {},
  },
  {
    id: 11, name: 'slime', display: 'Slime', category: 'hostile',
    health: 16, width: 1.0, height: 1.0, speed: 1.9,
    attack: { damage: [0, 2, 4], reach: 1.4, cooldownTicks: 20 },
    followRange: 16, xp: [1, 4],
    drops: [{ item: 'slime_ball', count: [1, 2] }],
    goals: ['floatInWater', 'attackMelee', 'moveToTarget', 'wander'],
    model: 'slime', skin: 'slime', sound: 'slime',
    despawnable: true, traits: { splitsOnDeath: true },
  },

  // --- aldeia (M6, rotina no M9) -------------------------------------------
  // O aldeão **não** tem regra de spawn: ele nasce com a aldeia, e só. Sem
  // isso o mundo encheria de aldeões perdidos no meio do nada.
  //
  // A ordem dos goals é a rotina (M9): negociar vence tudo (ele para e olha
  // para quem está negociando), fugir de monstro vence a casa, a casa (de
  // noite e no alarme do sino) vence o trabalho, e o trabalho vence o passeio.
  {
    id: 12, name: 'villager', display: 'Aldeão', category: 'passive',
    health: 20, width: 0.6, height: 1.95, speed: 2.4,
    followRange: 12, xp: [0, 0],
    drops: [],
    goals: [
      'floatInWater', 'trade', 'panic', 'avoidHostile', 'goHome', 'work', 'stayInVillage',
      'wander', 'lookAtPlayer',
    ],
    model: 'humanoid', skin: 'villager', sound: 'villager',
    despawnable: false,
    traits: {
      variantSkins: ['villager_farmer', 'villager_butcher', 'villager_smith', 'villager_librarian'],
    },
  },

  /*
   * Morcego: `ambient` de verdade — não ataca, não dropa nada, não dá XP e
   * some longe do jogador. O valor dele é de ambientação, e é por isso que a
   * categoria existe com cap próprio (doc 07 §4): ele não pode competir com
   * hostil pelo orçamento de mobs do aparelho.
   */
  {
    id: 15, name: 'bat', display: 'Morcego', category: 'ambient',
    health: 6, width: 0.5, height: 0.6, speed: 2.6,
    followRange: 10, xp: [0, 0],
    drops: [],
    goals: ['wander', 'lookAtPlayer'],
    model: 'bat', skin: 'bat', sound: 'bat',
    despawnable: true, traits: { flies: true },
  },

  // --- Nether (M7) --------------------------------------------------------
  /*
   * Porco zumbi: neutro, como na referência. Ele não ataca até apanhar, e é o
   * que faz o Nether ser atravessável — um corredor de hostis puros na dimensão
   * em que se chega sem equipamento seria só morte.
   */
  {
    id: 13, name: 'zombified_piglin', display: 'Porco Zumbi', category: 'neutral',
    health: 20, width: 0.6, height: 1.95, speed: 3.4,
    attack: { damage: [3, 5, 7], reach: 1.4, cooldownTicks: 20 },
    followRange: 16, xp: [5, 5],
    drops: [
      { item: 'rotten_flesh', count: [0, 1] },
      { item: 'gold_ingot', count: 1, chance: 0.08 },
    ],
    goals: HOSTILE_GOALS, model: 'humanoid', skin: 'zombified_piglin', sound: 'zombie',
    despawnable: true,
    traits: { neutralUntilProvoked: true, callsForHelp: true, fireImmune: true },
  },
  /*
   * Ghast: voa, atira de longe e tem 10 de vida em 4 blocos de corpo.
   *
   * O contrato dele é ser **visto antes de ser sentido** — é a única ameaça do
   * jogo que não precisa chegar perto, e por isso o alcance é o dobro do
   * esqueleto. A bola de fogo explode onde para, o que quebra ponte e assusta.
   */
  {
    id: 14, name: 'ghast', display: 'Ghast', category: 'hostile',
    health: 10, width: 1, height: 1, speed: 2.2,
    attack: { damage: [3, 5, 7], reach: 2, cooldownTicks: 60 },
    followRange: 32, xp: [5, 5],
    drops: [{ item: 'gunpowder', count: [0, 2] }],
    goals: ['shoot', 'wander', 'lookAtPlayer'],
    model: 'cube', skin: 'ghast', sound: 'ghast',
    despawnable: true,
    traits: { flies: true, shootsFireball: true, fireImmune: true, modelScale: 4 },
  },

  // --- aldeia (M9) --------------------------------------------------------
  /*
   * Golem de ferro: nasce com a aldeia e a defende. Não caça o jogador — só
   * quem bate num aldeão perto dele, ou nele mesmo (`neutralUntilProvoked`).
   * O alvo de todo dia é o hostil que chega perto das casas (`defendVillage`).
   *
   * Humanoide em escala 1,4: 2,7 blocos de altura, a leitura de "maior que
   * gente" sem um modelo novo.
   */
  {
    id: 16, name: 'iron_golem', display: 'Golem de Ferro', category: 'neutral',
    health: 100, width: 0.6, height: 1.95, speed: 3.2,
    attack: { damage: [7, 11, 15], reach: 2.2, cooldownTicks: 20 },
    followRange: 16, xp: [0, 0],
    drops: [
      { item: 'iron_ingot', count: [3, 5] },
      { item: 'poppy', count: [0, 2] },
    ],
    goals: [
      'floatInWater', 'defendVillage', 'attackMelee', 'moveToTarget', 'patrol', 'lookAtPlayer',
    ],
    model: 'humanoid', skin: 'iron_golem', sound: 'iron_golem',
    despawnable: false,
    traits: { neutralUntilProvoked: true, modelScale: 1.4 },
  },
];

/**
 * Indexada **pelo id**, não pela ordem de declaração.
 *
 * `mobDef(id)` lê `MOBS[id]`, e o morcego (id 15) entrou na lista antes do
 * porco zumbi (13) e do ghast (14) em 2026-09-14: de lá até 2026-09-23 o
 * `mobDef(13)` devolvia o morcego, o 14 o porco zumbi e o 15 o ghast. As três
 * criaturas trocavam de corpo e de IA — o morcego das cavernas atirava bola de
 * fogo. A lista é ordenada aqui e o buraco na numeração vira erro no boot.
 */
export const MOBS: readonly MobDef[] = SPECS
  .map((spec) => ({ ...spec, traits: spec.traits ?? {} }))
  .sort((a, b) => a.id - b.id);
MOBS.forEach((mob, index) => {
  if (mob.id !== index) throw new Error(`id de mob fora de sequência: ${mob.name} (${mob.id})`);
});

export const MOB_BY_NAME: ReadonlyMap<string, MobDef> = new Map(
  MOBS.map((mob) => [mob.name, mob]),
);

export function mobDef(id: number): MobDef {
  return MOBS[id] ?? MOBS[0];
}

/** Regra de spawn de um mob, ou `undefined` se ele não nasce naturalmente. */
export function spawnRuleOf(name: string): SpawnRule | undefined {
  return SPAWN_RULES[name];
}

/** Dano de ataque na dificuldade atual (0 = pacífico não machuca). */
export function attackDamage(def: MobDef, difficulty: number): number {
  if (def.attack === undefined || difficulty <= 0) return 0;
  return def.attack.damage[Math.min(2, difficulty - 1)];
}

/** Ids por categoria, pré-calculados: o spawn sorteia sobre isso todo segundo. */
export const MOBS_BY_CATEGORY: Readonly<Record<MobCategory, readonly number[]>> = {
  passive: idsOf('passive'),
  neutral: idsOf('neutral'),
  hostile: idsOf('hostile'),
  ambient: idsOf('ambient'),
  water: idsOf('water'),
};

function idsOf(category: MobCategory): number[] {
  return MOBS.filter((m) => m.category === category && SPAWN_RULES[m.name] !== undefined)
    .map((m) => m.id);
}
