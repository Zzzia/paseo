import type {
  WebSocketFactory,
  WebSocketLike,
} from "@getpaseo/client/internal/daemon-client-transport-types";
import { from_base64, base64_variants } from "react-native-libsodium";

interface NativeWebSocketConstructor {
  readonly supportsBinaryDecoder?: boolean;
  new (
    url: string,
    protocols?: string[],
    options?: {
      headers?: Record<string, string>;
      binaryDecoder: (encoded: string) => ArrayBuffer;
    },
  ): WebSocketLike;
}

function decodeBinary(encoded: string): ArrayBuffer {
  // RN 桥接使用标准带 padding 的 Base64；原生库返回独立的 ArrayBuffer。
  return from_base64(encoded, base64_variants.ORIGINAL).buffer as ArrayBuffer;
}

export function createAppWebSocketFactory(): WebSocketFactory {
  // 连接选项由锁定版本的 RN 补丁提供，缺失时不能静默使用慢速解码。
  const Socket = globalThis.WebSocket as unknown as NativeWebSocketConstructor;
  if (Socket.supportsBinaryDecoder !== true) {
    throw new Error(
      "Native WebSocket decoder patch is missing; install dependencies and rebuild the app",
    );
  }
  return (url, options) =>
    new Socket(url, options?.protocols, {
      headers: options?.headers,
      binaryDecoder: decodeBinary,
    });
}
