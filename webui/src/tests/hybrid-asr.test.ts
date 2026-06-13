import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveHybridAsrText,
  TELEPHONE_HYBRID_ASR_GRACE_MS,
} from "@/hooks/seeyouclaw/useHybridAsrRecorder";

describe("resolveHybridAsrText", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers cloud text when it returns within the grace window", async () => {
    const result = await resolveHybridAsrText(
      "浏览器 草稿",
      async () => "云端 准确文本",
      500,
    );

    expect(result).toEqual({
      source: "cloud",
      text: "云端 准确文本",
    });
  });

  it("falls back to browser text when cloud transcription is slow", async () => {
    vi.useFakeTimers();

    const pending = resolveHybridAsrText(
      "浏览器 草稿",
      () => new Promise<string>((resolve) => {
        window.setTimeout(() => resolve("云端 迟到"), TELEPHONE_HYBRID_ASR_GRACE_MS + 200);
      }),
      300,
    );

    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual({
      source: "browser",
      text: "浏览器 草稿",
    });
  });

  it("falls back to browser text when cloud transcription fails", async () => {
    const result = await resolveHybridAsrText(
      "浏览器 草稿",
      async () => {
        throw new Error("cloud down");
      },
      500,
    );

    expect(result).toEqual({
      source: "browser",
      text: "浏览器 草稿",
    });
  });

  it("returns empty text when both browser and cloud are blank", async () => {
    const cloudTranscribe = vi.fn(async () => "   ");
    const result = await resolveHybridAsrText("   ", cloudTranscribe, 500);

    expect(result).toEqual({ source: "browser", text: "" });
    expect(cloudTranscribe).toHaveBeenCalledTimes(1);
  });

  it("uses cloud text when browser input is blank", async () => {
    const result = await resolveHybridAsrText(
      "   ",
      async () => "云端补全",
      500,
    );

    expect(result).toEqual({
      source: "cloud",
      text: "云端补全",
    });
  });
});
