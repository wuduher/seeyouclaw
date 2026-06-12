import { describe, expect, it } from "vitest";

import {
  decideVisionRoute,
  type VisionRouteContext,
} from "@/lib/seeyouclaw/visionRouter";

const BASE_OPTIONS = {
  attachedImageCount: 0,
  cameraEnabled: true,
  maxImagesPerTurn: 4,
  nowMs: 1000,
};

describe("seeyouclaw vision router", () => {
  it("keeps ordinary chat audio-only", () => {
    const decision = decideVisionRoute("tell me a short joke", BASE_OPTIONS);

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("no_visual_need");
    expect(decision.nextContext).toBeNull();
  });

  it("captures a snapshot for explicit visual requests", () => {
    const decision = decideVisionRoute("look at this object for me", BASE_OPTIONS);

    expect(decision.shouldCapture).toBe(true);
    expect(decision.level).toBe("vision_snapshot");
    expect(decision.trigger).toBe("explicit_visual_reference");
    expect(decision.nextContext?.kind).toBe("scene");
  });

  it("captures a snapshot when the user asks if the assistant can see them", () => {
    const decision = decideVisionRoute("can you see me right now", BASE_OPTIONS);

    expect(decision.shouldCapture).toBe(true);
    expect(decision.trigger).toBe("explicit_visual_reference");
  });

  it("captures a snapshot for appearance or clothing questions", () => {
    const decision = decideVisionRoute("what am i wearing now", BASE_OPTIONS);

    expect(decision.shouldCapture).toBe(true);
    expect(decision.level).toBe("vision_snapshot");
    expect(decision.trigger).toBe("appearance_query");
    expect(decision.nextContext?.kind).toBe("appearance");
  });

  it("keeps an appearance slot for contextual follow-ups", () => {
    const context: VisionRouteContext = {
      expiresAtMs: 50_000,
      kind: "appearance",
      lastTrigger: "appearance_query",
    };

    const decision = decideVisionRoute("\u73b0\u5728\u5462\uff1f", {
      ...BASE_OPTIONS,
      context,
      nowMs: 8_000,
    });

    expect(decision.shouldCapture).toBe(true);
    expect(decision.trigger).toBe("contextual_followup");
    expect(decision.bypassCooldown).toBe(true);
    expect(decision.nextContext?.kind).toBe("appearance");
    expect(decision.nextContext?.expiresAtMs).toBeGreaterThan(context.expiresAtMs);
  });

  it("does not treat follow-up wording as visual without an active slot", () => {
    const decision = decideVisionRoute("\u73b0\u5728\u5462\uff1f", {
      ...BASE_OPTIONS,
      nowMs: 8_000,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("no_visual_need");
  });

  it("treats short slot-style appearance follow-ups as visual turns", () => {
    const decision = decideVisionRoute("\u8fd9\u4e2a\u989c\u8272\u5462\uff1f", {
      ...BASE_OPTIONS,
      context: {
        expiresAtMs: 50_000,
        kind: "appearance",
        lastTrigger: "appearance_query",
      },
      nowMs: 8_000,
    });

    expect(decision.shouldCapture).toBe(true);
    expect(decision.trigger).toBe("contextual_followup");
    expect(decision.reason).toContain("appearance");
  });

  it("treats short slot-style screen follow-ups as visual turns", () => {
    const decision = decideVisionRoute("\u8fd9\u4e00\u884c\u5462\uff1f", {
      ...BASE_OPTIONS,
      context: {
        expiresAtMs: 50_000,
        kind: "screen",
        lastTrigger: "screen_or_ocr",
      },
      nowMs: 8_000,
    });

    expect(decision.shouldCapture).toBe(true);
    expect(decision.trigger).toBe("contextual_followup");
    expect(decision.reason).toContain("screen");
  });

  it("expires stale visual context", () => {
    const decision = decideVisionRoute("what about now", {
      ...BASE_OPTIONS,
      context: {
        expiresAtMs: 1_500,
        kind: "screen",
        lastTrigger: "screen_or_ocr",
      },
      nowMs: 8_000,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("no_visual_need");
    expect(decision.nextContext).toBeNull();
  });

  it("does not capture when the camera is disabled", () => {
    const decision = decideVisionRoute("look at this error on my screen", {
      ...BASE_OPTIONS,
      cameraEnabled: false,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("camera_disabled");
    expect(decision.nextContext?.kind).toBe("screen");
  });

  it("does not exceed the image limit", () => {
    const decision = decideVisionRoute("read this screen", {
      ...BASE_OPTIONS,
      attachedImageCount: 4,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("image_limit");
  });

  it("uses cooldown to avoid repeated camera uploads except for strong follow-ups", () => {
    const ordinary = decideVisionRoute("what is this?", {
      ...BASE_OPTIONS,
      cooldownActive: true,
    });
    const followup = decideVisionRoute("how about now", {
      ...BASE_OPTIONS,
      context: {
        expiresAtMs: 50_000,
        kind: "scene",
        lastTrigger: "explicit_visual_reference",
      },
      cooldownActive: true,
      nowMs: 8_000,
    });

    expect(ordinary.shouldCapture).toBe(false);
    expect(ordinary.trigger).toBe("cooldown");
    expect(followup.shouldCapture).toBe(true);
    expect(followup.trigger).toBe("contextual_followup");
  });
});
