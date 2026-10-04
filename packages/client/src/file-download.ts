import mime from "mime";
import { FileTransferOpcode, type FileTransferFrame } from "@getpaseo/protocol/binary-frames/index";

export interface FileDownloadMetadata {
  fileName: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  revision?: string;
}

export interface FileDownloadInput {
  cwd: string;
  path: string;
  signal?: AbortSignal;
  onStart(metadata: FileDownloadMetadata): void;
  onChunk(bytes: Uint8Array): void;
  onProgress?(bytesWritten: number, totalBytes: number): void;
}

interface Transfer {
  input: FileDownloadInput;
  metadata: FileDownloadMetadata | null;
  received: number;
  abort(): void;
  resolve(metadata: FileDownloadMetadata): void;
  reject(error: Error): void;
}

export class FileDownloads {
  private transfers = new Map<string, Transfer>();

  download(
    input: FileDownloadInput,
    requestId: string,
    send: () => void,
  ): Promise<FileDownloadMetadata> {
    if (input.signal?.aborted) return Promise.reject(new Error("Download cancelled"));
    return new Promise((resolve, reject) => {
      const transfer: Transfer = {
        input,
        metadata: null,
        received: 0,
        abort: () => this.fail(requestId, new Error("Download cancelled")),
        resolve,
        reject,
      };
      this.transfers.set(requestId, transfer);
      input.signal?.addEventListener("abort", transfer.abort, { once: true });
      try {
        send();
      } catch (error) {
        this.fail(requestId, toError(error));
      }
    });
  }

  handleFrame(frame: FileTransferFrame): boolean {
    const transfer = this.transfers.get(frame.requestId);
    if (!transfer) return false;
    try {
      switch (frame.opcode) {
        case FileTransferOpcode.FileBegin:
          this.begin(transfer, frame);
          break;
        case FileTransferOpcode.FileChunk:
          this.write(transfer, frame.payload);
          break;
        case FileTransferOpcode.FileEnd:
          this.finish(frame.requestId, transfer);
          break;
      }
    } catch (error) {
      this.fail(frame.requestId, toError(error));
    }
    return true;
  }

  fail(requestId: string, error: Error): void {
    const transfer = this.transfers.get(requestId);
    if (!transfer) return;
    this.release(requestId, transfer);
    transfer.reject(error);
  }

  failAll(error: Error): void {
    for (const requestId of this.transfers.keys()) this.fail(requestId, error);
  }

  private begin(
    transfer: Transfer,
    frame: Extract<FileTransferFrame, { metadata: unknown }>,
  ): void {
    if (
      transfer.metadata ||
      !Number.isSafeInteger(frame.metadata.size) ||
      frame.metadata.size < 0
    ) {
      throw new Error(`Invalid file download header: ${transfer.input.path}`);
    }
    const fileName = transfer.input.path.replaceAll("\\", "/").split("/").at(-1);
    if (!fileName) throw new Error(`File download path must name a file: ${transfer.input.path}`);
    transfer.metadata = {
      fileName,
      mimeType: mime.getType(fileName) ?? frame.metadata.mime,
      size: frame.metadata.size,
      modifiedAt: frame.metadata.modifiedAt,
      revision: frame.metadata.revision,
    };
    transfer.input.onStart(transfer.metadata);
    transfer.input.onProgress?.(0, transfer.metadata.size);
  }

  private write(transfer: Transfer, bytes: Uint8Array): void {
    if (!transfer.metadata || bytes.length > transfer.metadata.size - transfer.received) {
      throw new Error(`Invalid file download length: ${transfer.input.path}`);
    }
    transfer.input.onChunk(bytes);
    transfer.received += bytes.length;
    if (!transfer.input.signal?.aborted) {
      transfer.input.onProgress?.(transfer.received, transfer.metadata.size);
    }
  }

  private finish(requestId: string, transfer: Transfer): void {
    if (!transfer.metadata || transfer.received !== transfer.metadata.size) {
      throw new Error(
        `Incomplete file download: ${transfer.input.path} (${transfer.received} bytes)`,
      );
    }
    this.release(requestId, transfer);
    transfer.resolve(transfer.metadata);
  }

  private release(requestId: string, transfer: Transfer): void {
    transfer.input.signal?.removeEventListener("abort", transfer.abort);
    this.transfers.delete(requestId);
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
