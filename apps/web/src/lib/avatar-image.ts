import {
  AVATAR_IMAGE_MAX_BYTES,
  AVATAR_IMAGE_SIZE,
  BANNER_IMAGE_HEIGHT,
  BANNER_IMAGE_MAX_BYTES,
  BANNER_IMAGE_WIDTH,
} from "@palacards/shared";

/** Au-delà, le navigateur peinerait à décoder (et ce n'est sûrement pas une photo de profil). */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Formats essayés dans l'ordre : Safari ne sait pas encoder le WebP et renvoie alors du PNG, trop lourd. */
const ENCODINGS = [
  ["image/webp", 0.86],
  ["image/jpeg", 0.86],
  ["image/webp", 0.7],
  ["image/jpeg", 0.7],
] as const;

async function decode(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  try {
    // `from-image` : une photo de téléphone prise en portrait reste droite (orientation EXIF).
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("Image illisible : essaie une photo en JPEG, PNG ou WebP.");
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new Error("Lecture de l'image impossible."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Recadre au centre aux proportions `width` × `height`, réduit à cette taille et réencode en WebP (ou JPEG)
 * sous `maxBytes`. Le réencodage retire aussi les métadonnées (position GPS d'une photo…). Renvoie du base64.
 */
async function prepareImage(file: File, width: number, height: number, maxBytes: number): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choisis un fichier image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Image trop lourde (25 Mo maximum).");
  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw new Error("Image vide.");
    const scale = Math.min(img.width / width, img.height / height);
    const sw = width * scale;
    const sh = height * scale;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Ton navigateur ne sait pas redimensionner l'image.");
    g.imageSmoothingQuality = "high";
    g.drawImage(img.source, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, width, height);
    for (const [type, quality] of ENCODINGS) {
      const blob = await toBlob(canvas, type, quality);
      if (blob && blob.type === type && blob.size <= maxBytes) return await toBase64(blob);
    }
    throw new Error("Impossible de compresser cette image.");
  } finally {
    img.close();
  }
}

/** Photo de profil : carré au centre, 256 px, prête pour PUT /me/avatar. */
export function prepareAvatar(file: File): Promise<string> {
  return prepareImage(file, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_MAX_BYTES);
}

/** Bannière : bande 4:1 au centre, 1200 × 300 px, prête pour PUT /me/banner. */
export function prepareBanner(file: File): Promise<string> {
  return prepareImage(file, BANNER_IMAGE_WIDTH, BANNER_IMAGE_HEIGHT, BANNER_IMAGE_MAX_BYTES);
}
