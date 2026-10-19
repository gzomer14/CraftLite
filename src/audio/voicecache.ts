/**
 * Quais vozes de mob ficam na memória (M25).
 *
 * Até o M25 o `AudioEngine` renderizava **todos** os 124 sons no boot: 2,92 MB
 * de um teto de 3,5, e cada mob novo dos M27–M29 empurraria para cima. As
 * vozes de mob são três quartos disso, e numa partida o jogador ouve poucas
 * ao mesmo tempo — ninguém escuta o dragão e o porco no mesmo minuto.
 *
 * Agora as vozes de um mob são renderizadas juntas na primeira vez que ele faz
 * som, e ficam enquanto couberem no orçamento; passando dele, sai o mob ouvido
 * há mais tempo, e volta a ser renderizado se aparecer de novo. Os outros sons
 * (passo, quebra, interface, chuva) continuam todos no boot: são os de toda
 * hora, e somam menos de 1 MB.
 *
 * Regra pura, sem WebAudio: é testável no Node, e o motor só pergunta.
 */

/** Teto das vozes de mob residentes: com os ~0,74 MB do boot, o pico fica abaixo de 2,5 MB. */
export const VOICE_BUDGET_BYTES = 1.5 * 1024 * 1024;

/** Prefixo dos sons que são renderizados sob demanda. */
const LAZY_PREFIX = 'mob/';

/**
 * O grupo de um som sob demanda: `mob/zombie_hurt` → `mob/zombie`. Todo som
 * de mob entra, inclusive os que não são voz (o teleporte do enderman vai com
 * ele). Os outros devolvem `null`: são do boot.
 */
export function voiceGroup(name: string): string | null {
  if (!name.startsWith(LAZY_PREFIX)) return null;
  const cut = name.lastIndexOf('_');
  return cut > LAZY_PREFIX.length ? name.slice(0, cut) : name;
}

/** Os grupos de uma tabela de sons, com os nomes de cada um. */
export function groupsOf(names: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const group = voiceGroup(name);
    if (group === null) continue;
    const list = groups.get(group);
    if (list === undefined) groups.set(group, [name]);
    else list.push(name);
  }
  return groups;
}

/** Bytes residentes por grupo, e quando cada um tocou por último. */
export class VoiceCache {
  private readonly budget: number;
  private readonly bytes = new Map<string, number>();
  private readonly lastUse = new Map<string, number>();
  private total = 0;

  constructor(budget: number) {
    this.budget = budget;
  }

  /** Bytes das vozes na memória agora. */
  get resident(): number {
    return this.total;
  }

  has(group: string): boolean {
    return this.bytes.has(group);
  }

  /** O grupo tocou agora. */
  touch(group: string, now: number): void {
    if (this.bytes.has(group)) this.lastUse.set(group, now);
  }

  /**
   * Um grupo acabou de ser renderizado. Devolve os que saem para caber no
   * orçamento, do ouvido há mais tempo para o mais recente; o que entrou
   * nunca sai na mesma hora, mesmo que sozinho passe do orçamento.
   */
  add(group: string, size: number, now: number): string[] {
    const previous = this.bytes.get(group) ?? 0;
    this.bytes.set(group, size);
    this.lastUse.set(group, now);
    this.total += size - previous;
    const evicted: string[] = [];
    while (this.total > this.budget) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      for (const [key, at] of this.lastUse) {
        if (key !== group && at < oldestAt) { oldest = key; oldestAt = at; }
      }
      if (oldest === null) break;
      this.total -= this.bytes.get(oldest) ?? 0;
      this.bytes.delete(oldest);
      this.lastUse.delete(oldest);
      evicted.push(oldest);
    }
    return evicted;
  }
}
