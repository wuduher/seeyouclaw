import { describe, expect, it } from "vitest";

import { decideVisionRoute } from "@/lib/seeyouclaw/visionRouter";

const BASE_OPTIONS = {
  attachedImageCount: 0,
  cameraEnabled: true,
  maxImagesPerTurn: 4,
};

describe("seeyouclaw vision router", () => {
  it("keeps ordinary chat audio-only", () => {
    const decision = decideVisionRoute("tell me a short joke", BASE_OPTIONS);

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("no_visual_need");
  });

  it("captures a snapshot for explicit visual requests", () => {
    const decision = decideVisionRoute("你看看我手里的这个是什么", BASE_OPTIONS);

    expect(decision.shouldCapture).toBe(true);
    expect(decision.level).toBe("vision_snapshot");
    expect(decision.trigger).toBe("explicit_visual_reference");
  });

  it("does not capture when the camera is disabled", () => {
    const decision = decideVisionRoute("look at this error on my screen", {
      ...BASE_OPTIONS,
      cameraEnabled: false,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("camera_disabled");
  });

  it("does not exceed the image limit", () => {
    const decision = decideVisionRoute("read this screen", {
      ...BASE_OPTIONS,
      attachedImageCount: 4,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("image_limit");
  });

  it("uses cooldown to avoid repeated camera uploads", () => {
    const decision = decideVisionRoute("what is this?", {
      ...BASE_OPTIONS,
      cooldownActive: true,
    });

    expect(decision.shouldCapture).toBe(false);
    expect(decision.trigger).toBe("cooldown");
  });
});

