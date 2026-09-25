import { AVATAR_IMAGE_MAX_BYTES, AVATAR_IMAGE_SIZE } from "@palacards/shared";

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
 * Prépare une photo de profil dans le navigateur : recadrage carré au centre, réduction à 256 px,
 * réencodage en WebP (ou JPEG). Le réencodage retire aussi les métadonnées (position GPS d'une photo…).
 * Renvoie l'image en base64, prête pour PUT /me/avatar.
 */
export async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choisis un fichier image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Image trop lourde (25 Mo maximum).");
  const img = await decode(file);
  try {
    const side = Math.min(img.width, img.height);
    if (!side) throw new Error("Image vide.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_IMAGE_SIZE;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Ton navigateur ne sait pas redimensionner l'image.");
    g.imageSmoothingQuality = "high";
    g.drawImage(
      img.source,
      (img.width - side) / 2,
      (img.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_IMAGE_SIZE,
      AVATAR_IMAGE_SIZE,
    );
    for (const [type, quality] of ENCODINGS) {
      const blob = await toBlob(canvas, type, quality);
      if (blob && blob.type === type && blob.size <= AVATAR_IMAGE_MAX_BYTES) return await toBase64(blob);
    }
    throw new Error("Impossible de compresser cette image.");
  } finally {
    img.close();
  }
}
