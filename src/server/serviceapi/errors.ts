/**
 * Pesan galat sinkronisasi pemilih untuk Admin Voting, dalam Bahasa Indonesia.
 * Setiap kode `ServiceApiError` dipetakan ke status HTTP yang bermakna bagi
 * pemanggil plus satu kalimat yang menjelaskan langkah berikutnya. Pesan teknis
 * mentah disimpan di `detail` (tidak ditampilkan di antarmuka) agar log dan
 * dukungan tetap bisa menelusuri penyebabnya tanpa membocorkan rahasia.
 */
import { ServiceApiError, type ServiceApiErrorCode } from "./client";

const MESSAGES: Record<ServiceApiErrorCode, { status: number; error: string }> = {
  unauthorized: { status: 401, error: "Portal menolak permintaan: kredensial Service API tidak dikenali (401). Periksa SERVICE_API_CLIENT_ID dan SERVICE_API_CLIENT_SECRET." },
  no_grant: { status: 403, error: "Portal belum memberi izin akses data anggota untuk klien ini (403). Minta Admin Portal memberikan grant Service API." },
  permission_missing: { status: 403, error: "Klien Service API tidak punya izin membaca data anggota (403). Minta Admin Portal menambah izin baca." },
  not_found: { status: 502, error: "Alamat Service API tidak ditemukan (404). Periksa SERVICE_API_URL pada konfigurasi situs." },
  rate_limited: { status: 429, error: "Portal membatasi permintaan (429). Tunggu beberapa menit lalu coba lagi." },
  timeout: { status: 504, error: "Portal tidak menjawab dalam 10 detik (504). Periksa koneksi server lalu coba lagi." },
  invalid_response: { status: 502, error: "Jawaban portal tidak dapat dibaca (502). Coba lagi; bila berulang, laporkan ke Admin Portal." },
  http_error: { status: 502, error: "Portal mengembalikan galat saat membaca data anggota (502). Coba lagi beberapa saat." },
};

export interface SyncFailure {
  status: number;
  body: { error: string; detail?: string };
}

/** Status HTTP portal yang punya pesan sendiri, lebih dipercaya daripada kode generik. */
const BY_STATUS: Record<number, ServiceApiErrorCode> = {
  401: "unauthorized",
  403: "permission_missing",
  404: "not_found",
  429: "rate_limited",
};

/** Terjemahkan galat sinkronisasi menjadi status HTTP dan pesan Bahasa Indonesia. */
export function describeSyncFailure(error: unknown): SyncFailure {
  if (error instanceof ServiceApiError) {
    const code = (error.status !== undefined ? BY_STATUS[error.status] : undefined) ?? error.code;
    const mapped = MESSAGES[code] ?? MESSAGES.http_error;
    return { status: mapped.status, body: { error: mapped.error, detail: error.message } };
  }
  const message = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
  // Sinkronisasi hanya boleh saat pemilihan masih draf; pesannya sudah Bahasa Indonesia.
  if (status === 409) return { status: 409, body: { error: message || "Sinkronisasi hanya diizinkan saat pemilihan berstatus draf." } };
  return {
    status: 502,
    body: { error: "Sinkronisasi gagal karena kesalahan server (502). Coba lagi beberapa saat.", ...(message ? { detail: message } : {}) },
  };
}
