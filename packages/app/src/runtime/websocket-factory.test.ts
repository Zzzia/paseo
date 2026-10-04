import { afterEach, describe, expect, it, vi } from "vitest";
import base64 from "base64-js";

const { decode } = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("react-native-libsodium", () => ({
  from_base64: decode,
  base64_variants: { ORIGINAL: 1 },
}));

import { createAppWebSocketFactory } from "./websocket-factory.native";

interface BinaryOptions {
  headers?: Record<string, string>;
  binaryDecoder: (encoded: string) => ArrayBuffer;
}

class TestSocket {
  static supportsBinaryDecoder = true;
  readyState = 0;
  constructor(
    readonly url: string,
    readonly protocols?: string[],
    readonly options?: BinaryOptions,
  ) {}
  send() {}
  close() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  decode.mockReset();
});

describe("native WebSocket factory", () => {
  it("keeps headers and protocols scoped to the new socket", () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const first = createAppWebSocketFactory()("ws://host/ws", {
      headers: { "X-Test": "one" },
      protocols: ["paseo"],
    }) as TestSocket;
    const second = createAppWebSocketFactory()("ws://other/ws") as TestSocket;
    expect(first.url).toBe("ws://host/ws");
    expect(first.protocols).toEqual(["paseo"]);
    expect(first.options?.headers).toEqual({ "X-Test": "one" });
    expect(second.protocols).toBeUndefined();
    expect(second.options?.headers).toBeUndefined();
  });

  it.each([{ values: [] }, { values: [0, 1, 128, 255] }])(
    "preserves $values through the native decoder",
    ({ values }) => {
      vi.stubGlobal("WebSocket", TestSocket);
      const bytes = new Uint8Array(values);
      decode.mockReturnValue(bytes);
      const originalDecoder = base64.toByteArray;
      const socket = createAppWebSocketFactory()("ws://host/ws") as TestSocket;
      const encoded = base64.fromByteArray(bytes);
      expect(socket.options?.binaryDecoder(encoded)).toBe(bytes.buffer);
      expect(decode).toHaveBeenCalledExactlyOnceWith(encoded, 1);
      expect(base64.toByteArray).toBe(originalDecoder);
    },
  );

  it("propagates a decoder error without retrying JavaScript", () => {
    vi.stubGlobal("WebSocket", TestSocket);
    const failure = new Error("invalid native Base64");
    decode.mockImplementationOnce(() => {
      throw failure;
    });
    const socket = createAppWebSocketFactory()("ws://host/ws") as TestSocket;
    expect(() => socket.options?.binaryDecoder("invalid")).toThrow(failure);
    expect(decode).toHaveBeenCalledOnce();
  });

  it("requires the SDK patch before creating a connection", () => {
    vi.stubGlobal("WebSocket", vi.fn());
    expect(() => createAppWebSocketFactory()).toThrow("decoder patch is missing");
    expect(decode).not.toHaveBeenCalled();
  });
});
