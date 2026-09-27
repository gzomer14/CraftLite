/**
 * Ler o QR do outro aparelho pela câmera (M20).
 *
 * Com o `BarcodeDetector` do navegador (Chrome no Android e no macOS), é ele
 * quem lê. Sem ele — Chrome no Windows e no Linux, Firefox —, cada quadro da
 * câmera vai para um canvas e passa pelo leitor próprio (`net/qrread.ts`):
 * é o que deixa o computador ler o QR do celular pela webcam sem ninguém
 * digitar código. Sem câmera nenhuma, o caminho é o código em texto.
 */

import { readQr, toGray } from './qrread';

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

/** Intervalo entre tentativas: o leitor próprio custa dezenas de ms por quadro. */
const SCAN_EVERY_MS = 150;
/** O leitor próprio lê o quadro reduzido a esta largura, no máximo. */
const MAX_READ_WIDTH = 1280;

function detectorClass(): BarcodeDetectorClass | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
}

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const cls = detectorClass();
  if (cls === undefined) return null;
  try {
    return (await cls.getSupportedFormats()).includes('qr_code') ? new cls({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/** Este aparelho tem câmera para ler QR? (HTTPS é exigido pelo navegador.) */
export async function canScan(): Promise<boolean> {
  const media = navigator.mediaDevices;
  if (media?.getUserMedia === undefined || media.enumerateDevices === undefined) return false;
  try {
    return (await media.enumerateDevices()).some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/**
 * Abre a câmera (a traseira, se houver) no `<video>` e devolve o primeiro QR
 * lido. Para a câmera ao terminar, com sucesso, erro ou cancelamento (`stop`).
 */
export async function scanQr(video: HTMLVideoElement, stop: { cancelled: boolean }): Promise<string | null> {
  // 1280×720 quando a câmera dá: com o QR ocupando um terço do quadro, são
  // ~4,5 px por módulo, acima do que o leitor próprio precisa (doc 15 §3, M20).
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  try {
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const native = await nativeDetector();
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    while (!stop.cancelled) {
      const text = native !== null ? await readNative(native, video) : readOwn(video, canvas, g);
      if (text !== null && text !== '') return text;
      await new Promise((r) => setTimeout(r, SCAN_EVERY_MS));
    }
    return null;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}

async function readNative(detector: BarcodeDetectorLike, video: HTMLVideoElement): Promise<string | null> {
  const found = await detector.detect(video).catch(() => []);
  return found.length > 0 ? found[0].rawValue : null;
}

function readOwn(video: HTMLVideoElement, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D | null): string | null {
  if (g === null || video.videoWidth === 0) return null;
  const scale = Math.min(1, MAX_READ_WIDTH / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  g.drawImage(video, 0, 0, w, h);
  return readQr(toGray(g.getImageData(0, 0, w, h).data, w, h));
}
