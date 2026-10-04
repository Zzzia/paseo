import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import { createDownloadCache } from "./download-cache";

export const downloadCache = createDownloadCache({
  storage: AsyncStorage,
  fileSize(uri) {
    const file = new File(uri);
    return file.exists ? file.size : null;
  },
});
