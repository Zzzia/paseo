import type { DownloadDestination, DownloadDestinationInput } from "./destination.types";

export function createDownloadDestination(input: DownloadDestinationInput): DownloadDestination {
  const chunks: ArrayBuffer[] = [];
  return {
    write(bytes) {
      chunks.push(new Uint8Array(bytes).buffer);
    },
    finish() {
      const url = URL.createObjectURL(new Blob(chunks, { type: input.mimeType }));
      chunks.length = 0;
      const link = document.createElement("a");
      link.href = url;
      link.download = input.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return null;
    },
    abort() {
      chunks.length = 0;
    },
  };
}

export async function openDownloadedFile(): Promise<void> {
  throw new Error("Open the downloaded file from your browser's downloads");
}

export async function shareDownloadedFile(): Promise<void> {
  throw new Error("Share the downloaded file from your browser's downloads");
}
