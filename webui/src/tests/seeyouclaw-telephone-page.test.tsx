import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeeyouclawTelephonePage } from "@/components/seeyouclaw/SeeyouclawTelephonePage";

const cameraStart = vi.fn(async () => undefined);
const cameraStop = vi.fn();
const streamMock = vi.hoisted(() => ({
  dismissStreamError: vi.fn(),
  isStreaming: false,
  messages: [] as Array<Record<string, unknown>>,
  send: vi.fn(),
  stop: vi.fn(),
  transcribeAudio: vi.fn(async () => "cloud transcript"),
}));
const deepTalkApiMock = vi.hoisted(() => {
  const project = (overrides: Record<string, unknown> = {}) => ({
    archiveCount: 0,
    chatId: "telephone-chat",
    createdAt: "2026-06-13T00:00:00Z",
    files: {
      design: "",
      notes: "",
      proposal: "",
      spec: "",
      tasks: "",
    },
    id: "20260613-deeptalk-test",
    path: ".seeyouclaw/deeptalk/projects/20260613-deeptalk-test",
    summary: {
      current: "Current project shape",
      open_questions: ["What should this become?"],
      proactive_signals: ["SDD questions and observation windows"],
      tasks: ["Clarify the artifact."],
      why: "Research exploration",
    },
    title: "Telephone",
    turnCount: 0,
    updatedAt: "2026-06-13T00:00:00Z",
    ...overrides,
  });
  return {
    archive: vi.fn(async () => ({
      ok: true,
      project: project(),
    })),
    ensure: vi.fn(async () => ({
      ok: true,
      project: project(),
    })),
    update: vi.fn(async () => ({
      ok: true,
      project: project({ turnCount: 1 }),
    })),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchSettings: vi.fn(async () => ({
      transcription: {
        enabled: true,
        provider: "dashscope",
        provider_configured: true,
        model: "qwen3-asr-flash",
        language: "zh",
        max_duration_sec: 120,
        max_upload_mb: 25,
        providers: [],
      },
    })),
    fetchSeeyouclawTelephoneSpeech: vi.fn(async () => ({ ok: false })),
    fetchSeeyouclawVisionRoute: vi.fn(async () => ({ ok: false })),
    archiveSeeyouclawDeepTalkProject: deepTalkApiMock.archive,
    ensureSeeyouclawDeepTalkProject: deepTalkApiMock.ensure,
    updateSeeyouclawDeepTalkProject: deepTalkApiMock.update,
  };
});

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
    messages: streamMock.messages,
    isStreaming: streamMock.isStreaming,
    send: streamMock.send,
    stop: streamMock.stop,
    streamError: null,
    dismissStreamError: streamMock.dismissStreamError,
    transcribeAudio: streamMock.transcribeAudio,
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
  streamMock.isStreaming = false;
  streamMock.messages = [];
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

  it("sends DeepTalk metadata when the mode toggle is enabled", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Toggle DeepTalk mode" }));
    expect(screen.getByRole("button", { name: "Toggle DeepTalk mode" }))
      .toHaveAttribute("aria-pressed", "true");

    window.dispatchEvent(new CustomEvent("seeyouclaw-telephone-final", {
      detail: { text: "我们深入聊聊这个科研想法" },
    }));

    await waitFor(() => expect(streamMock.send).toHaveBeenCalledTimes(1));
    expect(streamMock.send).toHaveBeenCalledWith(
      "我们深入聊聊这个科研想法",
      undefined,
      {
        seeyouclawTelephone: true,
        seeyouclawDeepTalk: true,
      },
    );
    await waitFor(() => expect(deepTalkApiMock.ensure).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ chatId: "telephone-chat" }),
    ));
    await waitFor(() => expect(deepTalkApiMock.update).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({
        projectId: "20260613-deeptalk-test",
        userText: "我们深入聊聊这个科研想法",
      }),
    ));
    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Research exploration")).toBeInTheDocument();
    expect(screen.getByText("SDD questions and observation windows")).toBeInTheDocument();
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

  it("hides stop control responses from the telephone transcript", async () => {
    const onCreateChat = vi.fn(async () => "telephone-chat");
    const { rerender } = render(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start call" }));
    await waitFor(() => expect(onCreateChat).toHaveBeenCalledTimes(1));

    streamMock.messages = [
      {
        content: "No active task to stop.",
        id: "stop-ack",
        role: "assistant",
      },
    ];
    rerender(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    expect(screen.queryByText("No active task to stop.")).not.toBeInTheDocument();
  });
});
