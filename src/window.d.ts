/**
 * Helper umpan balik bersama yang dipasang komponen Toast.astro dan
 * BusyButton.astro pada setiap layout. Dideklarasikan di sini supaya skrip
 * modul (mis. halaman Undangan) memakai tipe yang sama dengan skrip inline.
 */
export {};

declare global {
  interface ToastOptions {
    variant?: "success" | "error" | "info";
    /** Durasi tampil dalam milidetik; bawaan 4000 (sukses), 7000 (galat), 5000 (info). */
    duration?: number;
  }

  interface Window {
    /** Tampilkan toast; varian menentukan warna, peran ARIA dan durasi bawaan. */
    toast: (message: string, options?: ToastOptions) => HTMLElement | undefined;
    /** Tampilkan toast untuk alur yang memuat ulang halaman (?flag=1); flag dihapus dari URL sekali pakai. */
    toastFromFlag: (flag: string, message: string, options?: ToastOptions) => void;
    /** Jalankan fn dengan tombol dalam keadaan sibuk; mengembalikan undefined bila tombol sudah sibuk. */
    withBusy: <T>(button: HTMLButtonElement | null | undefined, busyLabel: string, run: () => Promise<T>) => Promise<T | undefined>;
  }
}
