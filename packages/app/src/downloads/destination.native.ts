import { Directory, File, Paths, type FileHandle } from "expo-file-system";
import { requireNativeModule } from "expo-modules-core";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type {
  DownloadDestination,
  DownloadDestinationInput,
  DownloadedFile,
} from "./destination.types";

interface AndroidFileActions {
  createWriter(id: string, handle: FileHandle): void;
  writeChunk(id: string, bytes: Uint8Array): void;
  finishWriter(id: string): Promise<void>;
  abortWriter(id: string): Promise<void>;
  openFile(uri: string, mimeType: string, fileName: string): Promise<void>;
}

export function createDownloadDestination(input: DownloadDestinationInput): DownloadDestination {
  const actions =
    Platform.OS === "android" ? requireNativeModule<AndroidFileActions>("PaseoFileActions") : null;
  // 每个下载有独立目录，保留原始文件名并避免并发下载覆盖。
  const directory = new Directory(Paths.document, "downloads", input.id);
  directory.create({ intermediates: true });
  const file = new File(directory, safeFileName(input.fileName));
  file.create();
  const handle = file.open();
  try {
    actions?.createWriter(input.id, handle);
  } catch (error) {
    handle.close();
    directory.delete();
    throw error;
  }
  let closed = false;
  function close() {
    if (closed) return;
    handle.close();
    closed = true;
  }
  return {
    write(bytes) {
      if (actions) actions.writeChunk(input.id, bytes);
      else handle.writeBytes(bytes);
    },
    async finish() {
      await actions?.finishWriter(input.id);
      close();
      return { uri: file.uri, fileName: input.fileName, mimeType: input.mimeType };
    },
    async abort() {
      await actions?.abortWriter(input.id);
      close();
      // 仅删除本次失败传输新建的目录，不清理用户缓存或已有下载。
      directory.delete();
    },
  };
}

function safeFileName(name: string): string {
  const forbidden = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"]);
  const cleaned = Array.from(name, (character) =>
    forbidden.has(character) || character.charCodeAt(0) < 32 ? "_" : character,
  ).join("");
  if (!cleaned || cleaned === "." || cleaned === "..") return "download";
  return cleaned;
}

export async function openDownloadedFile(file: DownloadedFile): Promise<void> {
  if (Platform.OS !== "android") {
    await shareDownloadedFile(file);
    return;
  }
  const actions = requireNativeModule<AndroidFileActions>("PaseoFileActions");
  const uri = new File(file.uri).contentUri;
  await actions.openFile(uri, file.mimeType, file.fileName);
}

export async function shareDownloadedFile(file: DownloadedFile): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is unavailable on this device");
  }
  await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, dialogTitle: file.fileName });
}
