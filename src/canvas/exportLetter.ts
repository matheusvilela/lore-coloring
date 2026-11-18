import { type Alphabet, assetUrl, storageKey } from '../data/letters';
import { getPaint } from '../storage/db';
import { CANVAS_H, CANVAS_W } from './Painter';

export function letterPngFilename(letter: string): string {
  return `lore-${letter}.png`;
}

/** Papel branco + pintura salva + tinta, na resolução do canvas de desenho. */
export async function renderLetterPng(alphabet: Alphabet, letter: string): Promise<Blob> {
  const paintBlob = await getPaint(storageKey(alphabet, letter));
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponível');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (paintBlob) {
    const bitmap = await createImageBitmap(paintBlob);
    try {
      ctx.drawImage(bitmap, 0, 0, CANVAS_W, CANVAS_H);
    } finally {
      bitmap.close();
    }
  }

  const ink = await loadImage(assetUrl(alphabet, letter, 'ink.png'));
  ctx.drawImage(ink, 0, 0, CANVAS_W, CANVAS_H);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png');
  });
  if (!blob) throw new Error('falha ao gerar o PNG');
  return blob;
}

/**
 * No celular, a folha de compartilhar inclui "salvar imagem".
 * Nos outros casos, o navegador oferece o download do arquivo.
 * Um compartilhamento cancelado pelo usuário não cai no download.
 */
export async function offerSavePng(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });
  const canShareFiles =
    navigator.maxTouchPoints > 0 &&
    typeof navigator.share === 'function' &&
    navigator.canShare?.({ files: [file] }) === true;

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}
