/**
 * Ler o QR do outro aparelho pela câmera (M20).
 *
 * Usa o `BarcodeDetector` do navegador, que o Chrome no Android tem. No
 * computador (Chrome no Windows e no Linux, Firefox) ele não existe: aí o
 * caminho é o código em texto (`net/base32.ts`), digitado ou colado. Um leitor
 * de QR escrito aqui entra se a prova de conexão mostrar que ele faz falta.
 */

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function detectorClass(): BarcodeDetectorClass | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
}

/** Este aparelho lê QR pela câmera? */
export async function canScan(): Promise<boolean> {
  const cls = detectorClass();
  if (cls === undefined || navigator.mediaDevices?.getUserMedia === undefined) return false;
  try {
    return (await cls.getSupportedFormats()).includes('qr_code');
  } catch {
    return false;
  }
}

/**
 * Abre a câmera traseira no `<video>` e devolve o primeiro QR lido. Para a
 * câmera ao terminar, com sucesso, erro ou cancelamento (`stop`).
 */
export async function scanQr(video: HTMLVideoElement, stop: { cancelled: boolean }): Promise<string | null> {
  const cls = detectorClass();
  if (cls === undefined) return null;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' }, audio: false,
  });
  try {
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    const detector = new cls({ formats: ['qr_code'] });
    while (!stop.cancelled) {
      const found = await detector.detect(video).catch(() => []);
      if (found.length > 0 && found[0].rawValue !== '') return found[0].rawValue;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  } finally {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}
