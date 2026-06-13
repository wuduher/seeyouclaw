import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadComposer } from "@/components/thread/ThreadComposer";
import { SEEYOUCLAW_VISION_MODEL_PRESET } from "@/lib/seeyouclaw/modelRouting";

const ORIGINAL_MEDIA_DEVICES = navigator.mediaDevices;
const VIDEO_DESCRIPTORS = {
  haveCurrentData: Object.getOwnPropertyDescriptor(HTMLMediaElement, "HAVE_CURRENT_DATA"),
  readyState: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState")
    ?? Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "readyState"),
  srcObject: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject")
    ?? Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "srcObject"),
  videoHeight: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoHeight"),
  videoWidth: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoWidth"),
};

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_MEDIA_DEVICES) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: ORIGINAL_MEDIA_DEVICES,
    });
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
  restoreMediaElementConstant("HAVE_CURRENT_DATA", VIDEO_DESCRIPTORS.haveCurrentData);
  restoreVideoDescriptor("readyState", VIDEO_DESCRIPTORS.readyState);
  restoreVideoDescriptor("srcObject", VIDEO_DESCRIPTORS.srcObject);
  restoreVideoDescriptor("videoHeight", VIDEO_DESCRIPTORS.videoHeight);
  restoreVideoDescriptor("videoWidth", VIDEO_DESCRIPTORS.videoWidth);
});

