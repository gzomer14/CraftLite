/**
 * Sinalização compacta (M20, doc 12 §2).
 *
 * O WebRTC precisa que os dois lados troquem uma descrição (SDP) antes de se
 * falarem. Sem servidor, quem carrega essa descrição é a tela: um QR, ou um
 * código em texto. O SDP inteiro tem ~1 KB; o que importa nele cabe em ~100
 * bytes:
 *
 * - as credenciais ICE (`ice-ufrag`, `ice-pwd`), que autenticam os testes de
 *   conectividade;
 * - a impressão digital SHA-256 do certificado DTLS, que é o que impede alguém
 *   no meio de se passar pelo outro lado;
 * - o papel DTLS (`setup`);
 * - os candidatos: endereço e porta UDP de cada interface. Sem STUN nem TURN,
 *   só existem candidatos `host` — os endereços da própria rede local. **É isso
 *   que prende a ligação à rede local**: fora dela, não há caminho.
 *
 * Do outro lado, `sdpFromSignal` remonta um SDP mínimo, só com o canal de
 * dados, que Chrome e Firefox aceitam.
 *
 * O endereço pode vir como nome mDNS (`<uuid>.local`): o navegador esconde o
 * IP da página e o outro navegador resolve o nome na rede local. Guardamos o
 * UUID em 16 bytes.
 */

export type CandidateKind = 'ipv4' | 'ipv6' | 'mdns';

export interface Candidate {
  kind: CandidateKind;
  address: string;
  port: number;
}

export type DtlsSetup = 'actpass' | 'active' | 'passive';

export interface Signal {
  role: 'offer' | 'answer';
  ufrag: string;
  pwd: string;
  /** SHA-256 do certificado DTLS, 32 bytes. */
  fingerprint: Uint8Array;
  setup: DtlsSetup;
  candidates: Candidate[];
}

const VERSION = 1;
/** Mais que isso é interface virtual (VPN, Docker) e só alonga o código. */
const MAX_CANDIDATES = 4;
const SETUPS: readonly DtlsSetup[] = ['actpass', 'active', 'passive'];
const KINDS: readonly CandidateKind[] = ['ipv4', 'ipv6', 'mdns'];

/** Lê o que importa do SDP local, já com os candidatos reunidos. */
export function signalFromSdp(sdp: string, role: Signal['role']): Signal {
  const line = (prefix: string): string | undefined => {
    const found = sdp.split(/\r?\n/).find((l) => l.startsWith(prefix));
    return found?.slice(prefix.length).trim();
  };
  const ufrag = line('a=ice-ufrag:');
  const pwd = line('a=ice-pwd:');
  const fp = line('a=fingerprint:');
  const setup = line('a=setup:') as DtlsSetup | undefined;
  if (ufrag === undefined || pwd === undefined || fp === undefined || setup === undefined) {
    throw new Error('SDP sem credencial ICE, impressão digital ou papel DTLS');
  }
  const [algorithm, hex] = fp.split(/\s+/);
  if (algorithm.toLowerCase() !== 'sha-256' || hex === undefined) {
    throw new Error(`impressão digital não suportada: ${algorithm}`);
  }
  const fingerprint = Uint8Array.from(hex.split(':').map((h) => parseInt(h, 16)));
  if (fingerprint.length !== 32) throw new Error('impressão digital SHA-256 com tamanho errado');
  if (!SETUPS.includes(setup)) throw new Error(`papel DTLS desconhecido: ${setup}`);
  return { role, ufrag, pwd, fingerprint, setup, candidates: candidatesOf(sdp) };
}

/** Os candidatos UDP `host` do SDP, sem repetição, até `MAX_CANDIDATES`. */
export function candidatesOf(sdp: string): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of sdp.split(/\r?\n/)) {
    if (!raw.startsWith('a=candidate:')) continue;
    const parts = raw.slice('a=candidate:'.length).trim().split(/\s+/);
    // foundation componente transporte prioridade endereço porta typ tipo …
    if (parts.length < 8 || parts[1] !== '1' || parts[2].toLowerCase() !== 'udp') continue;
    if (parts[6] !== 'typ' || parts[7] !== 'host') continue;
    const address = parts[4];
    const port = Number(parts[5]);
    const kind = kindOf(address);
    if (kind === null || !(port > 0 && port < 65536)) continue;
    if (out.some((c) => c.address === address && c.port === port)) continue;
    out.push({ kind, address: kind === 'mdns' ? address.toLowerCase() : address, port });
    if (out.length === MAX_CANDIDATES) break;
  }
  return out;
}

