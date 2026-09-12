/**
 * Experiência e níveis (doc 06 §8).
 *
 * O jogo guarda o **total acumulado** e deriva nível e progresso dele, em vez
 * de guardar nível e sobra separados. É uma decisão de robustez: gastar níveis
 * na mesa vira uma subtração no total, e não existe estado em que o nível e a
 * barra discordem — o bug clássico de "nível 3 com a barra cheia de nível 5".
 */

/** Nível máximo alcançável; acima disso a curva não muda nada de útil. */
export const MAX_LEVEL = 100;

/** Quanta experiência falta para sair do nível `n` (doc 06 §8). */
export function xpToNext(level: number): number {
  if (level < 16) return 2 * level + 7;
  if (level < 31) return 5 * level - 38;
  return 9 * level - 158;
}

/** Total acumulado até completar o nível `level`. */
export function totalForLevel(level: number): number {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpToNext(i);
  return total;
}

export class Experience {
  /** Experiência acumulada desde o início do mundo (ou do último respawn). */
  private accumulated = 0;
  private cachedLevel = 0;
  /** Quanto do nível atual já foi preenchido. */
  private cachedInLevel = 0;

  /** Chamado quando o nível sobe — som e "ding" do HUD. */
  onLevelUp: ((level: number) => void) | null = null;

  get total(): number {
    return this.accumulated;
  }

  get level(): number {
    return this.cachedLevel;
  }

  /** 0..1 da barra verde acima da hotbar (doc 08 §3.4). */
  get progress(): number {
    const need = xpToNext(this.cachedLevel);
    return need <= 0 ? 0 : Math.min(1, this.cachedInLevel / need);
  }

  /** Acrescenta orbes coletados. Dispara `onLevelUp` a cada nível cruzado. */
  add(amount: number): void {
    if (amount <= 0) return;
    const before = this.cachedLevel;
    this.setTotal(this.accumulated + amount);
    if (this.cachedLevel > before) this.onLevelUp?.(this.cachedLevel);
  }

  /** true se o jogador tem níveis suficientes para pagar `levels`. */
  canAfford(levels: number): boolean {
    return this.cachedLevel >= levels;
  }

  /**
   * Gasta níveis inteiros (a mesa de encantamento).
   *
   * Gastar leva o jogador para o **começo** do nível resultante: sobra de
   * barra não se acumula entre compras, que é o comportamento do gênero e o
   * único que não deixa o jogador com dois níveis "quase completos".
   */
  spend(levels: number): boolean {
    if (levels <= 0 || !this.canAfford(levels)) return false;
    this.setTotal(totalForLevel(this.cachedLevel - levels));
    return true;
  }

  /** Morrer zera tudo (doc 06 §6). */
  reset(): void {
    this.setTotal(0);
  }

  /** Restaura do save. */
  setTotal(total: number): void {
    this.accumulated = Math.max(0, Math.floor(total));
    let level = 0;
    let remaining = this.accumulated;
    while (level < MAX_LEVEL) {
      const need = xpToNext(level);
      if (remaining < need) break;
      remaining -= need;
      level++;
    }
    this.cachedLevel = level;
    this.cachedInLevel = remaining;
  }
}