describe("seeyouclaw composer loop", () => {
  it("keeps ordinary messages text-only even when the camera is ready", async () => {
    const { getUserMedia } = mockCameraReady();
    const onSend = vi.fn();
    render(<ThreadComposer onSend={onSend} placeholder="Ask anything..." />);

    fireEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
    expect(await screen.findByText("Camera ready")).toBeInTheDocument();
    markRenderedVideoReady();

    const input = screen.getByLabelText("Message input");
    fireEvent.change(input, { target: { value: "tell me a short joke" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("tell me a short joke", undefined, undefined);
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: false,
      video: expect.any(Object),
    }));
  });

  it("attaches one camera snapshot for a visual request", async () => {
    mockCameraReady();
    const onSend = vi.fn();
    render(<ThreadComposer onSend={onSend} placeholder="Ask anything..." />);

    fireEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
    expect(await screen.findByText("Camera ready")).toBeInTheDocument();
    markRenderedVideoReady();

    const input = screen.getByLabelText("Message input");
    fireEvent.change(input, { target: { value: "look at this object" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [content, images, options] = onSend.mock.calls[0];
    expect(content).toBe("look at this object");
    expect(options).toEqual({ modelPreset: SEEYOUCLAW_VISION_MODEL_PRESET });
    expect(images).toHaveLength(1);
    expect(images[0].media).toEqual({
      data_url: "data:image/jpeg;base64,c2VleW91Y2xhdw==",
      name: expect.stringMatching(/^seeyouclaw-camera-.*\.jpg$/),
    });
    expect(images[0].preview.url).toBe("data:image/jpeg;base64,c2VleW91Y2xhdw==");
    expect(await screen.findByText(/Vision snapshot: visual request/)).toBeInTheDocument();
  });

  it("uses the remote semantic router for visible object attributes", async () => {
    mockCameraReady();
    const onSend = vi.fn();
    const onRouteVisionIntent = vi.fn(async () => ({
      ok: true,
      needVision: true,
      route: "vision_snapshot" as const,
      intent: "visual_attribute",
      reason: "asks for a visible chair color",
      confidence: 0.92,
      emotionEscalation: "low" as const,
      slot: {
        kind: "scene" as const,
        subject: "chair",
        attribute: "color",
        questionType: "attribute",
      },
    }));
    render(
      <ThreadComposer
        onSend={onSend}
        onRouteVisionIntent={onRouteVisionIntent}
        placeholder="Ask anything..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
    expect(await screen.findByText("Camera ready")).toBeInTheDocument();
    markRenderedVideoReady();

    const chairQuestion = "\u6211\u7684\u6905\u5b50\u662f\u4ec0\u4e48\u989c\u8272\u7684";
    const input = screen.getByLabelText("Message input");
    fireEvent.change(input, { target: { value: chairQuestion } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onRouteVisionIntent).toHaveBeenCalledWith(expect.objectContaining({
      cameraEnabled: true,
      cooldownActive: false,
      text: chairQuestion,
    }));
    const [content, images, options] = onSend.mock.calls[0];
    expect(content).toBe(chairQuestion);
    expect(options).toEqual({ modelPreset: SEEYOUCLAW_VISION_MODEL_PRESET });
    expect(images).toHaveLength(1);
    expect(await screen.findByText(/Vision snapshot: smart route/)).toBeInTheDocument();
  });

  it("surfaces semantic router failures instead of silently hiding them", async () => {
    mockCameraReady();
    const onSend = vi.fn();
    const onRouteVisionIntent = vi.fn(async () => {
      throw new Error("router timed out");
    });
    render(
      <ThreadComposer
        onSend={onSend}
        onRouteVisionIntent={onRouteVisionIntent}
        placeholder="Ask anything..."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
    expect(await screen.findByText("Camera ready")).toBeInTheDocument();
    markRenderedVideoReady();

    const chairQuestion = "\u6211\u7684\u6905\u5b50\u662f\u4ec0\u4e48\u989c\u8272\u7684";
    const input = screen.getByLabelText("Message input");
    fireEvent.change(input, { target: { value: chairQuestion } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onRouteVisionIntent).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(chairQuestion, undefined, undefined);
    expect(await screen.findByText(/remote vision router unavailable/)).toBeInTheDocument();
  });

  it("falls back to text-only when camera capture fails", async () => {
    mockCameraFailure();
    const onSend = vi.fn();
    render(<ThreadComposer onSend={onSend} placeholder="Ask anything..." />);

    fireEvent.click(screen.getByRole("button", { name: "Turn camera on" }));
    expect(await screen.findByText("Camera unavailable")).toBeInTheDocument();

    const input = screen.getByLabelText("Message input");
    fireEvent.change(input, { target: { value: "look at my screen" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("look at my screen", undefined, undefined);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera snapshot failed. Sending text only.",
    );
  });
});

function mockCameraReady() {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(async () => ({
    getTracks: () => [{ stop: stopTrack }],
  } as unknown as MediaStream));

  installCameraMocks(getUserMedia);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/jpeg;base64,c2VleW91Y2xhdw==");

  return { getUserMedia, stopTrack };
}

function mockCameraFailure() {
  const getUserMedia = vi.fn(async () => {
    throw new Error("permission denied");
  });

  installCameraMocks(getUserMedia);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  return { getUserMedia };
}

function installCameraMocks(getUserMedia: typeof navigator.mediaDevices.getUserMedia) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(HTMLMediaElement, "HAVE_CURRENT_DATA", {
    configurable: true,
    value: 2,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() {
      return (this as HTMLMediaElement & { __srcObject?: MediaStream | null }).__srcObject ?? null;
    },
    set(value: MediaStream | null) {
      (this as HTMLMediaElement & { __srcObject?: MediaStream | null }).__srcObject = value;
    },
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 360,
  });
}

function markRenderedVideoReady() {
  const video = document.querySelector("video") as HTMLVideoElement | null;
  if (!video) throw new Error("expected camera video element");
  Object.defineProperty(video, "readyState", {
    configurable: true,
    get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    get: () => 360,
  });
}

function restoreMediaElementConstant(
  key: "HAVE_CURRENT_DATA",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(HTMLMediaElement, key, descriptor);
  } else {
    Reflect.deleteProperty(HTMLMediaElement, key);
  }
}

function restoreVideoDescriptor(
  key: "readyState" | "srcObject" | "videoHeight" | "videoWidth",
  descriptor: PropertyDescriptor | undefined,
) {
  const prototype =
    key === "readyState" || key === "srcObject"
      ? HTMLMediaElement.prototype
      : HTMLVideoElement.prototype;
  if (descriptor) {
    Object.defineProperty(prototype, key, descriptor);
  } else {
    Reflect.deleteProperty(prototype, key);
  }
}
