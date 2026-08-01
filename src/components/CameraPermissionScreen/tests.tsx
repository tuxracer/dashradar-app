import { beforeEach, describe, expect, it } from "vitest";
import {
  markCameraPromptAccepted,
  shouldShowCameraPrompt,
} from "@/components/CameraPermissionScreen";

describe("shouldShowCameraPrompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows before acceptance and never again after markCameraPromptAccepted", () => {
    expect(shouldShowCameraPrompt()).toBe(true);
    markCameraPromptAccepted();
    expect(shouldShowCameraPrompt()).toBe(false);
  });
});
