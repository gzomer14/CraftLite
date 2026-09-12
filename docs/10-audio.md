# 10 — Áudio Procedural

Zero bytes de download. Tudo é sintetizado com a **WebAudio API** no boot (renderizado uma vez
para `AudioBuffer` via `OfflineAudioContext`) e depois só disparado. Isso é o que permite ter
som decente dentro do orçamento de 350 KB.

## 1. Arquitetura

```
AudioContext
 ├─ masterGain ──► destination
 │   ├─ musicBus     (gain)
 │   ├─ blockBus     (gain)  ──► pannerNode por som posicional
 │   ├─ mobBus       (gain)
 │   ├─ ambientBus   (gain)
 │   └─ uiBus        (gain)
```

- `AudioContext` só é criado **no primeiro gesto do usuário** (política de autoplay). Antes disso,
  a fila de sons é descartada silenciosamente.
- Sons posicionais usam `PannerNode` com `panningModel:'equalpower'` (barato) e
  `distanceModel:'linear'`, `maxDistance: 16`. **Não** usar HRTF em mobile (caro).
- **Pool de no máximo 16 vozes simultâneas.** Ao estourar, roubar a mais antiga/mais distante.
- Cada som toca com **pitch aleatório ±10%** (`playbackRate`) e volume ±10% — sem isso a
  repetição fica insuportável.

## 2. Receitas de síntese

Cada som é uma função `(ctx: OfflineAudioContext) => void` que monta um grafo. Renderizar todos
no boot leva ~50 ms e cabe em ~1 MB de RAM.

| Som | Receita |
|---|---|
| **Passo em pedra** | Ruído branco, 60 ms, bandpass 800 Hz Q=1.5, envelope de decaimento exponencial |
| **Passo em grama** | Ruído branco, 80 ms, lowpass 1200 Hz + leve highpass 300 Hz, decay mais suave |
| **Passo em areia** | Ruído rosa, 100 ms, lowpass 600 Hz |
| **Passo em madeira** | Ruído + oscilador triangular 180 Hz, 70 ms, bandpass 500 Hz |
| **Quebrar pedra** | Burst de ruído 150 ms + 3 osciladores quadrados em 200/280/390 Hz com decay rápido |
| **Quebrar madeira** | Ruído filtrado + "crack": envelope de ataque 2 ms, bandpass varrendo 1500→400 Hz |
| **Quebrar vidro** | 6 osciladores senoidais aleatórios entre 2–6 kHz, decays independentes de 100–300 ms |
| **Colocar bloco** | Versão curta (50 ms) do som de quebrar, volume 0.6 |
| **Dano no jogador** | Oscilador serra 150 Hz → 90 Hz em 200 ms, distorção suave (WaveShaper) |
| **Explosão** | Ruído marrom 1,2 s, lowpass varrendo 800→80 Hz, envelope de ataque 5 ms |
| **Água** | Ruído branco em loop, bandpass 400 Hz Q=0.7 modulado por LFO 0.3 Hz |
| **Lava** | Ruído marrom em loop + pops aleatórios (burst 30 ms, 80 Hz) |
| **Porta abrindo** | Oscilador serra 90→140 Hz em 400 ms + ruído de atrito |
| **Baú abrindo** | Ruído bandpass 1200 Hz, 250 ms, com "clique" no início |
| **Zumbi (gemido)** | 2 osciladores serra em 110 Hz e 116 Hz (batimento), vibrato LFO 5 Hz, lowpass 700 Hz, 1,2 s |
| **Esqueleto (chocalho)** | 5 bursts de ruído de 25 ms em sequência, highpass 2 kHz |
| **Creeper (chiado)** | Ruído branco com highpass varrendo 2→8 kHz em 1,5 s, crescendo |
| **Vaca/porco/ovelha** | Oscilador serra grave com envelope de pitch descendente + formante (2 bandpass em série) |
| **Galinha** | Osciladores quadrados curtos em sequência ascendente |
| **Clique de UI** | Oscilador quadrado 800 Hz, 30 ms, decay linear |
| **Coletar item** | Duas senoides em 900 Hz e 1350 Hz, 80 ms, envelope rápido |
| **Subir de nível** | Arpejo de 4 senoides (C-E-G-C), 400 ms, com reverb curto (convolver com IR gerado) |
| **Chuva** | Ruído branco em loop, lowpass 4 kHz, com LFO leve de amplitude |

## 3. Música ambiente (procedural)

Um gerador simples que já entrega o clima certo:

- **Escala:** modo lídio ou pentatônica maior em C, 3 oitavas.
- **Instrumento:** oscilador senoidal + triangular com ataque 200 ms / release 2 s, passando por
  um `ConvolverNode` com impulse response sintética (ruído com decay exponencial de 2 s).
- **Algoritmo:** a cada 4–10 s, tocar 1–3 notas escolhidas por caminhada aleatória na escala
  (passo de −2 a +2 graus), com probabilidade maior de voltar à tônica. Volume baixo (0.12).
- Toca em blocos de 60–120 s, depois silêncio de 3–8 minutos.
- **Variações de contexto:** notas mais graves e espaçadas debaixo da terra; mais agudas e rápidas
  de dia na superfície; silêncio total durante combate.

Isso custa ~80 linhas e resolve a trilha inteira.

## 4. Legendas de som (acessibilidade)

Quando ativado, cada som posicional exibe uma legenda no canto inferior direito:
`« Creeper chia »` com uma seta indicando a direção relativa. Fade em 3 s. Tamanho da fila: 3.

## 5. Regras de performance

- **Nunca** criar `AudioBuffer` no loop de jogo. Tudo pré-renderizado.
- Reusar `AudioBufferSourceNode`? Não dá (são one-shot), mas eles são baratos; o caro é o
  `PannerNode` — manter um pool de 16 e reconfigurá-los.
- Se `ctx.state === 'suspended'`, não enfileirar nada.
- Suspender o `AudioContext` quando a aba perde o foco (`visibilitychange`).
- Em T0, reduzir o pool para 8 vozes e desligar o convolver (reverb).
