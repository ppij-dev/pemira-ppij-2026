import { isValidLogoPath } from "../server/lib/logo";

export const PLACEHOLDER_CANDIDATE_PHOTO = "/placeholder-candidate.png";

/**
 * Jalur foto kandidat tervalidasi (satu-asal, ekstensi gambar) atau
 * placeholder bawaan 3:4 bila photo_key kosong atau tidak aman.
 */
export function candidatePhotoSrc(photoKey: unknown): string {
  return isValidLogoPath(photoKey) ? (photoKey as string) : PLACEHOLDER_CANDIDATE_PHOTO;
}
