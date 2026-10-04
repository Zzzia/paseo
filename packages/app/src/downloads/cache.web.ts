import type { DownloadCache } from "./download-cache";

// 浏览器下载完成后文件由浏览器管理，应用没有可校验和复用的本地 URI。
export const downloadCache: DownloadCache | null = null;
