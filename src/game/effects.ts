/**
 * Efeitos de status ativos no jogador (doc 05 §4).
 *
 * Motor genérico sobre `data/effects.ts`: este módulo não conhece nenhum
 * efeito pelo nome. Ele guarda duração e nível por id, em arrays tipados do
 * tamanho da tabela — nada de lista de objetos que cresce e encolhe a cada
 * maçã comida —, e a cada tick entrega ao alvo o que a tabela manda: curar,
 * ferir, cansar ou dar vida extra.
 *
 * Regras de acúmulo, as do gênero:
 * - nível maior substitui o menor, com a duração nova;
 * - mesmo nível fica com a duração mais longa;
 * - nível menor não mexe no que está ativo.
 */

import { EFFECTS, type EffectDef } from '../data/effects';

/** Quem sofre o efeito. A `Survival` implementa; os testes passam um duplo. */
export interface EffectTarget {
  heal(amount: number): void;
  /** Dano que **não mata**: o veneno para em meio coração. */
  hurtNonLethal(amount: number): void;
  addExhaustion(amount: number): void;
  /** Vida extra atual; o efeito a acende e a apaga. */
  absorption: number;
}

export class StatusEffects {
  /** Ticks restantes por id; 0 = inativo. */
  readonly ticks = new Int32Array(EFFECTS.length);
  /** Nível por id, a partir de 1; 0 = inativo. */
  readonly level = new Uint8Array(EFFECTS.length);
  /** Quantos efeitos estão ativos agora (o HUD some com a faixa quando é 0). */
  active = 0;
  /**
   * Aumenta a cada mudança de conjunto (entrou, saiu, subiu de nível). O HUD
   * compara com o último que viu e só mexe no DOM quando muda.
   */
  version = 0;

  has(id: number): boolean {
    return this.ticks[id] > 0;
  }

  /** Aplica um efeito. Devolve true se algo mudou. */
  add(id: number, level: number, ticks: number, target?: EffectTarget): boolean {
    const def = EFFECTS[id];
    if (def === undefined || level < 1) return false;
    // Instantâneo (M16): age agora e não entra na lista — não há o que durar.
    if (def.instantHeal !== undefined) {
      target?.heal(def.instantHeal * level);
      return target !== undefined;
    }
    if (ticks <= 0) return false;
    const current = this.level[id];
    if (this.ticks[id] > 0) {
      if (level < current) return false;
      if (level === current && ticks <= this.ticks[id]) return false;
    } else {
      this.active++;
    }
    this.level[id] = level;
    this.ticks[id] = ticks;
    this.version++;
    if (def.absorptionPerLevel !== undefined && target !== undefined) {
      target.absorption = Math.max(target.absorption, def.absorptionPerLevel * level);
    }
    return true;
  }

  /**
   * Multiplicador de velocidade de andar (M16): 1 sem nada, 1,2 com
   * Velocidade I, 0,85 com Lentidão I. Varre a tabela — onze entradas, sem
   * alocar — só quando há efeito ativo.
   */
  speedMultiplier(): number {
    if (this.active === 0) return 1;
    let sum = 1;
    for (let id = 0; id < EFFECTS.length; id++) {
      const per = EFFECTS[id].speedPerLevel;
      if (per !== undefined && this.ticks[id] > 0) sum += per * this.level[id];
    }
    return Math.max(0.1, sum);
  }

  /** Dano somado ao golpe corpo a corpo (Força, Fraqueza). */
  attackBonus(): number {
    if (this.active === 0) return 0;
    let sum = 0;
    for (let id = 0; id < EFFECTS.length; id++) {
      const per = EFFECTS[id].attackPerLevel;
      if (per !== undefined && this.ticks[id] > 0) sum += per * this.level[id];
    }
    return sum;
  }

  /** true com algum efeito de enxergar no escuro ativo. */
  get nightVision(): boolean {
    return this.hasFlag('nightVision');
  }

  /** true com algum efeito que protege do fogo ativo. */
  get fireImmune(): boolean {
    return this.hasFlag('fireImmune');
  }

  private hasFlag(flag: 'nightVision' | 'fireImmune'): boolean {
    if (this.active === 0) return false;
    for (let id = 0; id < EFFECTS.length; id++) {
      if (EFFECTS[id][flag] === true && this.ticks[id] > 0) return true;
    }
    return false;
  }

  /** Tira um efeito (ou todos, o que o leite faz). */
  remove(id: number, target?: EffectTarget): void {
    if (this.ticks[id] <= 0) return;
    this.expire(EFFECTS[id], target);
  }

  clear(target?: EffectTarget): void {
    for (let id = 0; id < EFFECTS.length; id++) this.remove(id, target);
  }

  tick(target: EffectTarget): void {
    if (this.active === 0) return;
    for (let id = 0; id < EFFECTS.length; id++) {
      const left = this.ticks[id];
      if (left <= 0) continue;
      const def = EFFECTS[id];
      const level = this.level[id];
      // O pulso é contado pelo tempo que **falta**: não precisa de um segundo
      // contador por efeito, e o primeiro pulso não sai no tick em que comeu.
      if (def.exhaustionPerTick !== undefined) target.addExhaustion(def.exhaustionPerTick * level);
      if (def.healEvery !== undefined && left % periodOf(def.healEvery, level) === 0) {
        target.heal(1);
      }
      if (def.damageEvery !== undefined && left % periodOf(def.damageEvery, level) === 0) {
        target.hurtNonLethal(1);
      }
      if (def.absorptionPerLevel !== undefined && target.absorption <= 0) {
        // Absorção gasta até o fim: o efeito acaba junto com ela.
        this.expire(def, target);
        continue;
      }
      this.ticks[id] = left - 1;
      if (left - 1 <= 0) this.expire(def, target);
    }
  }

  private expire(def: EffectDef, target?: EffectTarget): void {
    this.ticks[def.id] = 0;
    this.level[def.id] = 0;
    this.active--;
    this.version++;
    if (def.absorptionPerLevel !== undefined && target !== undefined) target.absorption = 0;
  }

  /** Estado para o save: `[id, nível, ticks]` por efeito ativo. */
  snapshot(): number[] {
    const out: number[] = [];
    for (let id = 0; id < EFFECTS.length; id++) {
      if (this.ticks[id] > 0) out.push(id, this.level[id], this.ticks[id]);
    }
    return out;
  }

  restore(data: readonly number[] | undefined, target?: EffectTarget): void {
    this.clear(target);
    if (data === undefined) return;
    for (let i = 0; i + 2 < data.length; i += 3) {
      this.add(data[i], data[i + 1], data[i + 2], target);
    }
  }
}

/** Período do pulso num nível: cada nível acima do I divide por dois, mínimo 1. */
function periodOf(base: number, level: number): number {
  return Math.max(1, base >> (level - 1));
}
