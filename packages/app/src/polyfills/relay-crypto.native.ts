import { setPayloadCipher } from "@getpaseo/relay/e2ee";
import {
  crypto_secretbox_easy,
  crypto_secretbox_open_easy,
  crypto_secretbox_KEYBYTES,
  crypto_secretbox_NONCEBYTES,
} from "react-native-libsodium";

export function installRelayCrypto(): void {
  if (crypto_secretbox_KEYBYTES !== 32 || crypto_secretbox_NONCEBYTES !== 24) {
    throw new Error("Native relay crypto is unavailable; rebuild the native application");
  }
  setPayloadCipher({ seal: crypto_secretbox_easy, open: crypto_secretbox_open_easy });
}
