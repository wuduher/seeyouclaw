import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeeyouclawTelephonePage } from "@/components/seeyouclaw/SeeyouclawTelephonePage";
import { ApiError, fetchSeeyouclawTelephoneSpeech } from "@/lib/api";

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
const speechApiMock = vi.hoisted(() => ({
  fetch: vi.fn(async () => ({ ok: false })),
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
      guidance_moves: ["Mirror, frame, and offer lanes"],
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
    fetchSeeyouclawTelephoneSpeech: speechApiMock.fetch,
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  streamMock.isStreaming = false;
  streamMock.messages = [];
  speechApiMock.fetch.mockResolvedValue({ ok: false });
});

type MockSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
};

function stubSpeechRecognition() {
  const recognizers: Array<{
    emit: (transcript: string, isFinal: boolean) => void;
    onend: ((event: Event) => void) | null;
    onerror: ((event: { error?: string }) => void) | null;
    onresult: ((event: MockSpeechRecognitionEvent) => void) | null;
  }> = [];
  class MockRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onend: ((event: Event) => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    onresult: ((event: MockSpeechRecognitionEvent) => void) | null = null;
    constructor() {
      recognizers.push(this);
    }
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    emit(transcript: string, isFinal: boolean) {
      this.onresult?.({
        resultIndex: 0,
        results: {
          0: {
            0: { transcript },
            isFinal,
            length: 1,
          },
          length: 1,
        },
      });
    }
  }
  vi.stubGlobal("SpeechRecognition", MockRecognition);
  return recognizers;
}

describe("SeeyouclawTelephonePage", () => {
  it("uses the nanobot theme shell", async () => {
    const onCreateChat = vi.fn(async () => "telephone-chat");
    const { container } = render(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument());
    const shell = container.firstElementChild;
    expect(shell).toHaveClass("bg-background");
    expect(shell).toHaveClass("text-foreground");
    expect(shell?.className).not.toContain("bg-[#101113]");
  });

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
    expect(screen.getByText("Mirror, frame, and offer lanes")).toBeInTheDocument();
    expect(screen.getByText("SDD questions and observation windows")).toBeInTheDocument();
  });

  it("explains when the running gateway is too old for DeepTalk project sync", async () => {
    deepTalkApiMock.ensure.mockRejectedValueOnce(new ApiError(404, "API route not found"));
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

    await waitFor(() => {
      expect(screen.getByText("Restart gateway to enable DeepTalk project sync")).toBeInTheDocument();
    });
  });

  it("waits for qwen telephone audio before falling back to browser speech", async () => {
    const playMock = vi.fn(async () => undefined);
    const pauseMock = vi.fn();
    class MockAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly src: string) {}
      pause = pauseMock;
      play = vi.fn(async () => {
        playMock(this.src);
        queueMicrotask(() => this.onended?.());
      });
    }
    const speakMock = vi.fn();
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("speechSynthesis", {
      cancel: vi.fn(),
      speak: speakMock,
    });
    vi.mocked(fetchSeeyouclawTelephoneSpeech).mockResolvedValueOnce({
      audioDataUrl: "data:audio/wav;base64,UklGRg==",
      mimeType: "audio/wav",
      ok: true,
      reason: "ok",
    });
    const onCreateChat = vi.fn(async () => "telephone-chat");
    const { rerender } = render(
      <SeeyouclawTelephonePage
        session={null}
        title="Telephone"
        onCreateChat={onCreateChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start call" }));
    await waitFor(() => expect(cameraStart).toHaveBeenCalledTimes(1));
    streamMock.messages = [
      {
        content: "我听见这里有一种复杂感受。",
        id: "assistant-audio",
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

    await waitFor(() => {
      expect(playMock).toHaveBeenCalledWith("data:audio/wav;base64,UklGRg==");
    });
    expect(speakMock).not.toHaveBeenCalled();
  });

  it("buffers incomplete speech recognition fragments before sending", async () => {
    const recognizers = stubSpeechRecognition();
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
    expect(recognizers.length).toBeGreaterThan(0);
    vi.useFakeTimers();

    act(() => {
      recognizers[0].emit("\u6211\u662f\u8bf4", true);
    });
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(streamMock.send).not.toHaveBeenCalled();

    act(() => {
      recognizers[0].emit("\u53ef\u662f\u6211\u8fd8\u662f\u4f1a\u60f3\u4ed6", true);
    });
    await act(async () => {
      vi.advanceTimersByTime(1_200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock.send).toHaveBeenCalledWith(
      "\u53ef\u662f\u6211\u8fd8\u662f\u4f1a\u60f3\u4ed6",
      undefined,
      { seeyouclawTelephone: true },
    );
  });

  it("sends short substantive speech recognition turns", async () => {
    const recognizers = stubSpeechRecognition();
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
    expect(recognizers.length).toBeGreaterThan(0);
    vi.useFakeTimers();

    act(() => {
      recognizers[0].emit("\u4e0d\u662f\u6ca1\u8d70\u51fa\u6765", true);
    });
    await act(async () => {
      vi.advanceTimersByTime(1_200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock.send).toHaveBeenCalledWith(
      "\u4e0d\u662f\u6ca1\u8d70\u51fa\u6765",
      undefined,
      { seeyouclawTelephone: true },
    );
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
