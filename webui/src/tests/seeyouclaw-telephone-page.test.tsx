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
});
