import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CameraPermissionScreen,
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

describe("CameraPermissionScreen", () => {
  it("calls onAllow when the allow button is tapped", () => {
    const onAllow = vi.fn();
    const { getByRole } = render(
      <CameraPermissionScreen onAllow={onAllow} onDecline={vi.fn()} />,
    );
    fireEvent.click(getByRole("button", { name: "ALLOW CAMERA" }));
    expect(onAllow).toHaveBeenCalledOnce();
  });

  it("calls onDecline when the not-now link is tapped", () => {
    const onDecline = vi.fn();
    const { getByRole } = render(
      <CameraPermissionScreen onAllow={vi.fn()} onDecline={onDecline} />,
    );
    fireEvent.click(getByRole("button", { name: "Not now" }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it("explains why the camera is needed and reassures on privacy", () => {
    const { getByText, getByRole } = render(
      <CameraPermissionScreen onAllow={vi.fn()} onDecline={vi.fn()} />,
    );
    expect(
      getByRole("heading", { name: /your camera is the detector/i }),
    ).toBeInTheDocument();
    expect(
      getByText(/watching the road through your rear camera/i),
    ).toBeInTheDocument();
    expect(getByText("ON-DEVICE")).toBeInTheDocument();
    expect(getByText(/no images ever leave your device/i)).toBeInTheDocument();
  });
});
