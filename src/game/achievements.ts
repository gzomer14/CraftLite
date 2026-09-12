/**
 * Rastreio de conquistas (doc 08 §3.4).
 *
 * O motor não sabe o que é uma conquista: ele avisa **o que aconteceu**
 * (`obtain('diamond')`, `kill('zombie')`, `depth(11)`) e este módulo decide se
 * isso vale uma medalha, consultando a tabela declarativa de
 * `data/achievements.ts`.
 *
 * O estado é uma **máscara de bits** — 18 conquistas cabem num inteiro, o save
 * ganha um número e "já ganhei essa?" é um `and`. Um `Set<string>` custaria
 * alocação e um campo de array no save para o mesmo resultado.
 *
 * Os índices vão para o save: a tabela nunca reordena, só cresce.
 */

import { ACHIEVEMENTS, type AchievementDef, type TriggerKind } from '../data/achievements';

/** Quantas conquistas cabem numa máscara de 32 bits com segurança. */
export const MAX_ACHIEVEMENTS = 31;

export class Achievements {
  /** Bit `i` ligado = conquista `i` desbloqueada. */
  private unlockedMask = 0;

  /** Chamado quando uma conquista é desbloqueada — o toast vem daqui. */
  onUnlock: ((def: AchievementDef) => void) | null = null;

  /** Índice por gatilho e alvo, montado uma vez. */
  private static readonly index = buildIndex();

  get mask(): number {
    return this.unlockedMask;
  }

  /** Restaura do save. */
  setMask(mask: number): void {
    this.unlockedMask = mask >>> 0;
  }

  has(id: number): boolean {
    return (this.unlockedMask & (1 << id)) !== 0;
  }

  get count(): number {
    let total = 0;
    for (let i = 0; i < ACHIEVEMENTS.length; i++) if (this.has(i)) total++;
    return total;
  }

  /** Pegou um item — coleta, craft ou saída da fornalha. */
  obtain(itemName: string): void {
    this.fire('obtain', itemName);
  }

  /** Matou um mob. */
  kill(mobName: string): void {
    this.fire('kill', mobName);
  }

  /** Colocou um bloco. */
  place(blockName: string): void {
    this.fire('place', blockName);
  }

  /** Marco sem alvo: dormir, encantar, navegar, cruzar bichos. */
  event(name: string): void {
    this.fire('event', name);
  }

  /**
   * Chegou a esta profundidade. Dispara todas as conquistas de `depth` cujo
   * alvo é **maior ou igual** ao Y informado — descer 40 blocos de uma vez não
   * pode pular medalha.
   */
  depth(y: number): void {
    this.fireNumeric('depth', (target) => y <= target);
  }

  /** Subiu para este nível de experiência. */
  level(level: number): void {
    this.fireNumeric('level', (target) => level >= target);
  }

  private fire(kind: TriggerKind, target: string): void {
    const ids = Achievements.index.get(`${kind}:${target}`);
    if (ids === undefined) return;
    for (const id of ids) this.unlock(id);
  }

  private fireNumeric(kind: TriggerKind, matches: (target: number) => boolean): void {
    for (const def of ACHIEVEMENTS) {
      if (def.trigger !== kind) continue;
      if (this.has(def.id)) continue;
      if (matches(Number(def.target))) this.unlock(def.id);
    }
  }

  private unlock(id: number): void {
    if (this.has(id)) return;
    this.unlockedMask |= 1 << id;
    const def = ACHIEVEMENTS[id];
    if (def !== undefined) this.onUnlock?.(def);
  }
}

/** `"kind:target"` → ids, para o disparo ser uma consulta e não uma varredura. */
function buildIndex(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const def of ACHIEVEMENTS) {
    if (def.trigger === 'depth' || def.trigger === 'level') continue;
    const key = `${def.trigger}:${def.target}`;
    const list = out.get(key);
    if (list === undefined) out.set(key, [def.id]);
    else list.push(def.id);
  }
  return out;
}
