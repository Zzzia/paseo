import { z } from "zod";
import { readValidatedJson, type ValidatedStorage } from "@/storage/validated-storage";
import type { DownloadedFile } from "./destination.types";

export interface DownloadSource {
  serverId: string;
  cwd: string;
  path: string;
}

const DownloadVersionSchema = z.object({
  size: z.number().int().nonnegative(),
  modifiedAt: z.string().min(1),
  revision: z.string().optional(),
});
const CachedDownloadSchema = z.object({
  file: z.object({
    uri: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
  }),
  version: DownloadVersionSchema,
});

export type DownloadVersion = z.infer<typeof DownloadVersionSchema>;
export type CachedDownload = z.infer<typeof CachedDownloadSchema>;

export interface DownloadCache {
  get(source: DownloadSource): Promise<CachedDownload | null>;
  put(source: DownloadSource, file: DownloadedFile, version: DownloadVersion): Promise<void>;
}

interface DownloadCacheDependencies {
  storage: ValidatedStorage & { setItem(key: string, value: string): Promise<void> };
  fileSize(uri: string): number | null | Promise<number | null>;
}

export function createDownloadCache(deps: DownloadCacheDependencies): DownloadCache {
  return {
    async get(source) {
      const cached = await readValidatedJson(deps.storage, cacheKey(source), CachedDownloadSchema);
      if (!cached) return null;
      const size = await deps.fileSize(cached.file.uri);
      return size === cached.version.size ? cached : null;
    },
    async put(source, file, version) {
      const cached = CachedDownloadSchema.parse({ file, version });
      const size = await deps.fileSize(file.uri);
      if (size !== cached.version.size) {
        throw new Error(`Incomplete saved download: ${source.path} (${size} bytes)`);
      }
      await deps.storage.setItem(cacheKey(source), JSON.stringify(cached));
    },
  };
}

export function sameDownloadVersion(left: DownloadVersion, right: DownloadVersion): boolean {
  return (
    left.size === right.size &&
    (left.revision ?? left.modifiedAt) === (right.revision ?? right.modifiedAt)
  );
}

function cacheKey(source: DownloadSource): string {
  return `@paseo:download-v1:${downloadSourceKey(source)}`;
}

export function downloadSourceKey(source: DownloadSource): string {
  return JSON.stringify([source.serverId, source.cwd, source.path]);
}
