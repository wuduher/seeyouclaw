import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeeyouclawTelephonePage } from "@/components/seeyouclaw/SeeyouclawTelephonePage";

const cameraStart = vi.fn(async () => undefined);
const cameraStop = vi.fn();

vi.mock("@/providers/ClientProvider", () => ({
  useClient: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/useSessions", () => ({
  useSessionHistory: () => ({
    messages: [],
    hasPendingToolCalls: false,
  }),
}));

vi.mock("@/hooks/useNanobotStream", () => ({
  useNanobotStream: () => ({
    messages: [],
    isStreaming: false,
    send: vi.fn(),
    stop: vi.fn(),
    streamError: null,
    dismissStreamError: vi.fn(),
  }),
}));

vi.mock("@/hooks/seeyouclaw/useCameraSnapshot", () => ({
  useCameraSnapshot: () => ({
    capture: vi.fn(),
    error: null,
    start: cameraStart,
    state: "idle",
    stop: cameraStop,
    videoRef: { current: null },
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("SeeyouclawTelephonePage", () => {
  it("opens a nanobot-backed call session", async () => {
    const onCreateChat = vi.fn(async () => "telephone-chat");
    render(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    expect(screen.getAllByText("Telephone").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Start call" }));

    await waitFor(() => expect(onCreateChat).toHaveBeenCalledTimes(1));
    expect(cameraStart).toHaveBeenCalledTimes(1);
  });

  it("exposes mute, reset, and hangup controls during a call", async () => {
    const onCreateChat = vi.fn(async () => "telephone-chat");
    render(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start call" }));

    await waitFor(() => expect(cameraStart).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "End call" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mute microphone" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset audio" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(screen.getByRole("button", { name: "Unmute microphone" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "End call" }));

    expect(cameraStop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start call" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mute microphone" })).toBeDisabled();
  });

  it("rolls back the call controls when chat creation fails", async () => {
    const onCreateChat = vi.fn(async () => null);
    render(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start call" }));

    await waitFor(() => expect(onCreateChat).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "End call" })).not.toBeInTheDocument();
    });
    expect(cameraStart).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start call" })).toBeEnabled();
  });
});
