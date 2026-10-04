import { describe, expect, it } from "vitest";
import { isFileQueryEnabled } from "./file-pane-enabled";

describe("isFileQueryEnabled", () => {
  const activeFile = {
    hasReadTarget: true,
    isTabActive: true,
    isAppVisible: true,
    keepsConnectionsActiveInBackground: false,
  };

  it("reads when there is a target, the tab is active, and the app is visible", () => {
    expect(isFileQueryEnabled(activeFile)).toBe(true);
  });

  it("does not read while the tab is hidden", () => {
    expect(isFileQueryEnabled({ ...activeFile, isTabActive: false })).toBe(false);
  });

  it("does not read while the app is backgrounded", () => {
    expect(isFileQueryEnabled({ ...activeFile, isAppVisible: false })).toBe(false);
  });

  it("does not read without a resolved file target", () => {
    expect(isFileQueryEnabled({ ...activeFile, hasReadTarget: false })).toBe(false);
  });

  it("keeps the current file subscribed when background execution is supported", () => {
    expect(
      isFileQueryEnabled({
        ...activeFile,
        isAppVisible: false,
        keepsConnectionsActiveInBackground: true,
      }),
    ).toBe(true);
  });

  it("releases hidden tabs even when background execution is supported", () => {
    expect(
      isFileQueryEnabled({
        ...activeFile,
        isTabActive: false,
        isAppVisible: false,
        keepsConnectionsActiveInBackground: true,
      }),
    ).toBe(false);
  });

  it("requires a file target even when background execution is supported", () => {
    expect(
      isFileQueryEnabled({
        ...activeFile,
        hasReadTarget: false,
        isAppVisible: false,
        keepsConnectionsActiveInBackground: true,
      }),
    ).toBe(false);
  });
});
