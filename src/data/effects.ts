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
