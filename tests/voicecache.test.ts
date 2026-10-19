/**
 * Vozes de mob sob demanda (M25): a regra de quem fica na memória, e a conta
 * que fecha o critério do marco — o pico de memória de áudio a pelo menos 1 MB
 * do teto de 3,5 MB do doc 10.
 */
import { describe, expect, it } from 'vitest';
import { SOUNDS, durationOf, rateFor } from '../src/audio/synth';
import { VOICE_BUDGET_BYTES, VoiceCache, groupsOf, voiceGroup } from '../src/audio/voicecache';
import { MOBS } from '../src/data/mobs';

/** O mesmo cálculo de `tests/audio.test.ts`: o render na taxa da receita. */
function bytesOf(name: string): number {
  const recipe = SOUNDS[name];
  return durationOf(recipe) * rateFor(recipe, 22050) * 4;
}

const MB = 1024 * 1024;
/** O teto do doc 10 que o `tests/audio.test.ts` usa como referência. */
const AUDIO_CEILING = 3.5 * MB;

describe('grupos', () => {
  it('cada voz de mob cai no grupo do próprio mob; o resto é do boot', () => {
    expect(voiceGroup('mob/zombie_hurt')).toBe('mob/zombie');
    expect(voiceGroup('mob/iron_golem_death')).toBe('mob/iron_golem');
    expect(voiceGroup('mob/enderman_teleport')).toBe('mob/enderman');
    expect(voiceGroup('step/grass')).toBeNull();
    expect(voiceGroup('weather/rain')).toBeNull();
  });

  it('todo mob com voz na tabela vira um grupo', () => {
    const groups = groupsOf(Object.keys(SOUNDS));
    for (const mob of MOBS) {
      const has = Object.keys(SOUNDS).some((name) => name.startsWith(`mob/${mob.name}_`));
      if (has) expect(groups.has(`mob/${mob.name}`), mob.name).toBe(true);
    }
  });
});

describe('quem fica na memória', () => {
  it('passando do orçamento, sai o ouvido há mais tempo — nunca o que acabou de entrar', () => {
    const cache = new VoiceCache(100);
    expect(cache.add('a', 40, 1)).toEqual([]);
    expect(cache.add('b', 40, 2)).toEqual([]);
    cache.touch('a', 3); // o `a` tocou de novo: o mais antigo agora é o `b`
    expect(cache.add('c', 40, 4)).toEqual(['b']);
    expect(cache.has('a') && cache.has('c') && !cache.has('b')).toBe(true);
    expect(cache.resident).toBe(80);
  });

  it('um grupo maior que o orçamento entra sozinho e despeja todos os outros', () => {
    const cache = new VoiceCache(100);
    cache.add('a', 30, 1);
    cache.add('b', 30, 2);
    expect(cache.add('grande', 150, 3)).toEqual(['a', 'b']);
    expect(cache.resident).toBe(150);
  });
});

describe('memória de áudio (critério do M25)', () => {
  const groups = groupsOf(Object.keys(SOUNDS));
  let boot = 0;
  for (const name of Object.keys(SOUNDS)) if (voiceGroup(name) === null) boot += bytesOf(name);
  let largest = 0;
  for (const names of groups.values()) {
    largest = Math.max(largest, names.reduce((sum, name) => sum + bytesOf(name), 0));
  }

  it('o boot leva só os sons de toda hora: menos de 1 MB', () => {
    expect(boot / MB).toBeLessThan(1);
  });

  it('o pico (boot + orçamento das vozes + o maior mob entrando) fica a 1 MB ou mais do teto', () => {
    const peak = boot + VOICE_BUDGET_BYTES + largest;
    console.log(`áudio: boot ${(boot / MB).toFixed(2)} MB, pico ${(peak / MB).toFixed(2)} MB`);
    expect(AUDIO_CEILING - peak).toBeGreaterThanOrEqual(1 * MB);
  });
});
