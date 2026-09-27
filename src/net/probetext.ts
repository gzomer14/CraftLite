/**
 * Textos da página de prova de conexão (M20.0), em português e inglês.
 *
 * Não usam `core/i18n` nem `data/strings/`: a página `rede.html` é um ponto de
 * entrada à parte, e importar um módulo do jogo o levaria para um pedaço
 * compartilhado — o jogo passaria a baixar um arquivo a mais (ver a regra do
 * M21 em `src/mods/types.ts`). Por isso este arquivo está isento da varredura
 * de idioma, como `data/strings/pt.ts`.
 */

export interface ProbeText {
  title: string;
  intro: string;
  host: string;
  guest: string;
  cameraYes: string;
  cameraNo: string;
  preparing: string;
  hostShow: string;
  code: string;
  copy: string;
  copied: string;
  hostRead: string;
  scan: string;
  cancel: string;
  paste: string;
  connect: string;
  guestRead: string;
  next: string;
  guestShow: string;
  waiting: string;
  badCode: string;
  wrongRole: string;
  connecting: string;
  connected: string;
  measuring: string;
  rtt: string;
  loss: string;
  speed: string;
  pair: string;
  failed: string;
  hints: string;
  report: string;
  reportHelp: string;
  again: string;
  closed: string;
}

export const PROBE_TEXT: Readonly<Record<'pt' | 'en', ProbeText>> = {
  pt: {
    title: 'CraftLite — teste de rede local',
    intro: 'Este teste confere se dois aparelhos na mesma rede Wi-Fi conseguem se ligar direto, sem servidor. Abra esta página nos dois. Um abre a sala; o outro entra. Nada é salvo nem enviado para fora da rede.',
    host: 'Abrir a sala (anfitrião)',
    guest: 'Entrar numa sala (convidado)',
    cameraYes: 'Este aparelho lê QR pela câmera.',
    cameraNo: 'Este aparelho não lê QR pela câmera: use o código em texto.',
    preparing: 'Preparando…',
    hostShow: '1. No outro aparelho, toque em "Entrar numa sala" e leia este QR — ou digite o código abaixo.',
    code: 'Código',
    copy: 'Copiar',
    copied: 'Copiado.',
    hostRead: '2. O outro aparelho vai mostrar um código de resposta. Leia ou cole aqui:',
    scan: 'Ler com a câmera',
    cancel: 'Parar a câmera',
    paste: 'Cole ou digite o código aqui',
    connect: 'Conectar',
    guestRead: '1. Leia o QR do anfitrião, ou cole o código dele:',
    next: 'Continuar',
    guestShow: '2. Agora o anfitrião lê este QR — ou digita o código abaixo.',
    waiting: 'Esperando o anfitrião…',
    badCode: 'Código incompleto ou com letra trocada. Confira e tente de novo.',
    wrongRole: 'Este código é do outro papel: o anfitrião lê a resposta, o convidado lê o código da sala.',
    connecting: 'Ligando os aparelhos…',
    connected: 'Conectados!',
    measuring: 'Medindo a ligação…',
    rtt: 'Ida e volta',
    loss: 'Pacotes rápidos perdidos',
    speed: 'Velocidade',
    pair: 'Caminho',
    failed: 'Os aparelhos não se ligaram.',
    hints: 'Confira: os dois estão na mesma rede Wi-Fi (não em dados móveis)? A rede é de visitante? Redes de visitante costumam isolar os aparelhos entre si. Um dos aparelhos está com VPN?',
    report: 'Relatório',
    reportHelp: 'Copie o relatório e mande de volta: é ele que diz o que funcionou.',
    again: 'Recomeçar',
    closed: 'A ligação caiu.',
  },
  en: {
    title: 'CraftLite — local network test',
    intro: 'This test checks whether two devices on the same Wi-Fi network can connect directly, with no server. Open this page on both. One opens the room; the other joins. Nothing is saved or sent outside the network.',
    host: 'Open the room (host)',
    guest: 'Join a room (guest)',
    cameraYes: 'This device reads QR codes with the camera.',
    cameraNo: 'This device cannot read QR codes with the camera: use the text code.',
    preparing: 'Preparing…',
    hostShow: '1. On the other device, tap "Join a room" and scan this QR — or type the code below.',
    code: 'Code',
    copy: 'Copy',
    copied: 'Copied.',
    hostRead: '2. The other device will show an answer code. Scan or paste it here:',
    scan: 'Scan with the camera',
    cancel: 'Stop the camera',
    paste: 'Paste or type the code here',
    connect: 'Connect',
    guestRead: '1. Scan the host QR, or paste its code:',
    next: 'Continue',
    guestShow: '2. Now the host scans this QR — or types the code below.',
    waiting: 'Waiting for the host…',
    badCode: 'Incomplete code or a mistyped letter. Check it and try again.',
    wrongRole: 'This code belongs to the other role: the host reads the answer, the guest reads the room code.',
    connecting: 'Connecting the devices…',
    connected: 'Connected!',
    measuring: 'Measuring the connection…',
    rtt: 'Round trip',
    loss: 'Fast packets lost',
    speed: 'Speed',
    pair: 'Path',
    failed: 'The devices did not connect.',
    hints: 'Check: are both on the same Wi-Fi network (not mobile data)? Is it a guest network? Guest networks usually isolate devices from each other. Is either device on a VPN?',
    report: 'Report',
    reportHelp: 'Copy the report and send it back: it tells what worked.',
    again: 'Start over',
    closed: 'The connection dropped.',
  },
};
