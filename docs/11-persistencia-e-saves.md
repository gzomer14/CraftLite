# 11 — Persistência e Saves

## 1. Onde salvar

**IndexedDB** é a única opção viável: `localStorage` tem limite de ~5 MB e é síncrono (trava o
frame). A Origin Private File System (OPFS) seria mais rápida, mas não existe em Android 7.

Banco `craftlite`, versão 1:

| Object store | Chave | Valor |
|---|---|---|
| `worlds` | `worldId` (uuid) | metadados do mundo |
| `chunks` | `[worldId, cx, cz]` | `Uint8Array` serializado |
| `players` | `[worldId, playerId]` | posição, inventário, vida, fome, XP |
| `entities` | `[worldId, cx, cz]` | mobs/itens daquele chunk |
| `settings` | `'global'` | opções do jogador (também espelhado em localStorage) |
| `thumbs` | `worldId` | Blob JPEG 128×72 |

```ts
interface WorldMeta {
  id: string; name: string;
  seed: string;              // string original digitada
  seedHash: string;          // BigInt como string
  version: number;           // versão do formato de save
  worldHeight: number;       // 128
  gameMode: 'survival'|'creative';
  difficulty: 0|1|2|3;
  time: number;              // tick do dia
  totalTicks: number;
  weather: { raining: boolean; thundering: boolean; nextChange: number };
  spawn: [number, number, number];
  gameRules: Record<string, boolean|number>;
  createdAt: number; lastPlayed: number;
  sizeBytes: number;
}
```

## 2. Formato de chunk serializado

**Só chunks modificados pelo jogador são salvos.** O resto é regenerado da seed — é o que mantém
o save pequeno. Um flag `dirty` por section marca o que mudou.

```
Header (16 bytes)
  u32  magic  = 0x434C4B31  ('CLK1')
  u8   version
  u8   sectionCount
  u16  flagsBitmap        // quais sections existem
  i32  cx
  i32  cz
  u16  reserved

Por section presente:
  u8   bitsPerBlock       // 1,2,4,8,16
  u16  paletteLen
  u16[paletteLen] palette // blockStateIds
  varint  dataLen
  u8[dataLen]  blockData  // voxels empacotados, comprimido com RLE
  u8[2048]     blockLight // opcional (flag) — pode ser recalculado
  varint  tileEntityCount
  [tile entities...]      // baú, fornalha, placa: {pos:u16, type:u8, payload}
```

**Compressão:**
1. **Paleta** (já reduz a maioria dos chunks a 4 bits/voxel).
2. **RLE** sobre os bytes empacotados (terreno tem corridas enormes de pedra e ar).
3. Se disponível, `CompressionStream('deflate-raw')` por cima — nativo, ~2× a mais, custo zero
   de bundle. `if ('CompressionStream' in window)`. Marcar no header com um flag.

Resultado típico: **1–4 KB por chunk modificado**. Um mundo bem jogado fica em 5–30 MB.

## 3. Estratégia de gravação

- **Autosave a cada 60 s** e ao sair, em transação única com todos os chunks sujos.
- **Escrita fora do frame:** usar `requestIdleCallback` (fallback `setTimeout`) e gravar no
  máximo 8 chunks por batch para não segurar a transação.
- Ao descarregar um chunk (jogador se afastou), gravar se estiver sujo e liberar a memória.
- `beforeunload` / `visibilitychange → hidden`: gravar imediatamente (o navegador pode matar a aba).
  Como IndexedDB é assíncrono e `beforeunload` não espera, **salvar posição/inventário do jogador
  também em `localStorage`** como rede de segurança (é pequeno e síncrono).
- Indicador de autosave no HUD (canto inferior direito) durante a gravação.

## 4. Cota de armazenamento

```ts
const { quota, usage } = await navigator.storage.estimate();
await navigator.storage.persist();   // pede armazenamento persistente
```
- Avisar o jogador se `usage / quota > 0.8`.
- Se a gravação falhar com `QuotaExceededError`: pausar, mostrar modal explicando e oferecer
  excluir mundos antigos.
- Em navegador anônimo, avisar que o progresso não será mantido.

## 5. Import / Export

- **Exportar mundo**: serializar tudo em um único `.clw` (ZIP simples montado em memória, ou
  concatenação com índice) e baixar via `Blob` + `<a download>`.
- **Importar**: `<input type="file">`, validar magic e versão, criar novo `worldId`.
- Isso é a única forma de o jogador levar o mundo entre aparelhos sem servidor — vale muito
  para o público-alvo.

## 6. Migração de versão

Manter uma cadeia de migradores `v1→v2→v3`. Ao abrir um mundo com `version < atual`, rodar as
migrações em sequência com uma barra de progresso. **Nunca** quebrar saves antigos silenciosamente;
se não der para migrar, abrir em modo somente-leitura e avisar.

## 7. Service Worker / offline

- Cachear o app shell (HTML, JS, CSS) com estratégia **stale-while-revalidate**.
- Versionar o cache pelo hash do build; limpar caches antigos no `activate`.
- Manifest PWA com ícones (gerados por código, ver doc 13), `display: fullscreen`,
  `orientation: landscape`, `theme_color`.
- Ao detectar nova versão, mostrar toast "Atualização disponível — recarregar".