function kindOf(address: string): CandidateKind | null {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i.test(address)) return 'mdns';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'ipv4';
  if (address.includes(':') && ipv6Bytes(address) !== null) return 'ipv6';
  return null;
}

// --- binário ---------------------------------------------------------------

export function encodeSignal(signal: Signal): Uint8Array {
  const out: number[] = [VERSION];
  out.push((signal.role === 'answer' ? 1 : 0) | (SETUPS.indexOf(signal.setup) << 1));
  pushText(out, signal.ufrag);
  pushText(out, signal.pwd);
  for (const b of signal.fingerprint) out.push(b);
  out.push(signal.candidates.length);
  for (const c of signal.candidates) {
    out.push(KINDS.indexOf(c.kind));
    const bytes = c.kind === 'ipv4' ? c.address.split('.').map(Number)
      : c.kind === 'ipv6' ? Array.from(ipv6Bytes(c.address) ?? [])
        : uuidBytes(c.address);
    for (const b of bytes) out.push(b);
    out.push(c.port >> 8, c.port & 0xff);
  }
  return Uint8Array.from(out);
}

/** O inverso de `encodeSignal`; `null` se os bytes não forem um sinal. */
export function decodeSignal(bytes: Uint8Array): Signal | null {
  let at = 0;
  const need = (n: number): boolean => at + n <= bytes.length;
  const text = (): string | null => {
    if (!need(1)) return null;
    const len = bytes[at++];
    if (!need(len)) return null;
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[at++]);
    return s;
  };
  if (!need(2) || bytes[at++] !== VERSION) return null;
  const flags = bytes[at++];
  const setup = SETUPS[(flags >> 1) & 3];
  const ufrag = text();
  const pwd = text();
  if (ufrag === null || pwd === null || setup === undefined || !need(33)) return null;
  const fingerprint = bytes.slice(at, at + 32);
  at += 32;
  const count = bytes[at++];
  const candidates: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    if (!need(1)) return null;
    const kind = KINDS[bytes[at++]];
    if (kind === undefined) return null;
    const size = kind === 'ipv4' ? 4 : 16;
    if (!need(size + 2)) return null;
    const raw = bytes.slice(at, at + size);
    at += size;
    const port = (bytes[at] << 8) | bytes[at + 1];
    at += 2;
    const address = kind === 'ipv4' ? Array.from(raw).join('.')
      : kind === 'ipv6' ? ipv6Text(raw) : uuidText(raw);
    candidates.push({ kind, address, port });
  }
  if (at !== bytes.length) return null;
  return { role: (flags & 1) === 1 ? 'answer' : 'offer', ufrag, pwd, fingerprint, setup, candidates };
}

function pushText(out: number[], s: string): void {
  out.push(s.length);
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
}

// --- SDP remontado -----------------------------------------------------------

/**
 * O SDP do **outro lado**, remontado do sinal. `mid` precisa ser o da oferta:
 * quem remonta a resposta usa o `mid` da própria oferta local.
 */
export function sdpFromSignal(signal: Signal, mid: string): string {
  const fp = Array.from(signal.fingerprint, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const lines = [
    'v=0',
    `o=- ${1000000 + Math.floor(Math.random() * 1e9)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...signal.candidates.map((c, i) =>
      `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${c.address} ${c.port} typ host generation 0`),
    'a=end-of-candidates',
    `a=ice-ufrag:${signal.ufrag}`,
    `a=ice-pwd:${signal.pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${signal.setup}`,
    `a=mid:${mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** O `mid` da seção de dados de um SDP (o Chrome usa `0`). */
export function midOf(sdp: string): string {
  return /^a=mid:(\S+)/m.exec(sdp)?.[1] ?? '0';
}

// --- endereços ---------------------------------------------------------------

function uuidBytes(address: string): number[] {
  const hex = address.slice(0, 36).replace(/-/g, '');
  const out: number[] = [];
  for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function uuidText(raw: Uint8Array): string {
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
}

/** IPv6 em 16 bytes, aceitando `::`; `null` se não for IPv6. */
export function ipv6Bytes(address: string): Uint8Array | null {
  const bare = address.split('%')[0];
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    const v = parseInt(groups[i], 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  }
  return out;
}

function ipv6Text(raw: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((raw[i] << 8) | raw[i + 1]).toString(16));
  return groups.join(':');
}
