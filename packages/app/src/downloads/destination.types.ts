export interface DownloadedFile {
  uri: string;
  fileName: string;
  mimeType: string;
}

export interface DownloadDestination {
  write(bytes: Uint8Array): void;
  finish(): Promise<DownloadedFile | null> | DownloadedFile | null;
  abort(): Promise<void> | void;
}

export interface DownloadDestinationInput {
  id: string;
  fileName: string;
  mimeType: string;
}
