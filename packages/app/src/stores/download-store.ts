import {
  createDownloadDestination,
  openDownloadedFile,
  shareDownloadedFile,
} from "@/downloads/destination";
import { saveDownload } from "@/downloads/save-download";
import { getCachedDownload } from "@/downloads/cached-download";
import { downloadCache } from "@/downloads/cache";
import { createDownloadStore } from "@/downloads/model";
import { i18n } from "@/i18n/i18next";

export const useDownloadStore = createDownloadStore({
  inspect: (input) => getCachedDownload({ ...input, cache: downloadCache }),
  save: (input) =>
    saveDownload({ ...input, cache: downloadCache, destination: createDownloadDestination }),
  open: openDownloadedFile,
  share: shareDownloadedFile,
  message: (key) => i18n.t(key),
});
