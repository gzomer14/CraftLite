/**
 * Efeitos de status (doc 05 §4: "Fome por 30 s", "Regeneração II 5 s,
 * Absorção 2 min").
 *
 * Até 2026-09-22 não havia sistema de efeito nenhum: carne podre e frango cru
 * eram comida comum, e a maçã dourada não tinha como existir. Aqui mora **o
 * que cada efeito faz**, em números; quem aplica é `game/effects.ts`, que não
 * sabe o nome de nenhum efeito. Um efeito novo (as poções do M16) é uma linha
 * nesta tabela.
 *
 * **O `id` vai para o save — nunca reordene.**
 */

export interface EffectDef {
  id: number;
  name: string;
  display: string;
  /** Cor do ícone no HUD, também usada no tom da partícula. */
  color: readonly [number, number, number];
  /** Aparece com borda vermelha: é o jogador que quer que acabe. */
  harmful: boolean;
  /** Exaustão somada por tick, por nível (Fome). */
  exhaustionPerTick?: number;
  /** Cura 1 de vida a cada N ticks no nível I; cada nível acima divide por 2. */
  healEvery?: number;
  /** Tira 1 de vida a cada N ticks no nível I; nunca mata (Veneno). */
  damageEvery?: number;
  /** Vida extra, em pontos, por nível — gasta antes da vida (Absorção). */
  absorptionPerLevel?: number;
  // --- poções (M16) ----------------------------------------------------------
  /**
   * Fração somada à velocidade de andar por nível: +0,2 é Velocidade, −0,15
   * Lentidão. Quem lê é a física do jogador, pelo multiplicador que
   * `StatusEffects.speedMultiplier` soma.
   */
  speedPerLevel?: number;
  /** Dano somado ao golpe corpo a corpo por nível: +3 Força, −4 Fraqueza. */
  attackPerLevel?: number;
  /** Enxerga no escuro: o render sobe o piso de luz (Visão Noturna). */
  nightVision?: boolean;
  /** Fogo e lava não ferem (Resistência ao Fogo). */
  fireImmune?: boolean;
  /**
   * Cura na hora, em pontos por nível, e não fica ativo (Cura Instantânea).
   * Sem duração: `add` aplica e sai, sem ícone no HUD.
   */
  instantHeal?: number;
}

export const EFFECTS: readonly EffectDef[] = [
  {
    id: 0, name: 'hunger', display: 'Fome', color: [88, 118, 83], harmful: true,
    // O número do gênero: 0,005 por tick e nível — meia coxa a cada 40 s
    // (4,0 de exaustão por ponto de fome, doc 06 §7).
    exhaustionPerTick: 0.005,
  },
  {
    id: 1, name: 'regeneration', display: 'Regeneração', color: [205, 92, 171], harmful: false,
    healEvery: 50,
  },
  {
    id: 2, name: 'absorption', display: 'Absorção', color: [37, 82, 165], harmful: false,
    absorptionPerLevel: 4,
  },
  {
    id: 3, name: 'poison', display: 'Veneno', color: [78, 147, 49], harmful: true,
    damageEvery: 25,
  },
  // --- M16: os efeitos das poções, no fim (o id vai para o save) -------------
  {
    id: 4, name: 'speed', display: 'Velocidade', color: [124, 175, 198], harmful: false,
    speedPerLevel: 0.2,
  },
  {
    id: 5, name: 'slowness', display: 'Lentidão', color: [90, 108, 129], harmful: true,
    speedPerLevel: -0.15,
  },
  {
    id: 6, name: 'strength', display: 'Força', color: [147, 36, 35], harmful: false,
    attackPerLevel: 3,
  },
  {
    id: 7, name: 'weakness', display: 'Fraqueza', color: [72, 77, 72], harmful: true,
    attackPerLevel: -4,
  },
  {
    id: 8, name: 'night_vision', display: 'Visão Noturna', color: [31, 31, 161], harmful: false,
    nightVision: true,
  },
  {
    id: 9, name: 'fire_resistance', display: 'Resistência ao Fogo', color: [228, 154, 58],
    harmful: false, fireImmune: true,
  },
  {
    id: 10, name: 'instant_health', display: 'Cura Instantânea', color: [248, 36, 35],
    harmful: false, instantHeal: 4,
  },
];

export const EFFECT_BY_NAME: ReadonlyMap<string, EffectDef> = new Map(
  EFFECTS.map((e) => [e.name, e]),
);

/** Efeito que uma comida aplica ao ser comida (doc 05 §4). */
export interface FoodEffect {
  effect: string;
  /** Nível, a partir de 1 (Regeneração II = 2). */
  level: number;
  seconds: number;
  /** Chance 0..1 de aplicar; ausente = sempre. */
  chance?: number;
}
