import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// ---------------------------------------------------------------------------
// Image de l'article du jour réduite à quelques pixels côté serveur : le navigateur ne reçoit jamais
// l'original avant la fin de la partie (recherche d'image inversée impossible), et l'agrandit en flou.
// JavaScript pur (jpeg-js, pngjs) : pas de binaire natif, rien à changer à l'image Docker de l'API.
// ---------------------------------------------------------------------------

/** Garde-fous : vignettes de quelques centaines de pixels, jamais d'image géante à décoder. */
const MAX_INPUT_PIXELS = 4_000_000;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

export interface Bitmap {
  width: number;
  height: number;
  /** RVBA, 4 octets par pixel. */
  data: Uint8Array;
}

/** Décode une vignette JPEG ou PNG (null : format non géré ou image invalide). */
export function decodeImage(buf: Buffer, type: string): Bitmap | null {
  if (buf.length > MAX_INPUT_BYTES) return null;
  try {
    if (/jpe?g/i.test(type)) {
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_INPUT_PIXELS / 1e6 });
      return { width: img.width, height: img.height, data: img.data };
    }
    if (/png/i.test(type)) {
      const img = PNG.sync.read(buf);
      if (img.width * img.height > MAX_INPUT_PIXELS) return null;
      return { width: img.width, height: img.height, data: img.data };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Réduit l'image à `width` pixels de large (moyenne de chaque zone, transparence aplatie sur du gris), et
 * l'encode en PNG. Proportions gardées, au moins 1 pixel de haut.
 */
export function pixelate(img: Bitmap, width: number): Buffer {
  const w = Math.max(1, Math.min(img.width, Math.round(width)));
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const out = new PNG({ width: w, height: h, colorType: 2 });
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const a = img.data[i + 3]! / 255;
          r += img.data[i]! * a + 128 * (1 - a);
          g += img.data[i + 1]! * a + 128 * (1 - a);
          b += img.data[i + 2]! * a + 128 * (1 - a);
          n++;
        }
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(out, { colorType: 2 });
}

/** Vignette exploitable pour l'article du jour : JPEG ou PNG (pas de SVG, GIF, WebP…). */
export const pixelatableUrl = (url: string | null | undefined) =>
  !!url && /\.(jpe?g|png)$/i.test(new URL(url, "https://x").pathname);
