/**
 * Vida, fome, saturação e dano (doc 06 §6 e §7).
 *
 * O sistema de fome é o que dá ritmo ao jogo, e ele depende de três números
 * que o jogador nunca vê: **saturação** (reserva oculta que segura a fome),
 * **exaustão** (acumula com atividade e come a saturação) e o próprio nível de
 * fome. Trocar as constantes muda quanto tempo se pode explorar sem comer.
 */

import { reduceByArmor } from './combat';
import { reduceByProtection, reduceFallDamage } from './enchanting';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 300;

/** Exaustão por ação (doc 06 §7). */
export const EXHAUSTION = {
  sprintPerBlock: 0.1,
  swimPerBlock: 0.01,
  jump: 0.05,
  sprintJump: 0.2,
  attack: 0.1,
  damage: 0.1,
  breakBlock: 0.005,
  regenerate: 6.0,
} as const;

/** A cada 4.0 de exaustão, some 1 de saturação (ou 1 de fome). */
const EXHAUSTION_THRESHOLD = 4.0;
/** Fome ≥ 18 com saturação: cura 1♥ a cada 10 ticks. */
const FAST_REGEN_TICKS = 10;
/** Fome ≥ 18 sem saturação: cura 1♥ a cada 80 ticks. */
const SLOW_REGEN_TICKS = 80;
/** Fome = 0: perde 1♥ a cada 80 ticks. */
const STARVE_TICKS = 80;
/** Invulnerabilidade após dano (doc 06 §6). */
const INVULNERABLE_TICKS = 10;
/** Fome ≤ 6 impede correr. */
const SPRINT_HUNGER_MIN = 7;

export type Difficulty = 0 | 1 | 2 | 3;

/** Causa da morte, para a tela de morte (doc 08 §3.12). */
export type DamageCause =
  | 'fall' | 'drown' | 'suffocate' | 'fire' | 'lava' | 'cactus' | 'void' | 'starve' | 'mob'
  | 'arrow' | 'explosion';

const CAUSE_MESSAGES: Record<DamageCause, string> = {
  fall: 'Você caiu de um lugar alto',
  drown: 'Você se afogou',
  suffocate: 'Você sufocou numa parede',
  fire: 'Você virou churrasco',
  lava: 'Você tentou nadar na lava',
  cactus: 'Você foi espetado até a morte',
  void: 'Você caiu para fora do mundo',
  starve: 'Você morreu de fome',
  mob: 'Você foi morto',
  arrow: 'Você foi flechado',
  explosion: 'Você explodiu',
};

/**
 * Causas que **ignoram a armadura** (doc 05 §3 e doc 06 §6): fome, void e o que
 * é falta de ar. Peitoral de diamante não ajuda a respirar.
 */
const ARMOR_BYPASS: readonly DamageCause[] = ['starve', 'void', 'drown', 'suffocate'];

/**
 * O que o ambiente faz ao jogador neste tick.
 *
 * `onFire` estava prometido no comentário de `tick` desde o M4 e **não existia
 * no tipo**: não havia fogo no jogo para ligar nele.
 */
export interface SurvivalContext {
  /** Cabeça debaixo d'água. */
  submerged: boolean;
  inLava: boolean;
  /** Corpo dentro de um bloco de fogo (`world/fire.ts`). */
  onFire: boolean;
  /** Cabeça dentro de bloco sólido e opaco. */
  suffocating: boolean;
  y: number;
}

export class Survival {
  health = MAX_HEALTH;
  hunger = MAX_HUNGER;
  saturation = 5;
  exhaustion = 0;
  air = MAX_AIR;

  difficulty: Difficulty = 2;

  /** Pontos de armadura equipada, mantidos pela `Session`. */
  armor = 0;
  armorToughness = 0;
  /** Soma dos níveis de Proteção nas peças equipadas (M6). */
  protection = 0;
  /** Nível de Queda Suave da bota equipada (M6). */
  featherFalling = 0;

  /** Ticks restantes de invulnerabilidade. */
  invulnerable = 0;
  /** Causa da última morte. */
  lastCause: DamageCause | null = null;

  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;
  private suffocateTimer = 0;
  /** Ticks dentro do fogo desde o último dano. */
  private fireTimer = 0;

  /** Chamado ao morrer. */
  onDeath: ((cause: DamageCause) => void) | null = null;
  /** Chamado ao levar dano, para o tremor de tela e o som. */
  onDamage: ((amount: number, cause: DamageCause) => void) | null = null;

  get isDead(): boolean {
    return this.health <= 0;
  }

  get canSprint(): boolean {
    return this.hunger >= SPRINT_HUNGER_MIN;
  }

  /** Mensagem da tela de morte. */
  get deathMessage(): string {
    return this.lastCause === null ? 'Você morreu' : CAUSE_MESSAGES[this.lastCause];
  }

  /** Acumula exaustão; a conversão em fome acontece no tick. */
  addExhaustion(amount: number): void {
    if (this.difficulty === 0) return; // pacífico não tem fome
    this.exhaustion += amount;
  }

  /**
   * Um tick de sobrevivência.
   * `submerged` = cabeça debaixo d'água; `inLava`/`onFire` para o dano contínuo.
   */
  tick(context: SurvivalContext): void {
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.isDead) return;

    this.consumeExhaustion();
    this.tickRegeneration();
    this.tickStarvation();
    this.tickEnvironment(context);
  }

  /** Exaustão vira saturação, e saturação vira fome (doc 06 §7). */
  private consumeExhaustion(): void {
    while (this.exhaustion >= EXHAUSTION_THRESHOLD) {
      this.exhaustion -= EXHAUSTION_THRESHOLD;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
  }

  private tickRegeneration(): void {
    if (this.health >= MAX_HEALTH || this.hunger < 18) {
      this.regenTimer = 0;
      return;
    }
    this.regenTimer++;
    // Com saturação a regeneração é rápida e custa saturação; sem ela é lenta
    // e custa exaustão, que por sua vez consome a fome.
    if (this.saturation > 0) {
      if (this.regenTimer >= FAST_REGEN_TICKS) {
        this.regenTimer = 0;
        this.health = Math.min(MAX_HEALTH, this.health + 1);
        this.saturation = Math.max(0, this.saturation - 1.5);
      }
    } else if (this.regenTimer >= SLOW_REGEN_TICKS) {
      this.regenTimer = 0;
      this.health = Math.min(MAX_HEALTH, this.health + 1);
      this.addExhaustion(EXHAUSTION.regenerate);
    }
  }

  private tickStarvation(): void {
    if (this.hunger > 0) {
      this.starveTimer = 0;
      return;
    }
    this.starveTimer++;
    if (this.starveTimer < STARVE_TICKS) return;
    this.starveTimer = 0;

    // A inanição para num piso que depende da dificuldade (doc 06 §10).
    const floor = this.difficulty === 1 ? 10 : this.difficulty === 2 ? 1 : 0;
    if (this.health > floor) this.damage(1, 'starve', true);
  }

  private tickEnvironment(context: SurvivalContext): void {
    // Afogamento: o ar só volta fora d'água.
    if (context.submerged) {
      if (this.air > 0) {
        this.air--;
      } else {
        this.drownTimer++;
        if (this.drownTimer >= 20) {
          this.drownTimer = 0;
          this.damage(2, 'drown', true);
        }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + 4);
      this.drownTimer = 0;
    }

    if (context.suffocating) {
      this.suffocateTimer++;
      if (this.suffocateTimer >= 10) {
        this.suffocateTimer = 0;
        this.damage(1, 'suffocate', true);
      }
    } else {
      this.suffocateTimer = 0;
    }

    if (context.inLava) this.damage(4, 'lava');
    /*
     * Fogo: metade do dano da lava e a cada meio segundo, não a cada tick.
     *
     * O contrato dele é **poder escapar**: atravessar uma chama correndo custa
     * caro, ficar parado nela mata. Com dano por tick, um bloco de fogo era
     * morte instantânea e o incêndio deixava de ser jogável.
     */
    if (context.onFire) {
      this.fireTimer++;
      if (this.fireTimer >= 10) {
        this.fireTimer = 0;
        this.damage(2, 'fire');
      }
    } else {
      this.fireTimer = 0;
    }
    // Void: abaixo de Y=−5, ignora invulnerabilidade e armadura.
    if (context.y < -5) this.damage(4, 'void', true);
  }

  /**
   * Aplica dano. `ignoreInvulnerability` é usado por fontes contínuas (fome,
   * void), que não devem ser anuladas pelos 10 ticks de piscada.
   */
  damage(amount: number, cause: DamageCause, ignoreInvulnerability = false): boolean {
    if (this.isDead) return false;
    if (!ignoreInvulnerability && this.invulnerable > 0) return false;

    let scaled = amount * difficultyScale(this.difficulty, cause);
    if (ARMOR_BYPASS.indexOf(cause) < 0) {
      if (this.armor > 0) scaled = reduceByArmor(scaled, this.armor, this.armorToughness);
      scaled = reduceByProtection(scaled, this.protection);
    }
    if (scaled <= 0) return false;

    this.health = Math.max(0, this.health - scaled);
    this.lastCause = cause;
    if (!ignoreInvulnerability) this.invulnerable = INVULNERABLE_TICKS;
    this.onDamage?.(scaled, cause);

    if (this.health <= 0) this.onDeath?.(cause);
    return true;
  }

  /** Dano de queda: `floor(distância − 3)` (doc 06 §6), aliviado por Queda Suave. */
  applyFallDamage(distance: number): void {
    const raw = Math.floor(distance - 3);
    if (raw <= 0) return;
    const damage = reduceFallDamage(raw, this.featherFalling);
    if (damage > 0) this.damage(damage, 'fall');
  }

  /** Comer restaura fome e saturação; a saturação nunca passa da fome. */
  eat(hunger: number, saturation: number): void {
    this.hunger = Math.min(MAX_HUNGER, this.hunger + hunger);
    this.saturation = Math.min(this.hunger, this.saturation + saturation);
  }

  get canEat(): boolean {
    return this.hunger < MAX_HUNGER;
  }

  /** Volta ao estado inicial após respawn. A armadura equipada não muda. */
  respawn(): void {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = MAX_AIR;
    this.invulnerable = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.drownTimer = 0;
    this.suffocateTimer = 0;
    this.lastCause = null;
  }
}

/** Multiplicador de dano por dificuldade (doc 06 §10). */
function difficultyScale(difficulty: Difficulty, cause: DamageCause): number {
  // Só dano vindo de mob escala com a dificuldade; ambiente é igual em todas.
  if (cause !== 'mob' && cause !== 'arrow' && cause !== 'explosion') return 1;
  if (difficulty === 0) return 0;
  if (difficulty === 1) return 0.5;
  if (difficulty === 3) return 1.5;
  return 1;
}
