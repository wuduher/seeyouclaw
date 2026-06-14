import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  Brain,
  CircleHelp,
  FolderKanban,
  ListChecks,
  MessagesSquare,
  Mic,
  MicOff,
  PanelLeft,
  Phone,
  PhoneOff,
  Radio,
  RotateCcw,
  Sparkles,
  Video,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_IMAGES_PER_MESSAGE } from "@/hooks/useAttachedImages";
import { useCameraSnapshot } from "@/hooks/seeyouclaw/useCameraSnapshot";
import { useHybridAsrRecorder } from "@/hooks/seeyouclaw/useHybridAsrRecorder";
import { useNanobotStream, type SendImage } from "@/hooks/useNanobotStream";
import { useSessionHistory } from "@/hooks/useSessions";
import {
  archiveSeeyouclawDeepTalkProject,
  ensureSeeyouclawDeepTalkProject,
  fetchSeeyouclawTelephoneSpeech,
  fetchSeeyouclawVisionRoute,
  fetchSettings,
  updateSeeyouclawDeepTalkProject,
  ApiError,
  type SeeyouclawDeepTalkProject,
} from "@/lib/api";
import { supportsBrowserSpeechRecognition } from "@/lib/browserSpeechRecognition";
import {
  getBrowserSpeechRecognitionConstructor,
  type BrowserSpeechRecognition,
} from "@/lib/browserSpeechRecognition";
import { SEEYOUCLAW_VISION_MODEL_PRESET } from "@/lib/seeyouclaw/modelRouting";
import {
  decideVisionRoute,
  formatVisionRoute,
  VISION_CONTEXT_TTL_MS,
  type SeeyouclawVisionRouteResponse,
  type VisionRouteContext,
  type VisionRouteContextKind,
} from "@/lib/seeyouclaw/visionRouter";
import type { ChatSummary, UIMessage, WorkspaceScopePayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useClient } from "@/providers/ClientProvider";

type TelephoneMode =
  | "idle"
  | "connecting"
  | "listening"
  | "muted"
  | "thinking"
  | "speaking"
  | "error";

interface SeeyouclawTelephonePageProps {
  onCreateChat: (workspaceScope?: WorkspaceScopePayload | null) => Promise<string | null>;
  onToggleSidebar?: () => void;
  session: ChatSummary | null;
  title: string;
  workspaceScope?: WorkspaceScopePayload | null;
}

const CAPTURE_COOLDOWN_MS = 2_500;
const TELEPHONE_INTERIM_STABLE_MS = 750;
const TELEPHONE_VOICE = "Ethan";
const TELEPHONE_AUDIO_MODEL = "qwen3-omni-flash";
const DEEPTALK_SYNC_TEXT_LIMIT = 900;

function normalizeSpokenText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function compactDeepTalkText(text: string): string {
  const normalized = normalizeSpokenText(text);
  if (normalized.length <= DEEPTALK_SYNC_TEXT_LIMIT) return normalized;
  return `${normalized.slice(0, DEEPTALK_SYNC_TEXT_LIMIT - 1).trim()}...`;
}

function latestAssistantMessage(messages: UIMessage[]): UIMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message.role === "assistant"
      && message.kind !== "trace"
      && message.content.trim()
      && !isTelephoneControlMessage(message.content)
    ) {
      return message;
    }
  }
  return null;
}

function isTelephoneControlMessage(content: string): boolean {
  const normalized = normalizeSpokenText(content).toLowerCase();
  return normalized === "no active task to stop"
    || normalized === "no active task to stop."
    || /^stopped \d+ task\(s\)\.?$/.test(normalized);
}

function visibleCallMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((message) =>
      (message.role === "user" || message.role === "assistant")
      && message.kind !== "trace"
      && message.content.trim().length > 0,
    )
    .filter((message) =>
      message.role !== "assistant" || !isTelephoneControlMessage(message.content),
    )
    .slice(-8);
}

function contextKind(kind: string | null | undefined): VisionRouteContextKind {
  if (kind === "appearance" || kind === "emotion" || kind === "screen") return kind;
  return "scene";
}

function remoteContext(response: SeeyouclawVisionRouteResponse): VisionRouteContext {
  const slot = response.slot ?? {};
  return {
    expiresAtMs: Date.now() + VISION_CONTEXT_TTL_MS,
    kind: contextKind(slot.kind),
    lastTrigger: response.intent?.includes("context") ? "contextual_followup" : "llm_router",
    ...(slot.attribute ? { attribute: slot.attribute } : {}),
    ...(response.confidence !== undefined ? { confidence: response.confidence } : {}),
    ...(slot.questionType ? { questionType: slot.questionType } : {}),
    ...(slot.subject ? { subject: slot.subject } : {}),
  };
}

export function SeeyouclawTelephonePage({
  onCreateChat,
  onToggleSidebar,
  session,
  title,
  workspaceScope = null,
}: SeeyouclawTelephonePageProps) {
  const { token } = useClient();
  const camera = useCameraSnapshot();
  const [localChatId, setLocalChatId] = useState<string | null>(null);
  const chatId = session?.chatId ?? localChatId;
  const sessionKey = session?.key ?? (localChatId ? `websocket:${localChatId}` : null);
  const history = useSessionHistory(sessionKey);
  const {
    messages,
    isStreaming,
    send,
    stop,
    streamError,
    dismissStreamError,
    transcribeAudio,
  } = useNanobotStream(chatId, history.messages, history.hasPendingToolCalls);

  const [cloudTranscriptionReady, setCloudTranscriptionReady] = useState(false);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<TelephoneMode>("idle");
  const [deepTalkEnabled, setDeepTalkEnabled] = useState(false);
  const [deepTalkProject, setDeepTalkProject] = useState<SeeyouclawDeepTalkProject | null>(null);
  const [deepTalkStatus, setDeepTalkStatus] = useState("Project standby");
  const [deepTalkError, setDeepTalkError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [lastUserText, setLastUserText] = useState("");
  const [routeLabel, setRouteLabel] = useState("Camera standby");
  const [speechLabel, setSpeechLabel] = useState("Ready");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const activeRef = useRef(false);
  const micMutedRef = useRef(false);
  const isStreamingRef = useRef(false);
  const speakingRef = useRef(false);
  const latestSpokenAssistantIdRef = useRef<string | null>(null);
  const routeContextRef = useRef<VisionRouteContext | null>(null);
  const cooldownUntilRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const interimCommitTimerRef = useRef<number | null>(null);
  const lastCommittedUtteranceRef = useRef("");
  const playAudioFinishRef = useRef<(() => void) | null>(null);
  const deepTalkProjectRef = useRef<SeeyouclawDeepTalkProject | null>(null);
  const latestProjectAssistantIdRef = useRef<string | null>(null);
  const stopAgentRef = useRef<() => void>(() => undefined);
  const startListeningRef = useRef<(options?: { bargeIn?: boolean }) => void>(() => undefined);
  const isFinalizingUtteranceRef = useRef(false);

  const {
    abortSegment,
    finalizeSegment,
    hybridEnabled,
    release: releaseHybridAsr,
    startSegment,
  } = useHybridAsrRecorder({
    enabled: cloudTranscriptionReady,
    onTranscribe: cloudTranscriptionReady ? transcribeAudio : undefined,
  });

  const canUseSpeechRecognition = useMemo(() => supportsBrowserSpeechRecognition(), []);
  const callMessages = useMemo(() => visibleCallMessages(messages), [messages]);
  const assistant = useMemo(() => latestAssistantMessage(messages), [messages]);
  const displayTitle = title?.trim() || "seeyouclaw telephone";
  const callIdentity = deepTalkEnabled ? "deeptalk" : "seeyouclaw";

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
    if (active && isStreaming) {
      setMode("thinking");
      setSpeechLabel("Thinking");
    }
  }, [active, isStreaming]);

  useEffect(() => {
    stopAgentRef.current = stop;
  }, [stop]);

  useEffect(() => {
    deepTalkProjectRef.current = deepTalkProject;
  }, [deepTalkProject]);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings(token)
      .then((settings) => {
        if (cancelled) return;
        const transcription = settings.transcription;
        setCloudTranscriptionReady(Boolean(
          transcription?.enabled && transcription.provider_configured,
        ));
      })
      .catch(() => {
        if (!cancelled) setCloudTranscriptionReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!active) {
      if (camera.state !== "ready") setRouteLabel("Camera standby");
      return;
    }
    if (camera.state === "starting") setRouteLabel("Camera starting");
    else if (camera.state === "ready") setRouteLabel("Camera ready");
    else if (camera.state === "error") setRouteLabel("Audio only: camera unavailable");
  }, [active, camera.state]);

  const stopListening = useCallback((abort = false) => {
    if (interimCommitTimerRef.current) {
      window.clearTimeout(interimCommitTimerRef.current);
      interimCommitTimerRef.current = null;
    }
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    try {
      if (abort) recognition.abort();
      else recognition.stop();
    } catch {
      // ignore stale browser recognizers
    }
    if (abort) abortSegment();
  }, [abortSegment]);

  const dispatchUtterance = useCallback(async (text: string) => {
    if (isFinalizingUtteranceRef.current) return;
    const normalized = normalizeSpokenText(text);
    if (!normalized || normalized === lastCommittedUtteranceRef.current) return;
    isFinalizingUtteranceRef.current = true;
    lastCommittedUtteranceRef.current = normalized;
    window.setTimeout(() => {
      lastCommittedUtteranceRef.current = "";
    }, 4_000);
    stopListening();
    setInterimTranscript("");
    if (hybridEnabled) {
      setSpeechLabel("Transcribing");
    }
    try {
      const resolved = await finalizeSegment(normalized);
      if (!resolved || !activeRef.current) return;
      setLastUserText(resolved);
      window.dispatchEvent(new CustomEvent("seeyouclaw-telephone-final", {
        detail: { text: resolved },
      }));
    } finally {
      isFinalizingUtteranceRef.current = false;
    }
  }, [finalizeSegment, hybridEnabled, stopListening]);

  const stopSpeech = useCallback(() => {
    speakingRef.current = false;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    playAudioFinishRef.current?.();
    playAudioFinishRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const interruptAssistant = useCallback(() => {
    const shouldStopAgent = isStreamingRef.current;
    if (!speakingRef.current && !shouldStopAgent) return false;
    stopSpeech();
    if (shouldStopAgent) stopAgentRef.current();
    if (activeRef.current) {
      setMode("listening");
      setSpeechLabel("Listening");
    }
    return true;
  }, [stopSpeech]);

  const playAudio = useCallback(async (dataUrl: string) => {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(dataUrl);
      audioRef.current = audio;
      const finish = () => {
        if (audioRef.current === audio) audioRef.current = null;
        playAudioFinishRef.current = null;
        resolve();
      };
      playAudioFinishRef.current = finish;
      audio.onended = finish;
      audio.onerror = () => {
        playAudioFinishRef.current = null;
        reject(new Error("audio playback failed"));
      };
      void audio.play().then(() => undefined, reject);
    });
  }, []);

  const speakWithBrowser = useCallback(async (text: string) => {
    await new Promise<void>((resolve, reject) => {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
        reject(new Error("speech synthesis unavailable"));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1.03;
      utterance.pitch = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("speech synthesis failed"));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const startListening = useCallback((options?: { bargeIn?: boolean }) => {
    if (!activeRef.current || micMutedRef.current) return;
    if (!options?.bargeIn && (isStreamingRef.current || speakingRef.current)) return;
    if (recognitionRef.current) return;
    const Recognition = getBrowserSpeechRecognitionConstructor();
    if (!Recognition) {
      setMode("error");
      setError("Speech recognition unavailable");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";
    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      const interimText = interim.trim();
      setInterimTranscript(interimText);
      const normalized = finalText.trim();
      if ((interimText || normalized) && (speakingRef.current || isStreamingRef.current)) {
        interruptAssistant();
      }
      if (interimCommitTimerRef.current) {
        window.clearTimeout(interimCommitTimerRef.current);
        interimCommitTimerRef.current = null;
      }
      if (normalized) {
        void dispatchUtterance(normalized);
        return;
      }
      if (interimText) {
        interimCommitTimerRef.current = window.setTimeout(() => {
          interimCommitTimerRef.current = null;
          void dispatchUtterance(interimText);
        }, TELEPHONE_INTERIM_STABLE_MS);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      setError(event.error || "Speech recognition error");
      setMode("error");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!activeRef.current || micMutedRef.current) return;
      if (isStreamingRef.current || speakingRef.current) {
        window.setTimeout(() => startListeningRef.current({ bargeIn: true }), 350);
        return;
      }
      window.setTimeout(() => startListeningRef.current(), 350);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      void startSegment();
      if (!options?.bargeIn) {
        setMode("listening");
        setSpeechLabel(hybridEnabled ? "Listening · Hybrid ASR" : "Listening");
      }
    } catch {
      recognitionRef.current = null;
    }
  }, [dispatchUtterance, hybridEnabled, interruptAssistant, startSegment, stopListening]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const prepareVisionImage = useCallback(async (text: string): Promise<SendImage | undefined> => {
    const cooldownActive = Date.now() < cooldownUntilRef.current;
    let decision = decideVisionRoute(text, {
      attachedImageCount: 0,
      cameraEnabled: camera.state === "ready",
      context: routeContextRef.current,
      cooldownActive,
      maxImagesPerTurn: MAX_IMAGES_PER_MESSAGE,
    });

    if (
      decision.trigger === "no_visual_need"
      && camera.state === "ready"
      && !cooldownActive
    ) {
      try {
        const remote = await fetchSeeyouclawVisionRoute(token, {
          attachedImageCount: 0,
          cameraEnabled: true,
          context: decision.nextContext,
          cooldownActive,
          maxImagesPerTurn: MAX_IMAGES_PER_MESSAGE,
          text,
        });
        if (remote.ok && remote.needVision && remote.route !== "audio_only") {
          decision = {
            level: remote.route,
            nextContext: remoteContext(remote),
            reason: remote.reason || "telephone smart route",
            shouldCapture: true,
            trigger: "llm_router",
          };
        }
      } catch {
        // Local route remains the stable fallback.
      }
    }

    routeContextRef.current = decision.nextContext;
    setRouteLabel(formatVisionRoute(decision));
    if (!decision.shouldCapture) return undefined;

    try {
      const snapshot = await camera.capture({ maxWidth: 720, quality: 0.68 });
      cooldownUntilRef.current = Date.now() + CAPTURE_COOLDOWN_MS;
      return {
        media: {
          data_url: snapshot.dataUrl,
          name: snapshot.name,
        },
        preview: {
          url: snapshot.dataUrl,
          name: snapshot.name,
        },
      };
    } catch {
      setRouteLabel("Audio only: camera unavailable");
      return undefined;
    }
  }, [camera, token]);

  const ensureChat = useCallback(async (): Promise<string | null> => {
    if (chatId) return chatId;
    setMode("connecting");
    const next = await onCreateChat(workspaceScope);
    if (!next) {
      setMode("error");
      setError("Could not open call");
      return null;
    }
    setLocalChatId(next);
    return next;
  }, [chatId, onCreateChat, workspaceScope]);

  const ensureDeepTalkProject = useCallback(async (
    nextChatId: string,
    seedText?: string,
  ): Promise<SeeyouclawDeepTalkProject | null> => {
    const current = deepTalkProjectRef.current;
    if (current?.chatId === nextChatId) return current;
    setDeepTalkStatus("Project syncing");
    setDeepTalkError(null);
    try {
      const response = await ensureSeeyouclawDeepTalkProject(token, {
        chatId: nextChatId,
        title: displayTitle,
        ...(seedText ? { seedText: compactDeepTalkText(seedText) } : {}),
      });
      setDeepTalkProject(response.project);
      setDeepTalkStatus("Project live");
      return response.project;
    } catch (error) {
      setDeepTalkError(
        error instanceof ApiError && error.status === 404
          ? "Restart gateway to enable DeepTalk project sync"
          : "Project sync failed",
      );
      setDeepTalkStatus("Project offline");
      return null;
    }
  }, [displayTitle, token]);

  const updateDeepTalkProject = useCallback((payload: {
    assistantText?: string;
    chatId?: string;
    projectId?: string;
    userText?: string;
  }) => {
    const syncPayload = {
      ...payload,
      ...(payload.userText ? { userText: compactDeepTalkText(payload.userText) } : {}),
      ...(payload.assistantText ? {
        assistantText: compactDeepTalkText(payload.assistantText),
      } : {}),
    };
    void updateSeeyouclawDeepTalkProject(token, syncPayload)
      .then((response) => {
        setDeepTalkProject(response.project);
        setDeepTalkStatus("Project updated");
        setDeepTalkError(null);
      })
      .catch(() => {
        setDeepTalkError("Project update delayed");
        setDeepTalkStatus("Project offline");
      });
  }, [token]);

  const sendUtterance = useCallback(async (text: string) => {
    if (!activeRef.current || isStreamingRef.current) return;
    const nextChatId = await ensureChat();
    if (!nextChatId) return;
    setMode("thinking");
    setSpeechLabel("Thinking");
    if (deepTalkEnabled) {
      void ensureDeepTalkProject(nextChatId, text).then((project) => {
        if (project) updateDeepTalkProject({ projectId: project.id, userText: text });
      });
    }
    const image = await prepareVisionImage(text);
    send(
      text,
      image ? [image] : undefined,
      {
        seeyouclawTelephone: true,
        ...(deepTalkEnabled ? { seeyouclawDeepTalk: true } : {}),
        ...(image ? { modelPreset: SEEYOUCLAW_VISION_MODEL_PRESET } : {}),
      },
    );
  }, [
    deepTalkEnabled,
    ensureChat,
    ensureDeepTalkProject,
    prepareVisionImage,
    send,
    updateDeepTalkProject,
  ]);

  useEffect(() => {
    const onFinal = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (text) void sendUtterance(text);
    };
    window.addEventListener("seeyouclaw-telephone-final", onFinal);
    return () => window.removeEventListener("seeyouclaw-telephone-final", onFinal);
  }, [sendUtterance]);

  const speakAssistant = useCallback(async (text: string) => {
    const spokenText = normalizeSpokenText(text);
    if (!spokenText) return;
    speakingRef.current = true;
    setMode("speaking");
    setSpeechLabel("Preparing voice");
    stopListening(true);
    startListeningRef.current({ bargeIn: true });
    try {
      const cloud = await fetchSeeyouclawTelephoneSpeech(token, {
        text: spokenText,
        model: TELEPHONE_AUDIO_MODEL,
        voice: TELEPHONE_VOICE,
        format: "wav",
      }).catch(() => null);
      if (cloud?.ok && cloud.audioDataUrl) {
        setSpeechLabel("Speaking");
        await playAudio(cloud.audioDataUrl);
      } else {
        setSpeechLabel("Browser voice");
        await speakWithBrowser(spokenText);
      }
    } catch {
      try {
        setSpeechLabel("Browser voice");
        await speakWithBrowser(spokenText);
      } catch {
        setSpeechLabel("Text only");
      }
    } finally {
      speakingRef.current = false;
      audioRef.current = null;
      playAudioFinishRef.current = null;
      if (activeRef.current && !micMutedRef.current) {
        stopListening(true);
        startListeningRef.current();
      }
    }
  }, [playAudio, speakWithBrowser, stopListening, token]);

  useEffect(() => {
    if (!active || isStreaming || !assistant?.content.trim()) return;
    if (assistant.id === latestSpokenAssistantIdRef.current) return;
    latestSpokenAssistantIdRef.current = assistant.id;
    void speakAssistant(assistant.content);
  }, [active, assistant?.content, assistant?.id, isStreaming, speakAssistant]);

  useEffect(() => {
    if (!deepTalkEnabled || !assistant?.content.trim()) return;
    if (assistant.id === latestProjectAssistantIdRef.current) return;
    const project = deepTalkProjectRef.current;
    if (!project) return;
    latestProjectAssistantIdRef.current = assistant.id;
    updateDeepTalkProject({
      assistantText: assistant.content,
      projectId: project.id,
    });
  }, [assistant?.content, assistant?.id, deepTalkEnabled, updateDeepTalkProject]);

  const startCall = useCallback(async () => {
    dismissStreamError();
    setError(null);
    setActive(true);
    setMode("connecting");
    setSpeechLabel("Connecting");
    const opened = await ensureChat();
    if (!opened) {
      setActive(false);
      setSpeechLabel("Ready");
      return;
    }
    latestSpokenAssistantIdRef.current = assistant?.id ?? null;
    await camera.start();
    if (deepTalkEnabled) void ensureDeepTalkProject(opened);
    if (canUseSpeechRecognition && !micMutedRef.current) startListening();
    else if (micMutedRef.current) {
      setMode("muted");
      setSpeechLabel("Muted");
    } else {
      setMode(canUseSpeechRecognition ? "listening" : "error");
      if (!canUseSpeechRecognition) setError("Speech recognition unavailable");
    }
  }, [
    assistant?.id,
    camera,
    canUseSpeechRecognition,
    dismissStreamError,
    ensureChat,
    ensureDeepTalkProject,
    deepTalkEnabled,
    startListening,
  ]);

  const endCall = useCallback(() => {
    setActive(false);
    setMode("idle");
    setSpeechLabel("Ready");
    setMicMuted(false);
    setInterimTranscript("");
    setLastUserText("");
    stopListening(true);
    stopSpeech();
    releaseHybridAsr();
    camera.stop();
    if (isStreamingRef.current) stop();
  }, [camera, releaseHybridAsr, stop, stopListening, stopSpeech]);

  const toggleMic = useCallback(() => {
    setMicMuted((current) => {
      const next = !current;
      if (next) {
        stopListening(true);
        setMode("muted");
        setSpeechLabel("Muted");
      } else if (activeRef.current) {
        stopListening(true);
        if (speakingRef.current || isStreamingRef.current) {
          startListeningRef.current({ bargeIn: true });
        } else {
          setMode("listening");
          setSpeechLabel("Listening");
          window.setTimeout(() => startListeningRef.current(), 100);
        }
      }
      return next;
    });
  }, [stopListening]);

  const toggleDeepTalk = useCallback(() => {
    setDeepTalkEnabled((current) => {
      const next = !current;
      if (next) {
        setDeepTalkStatus("Project standby");
        setDeepTalkError(null);
        if (chatId) void ensureDeepTalkProject(chatId);
      }
      return next;
    });
  }, [chatId, ensureDeepTalkProject]);

  const archiveDeepTalk = useCallback(async () => {
    const project = deepTalkProjectRef.current;
    if (!project) return;
    setDeepTalkStatus("Archiving");
    setDeepTalkError(null);
    try {
      const response = await archiveSeeyouclawDeepTalkProject(token, { projectId: project.id });
      setDeepTalkProject(response.project);
      setDeepTalkStatus(response.archivePath ? "Archived snapshot" : "Archived");
    } catch {
      setDeepTalkError("Archive failed");
      setDeepTalkStatus("Project offline");
    }
  }, [token]);

  useEffect(() => {
    return () => {
      stopListening(true);
      stopSpeech();
      releaseHybridAsr();
      camera.stop();
    };
  }, [camera.stop, releaseHybridAsr, stopListening, stopSpeech]);

  const streamErrorText = streamError
    ? (streamError.kind === "message_too_big" ? "Message too large" : "Workspace rejected")
    : null;
  const statusText = error || streamErrorText || speechLabel;
  const liveText = interimTranscript || lastUserText || callIdentity;
  const pulseActive = active && (mode === "listening" || mode === "speaking" || isStreaming);
  const ambientMotion = mode === "idle" || mode === "connecting" || mode === "muted";
  const levels = mode === "speaking"
    ? [26, 42, 32, 54, 38, 48, 28]
    : mode === "listening"
      ? [18, 28, 42, 34, 50, 30, 22]
      : mode === "muted"
        ? [8, 10, 8, 12, 8, 10, 8]
      : [12, 16, 14, 20, 16, 14, 12];

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/95 px-3 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {onToggleSidebar ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Toggle sidebar"
              onClick={onToggleSidebar}
              className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/65 hover:text-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{displayTitle}</div>
            <div className="truncate text-xs text-muted-foreground">{routeLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radio className={cn("h-4 w-4", pulseActive && "animate-pulse text-emerald-500")} />
          <span className="hidden sm:inline">{statusText}</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-0 overflow-hidden bg-muted/35">
          <video
            ref={camera.videoRef}
            className={cn(
              "h-full w-full bg-muted object-cover",
              camera.state !== "ready" && "opacity-20 dark:opacity-35",
            )}
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/10 via-transparent to-background/75" />
          <div className="absolute left-1/2 top-1/2 flex h-52 w-52 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <div
              className={cn(
                "absolute h-36 w-36 rounded-full border border-emerald-500/30",
                pulseActive && "animate-ping",
                ambientMotion && "motion-safe:animate-pulse",
              )}
            />
            <div
              className={cn(
                "absolute h-48 w-48 rounded-full border border-sky-500/15",
                (mode === "speaking" || ambientMotion) && "motion-safe:animate-pulse",
              )}
            />
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-border/70 bg-card/85 shadow-[0_18px_55px_rgba(15,23,42,0.16)] backdrop-blur dark:shadow-[0_22px_55px_rgba(0,0,0,0.34)]">
              {mode === "speaking" ? (
                <Volume2 className="h-9 w-9 text-emerald-500" />
              ) : (
                <Phone className="h-9 w-9 text-foreground/85" />
              )}
            </div>
          </div>

          <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-end gap-1 rounded-full border border-border/70 bg-card/85 px-4 py-3 shadow-[0_14px_38px_rgba(15,23,42,0.10)] backdrop-blur dark:shadow-[0_18px_38px_rgba(0,0,0,0.30)]">
            {levels.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={cn(
                  "w-1.5 rounded-full bg-emerald-500/85 transition-all duration-300",
                  (pulseActive || ambientMotion) && "motion-safe:animate-pulse",
                )}
                style={{ height, animationDelay: `${index * 90}ms` }}
              />
            ))}
          </div>

          <div className="absolute inset-x-4 bottom-4 flex flex-col gap-3 sm:inset-x-8">
            <div className="min-h-10 rounded-md border border-border/70 bg-card/88 px-4 py-2 text-center text-sm text-foreground/85 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur dark:shadow-[0_14px_30px_rgba(0,0,0,0.26)]">
              {liveText}
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
                onClick={toggleMic}
                disabled={!active}
                className="h-11 w-11 rounded-full border border-border/70 bg-card/90 text-foreground shadow-[0_8px_22px_rgba(15,23,42,0.08)] hover:bg-muted/70"
              >
                {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-label="Toggle DeepTalk mode"
                aria-pressed={deepTalkEnabled}
                onClick={toggleDeepTalk}
                className={cn(
                  "h-11 min-w-[112px] rounded-full px-3 text-xs font-semibold shadow-[0_8px_22px_rgba(15,23,42,0.08)]",
                  deepTalkEnabled
                    ? "bg-sky-500 text-white hover:bg-sky-600 dark:bg-sky-300 dark:text-slate-950 dark:hover:bg-sky-200"
                    : "border border-border/70 bg-card/90 text-foreground hover:bg-muted/70",
                )}
              >
                <Brain className="mr-2 h-4 w-4" />
                DEEPTALK
              </Button>
              {active ? (
                <Button
                  type="button"
                  aria-label="End call"
                  onClick={endCall}
                  className="h-12 w-12 rounded-full bg-red-500 px-0 text-white hover:bg-red-400"
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  type="button"
                  aria-label="Start call"
                  onClick={startCall}
                  className="h-12 w-12 rounded-full bg-emerald-500 px-0 text-white hover:bg-emerald-400"
                >
                  <Phone className="h-5 w-5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Reset audio"
                onClick={interruptAssistant}
                disabled={!active}
                className="h-11 w-11 rounded-full border border-border/70 bg-card/90 text-foreground shadow-[0_8px_22px_rgba(15,23,42,0.08)] hover:bg-muted/70"
              >
                <RotateCcw className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        <aside className="min-h-0 border-t border-border/60 bg-background lg:border-l lg:border-t-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/95 px-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Video className="h-4 w-4 text-amber-500" />
                <span>{deepTalkEnabled ? "DeepTalk" : "Telephone"}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {chatId ? (deepTalkEnabled ? deepTalkStatus : "Nanobot context") : "Standby"}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/20 px-4 py-4">
              {deepTalkEnabled ? (
                <div className="space-y-3 rounded-md border border-sky-500/20 bg-sky-500/[0.055] p-3 dark:border-sky-300/20 dark:bg-sky-300/[0.08]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-sky-700/85 dark:text-sky-200/85">
                        <FolderKanban className="h-3.5 w-3.5" />
                        Project
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold text-foreground">
                        {deepTalkProject?.title ?? displayTitle}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {deepTalkProject?.path ?? "Preparing workspace"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Archive DeepTalk project"
                      onClick={archiveDeepTalk}
                      disabled={!deepTalkProject}
                      className="h-8 w-8 shrink-0 rounded-full border border-border/60 bg-background/75 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>

                  {deepTalkError ? (
                    <div className="rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                      {deepTalkError}
                    </div>
                  ) : null}

                  <div className="space-y-2 text-xs leading-5 text-foreground/75">
                    <div className="border-t border-border/55 pt-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                        Why
                      </div>
                      <div className="line-clamp-3 break-words">
                        {deepTalkProject?.summary.why || "Waiting for a focused opening."}
                      </div>
                    </div>
                    <div className="border-t border-border/55 pt-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                        Current
                      </div>
                      <div className="line-clamp-3 break-words">
                        {deepTalkProject?.summary.current || "No project turn synced yet."}
                      </div>
                    </div>
                    <div className="border-t border-border/55 pt-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                        <CircleHelp className="h-3 w-3" />
                        Questions
                      </div>
                      <div className="space-y-1">
                        {(deepTalkProject?.summary.open_questions?.slice(0, 3) ?? [
                          "What concrete outcome should this DeepTalk produce?",
                        ]).map((item) => (
                          <div key={item} className="line-clamp-2 break-words">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-border/55 pt-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                        <MessagesSquare className="h-3 w-3" />
                        Moves
                      </div>
                      <div className="space-y-1">
                        {(deepTalkProject?.summary.guidance_moves?.slice(0, 3) ?? [
                          "Mirror, frame, offer lanes, and close with one question.",
                        ]).map((item) => (
                          <div key={item} className="line-clamp-2 break-words">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-border/55 pt-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                        <Sparkles className="h-3 w-3" />
                        Signals
                      </div>
                      <div className="space-y-1">
                        {(deepTalkProject?.summary.proactive_signals?.slice(0, 3) ?? [
                          "SDD questions, empathy, observation windows, and hooks.",
                        ]).map((item) => (
                          <div key={item} className="line-clamp-2 break-words">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-border/55 pt-2">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                        <ListChecks className="h-3 w-3" />
                        Tasks
                      </div>
                      <div className="space-y-1">
                        {(deepTalkProject?.summary.tasks?.slice(0, 3) ?? [
                          "Clarify the main question.",
                        ]).map((item) => (
                          <div key={item} className="line-clamp-2 break-words">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/55 pt-2 text-[11px] text-muted-foreground">
                    <span>{deepTalkProject?.turnCount ?? 0} turns</span>
                    <span>{deepTalkProject?.archiveCount ?? 0} archives</span>
                  </div>
                </div>
              ) : null}
              {callMessages.length === 0 ? (
                <div className="rounded-md border border-border/60 bg-background/70 px-3 py-3 text-sm text-muted-foreground">
                  {canUseSpeechRecognition ? "Ready" : "Mic unavailable"}
                </div>
              ) : (
                callMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm leading-6",
                      message.role === "user"
                        ? "border-emerald-500/20 bg-emerald-500/[0.075] text-emerald-800 dark:text-emerald-100"
                        : "border-amber-500/20 bg-amber-500/[0.075] text-amber-800 dark:text-amber-100",
                    )}
                  >
                    <div className="mb-1 text-[11px] uppercase text-muted-foreground">
                      {message.role === "user" ? "You" : callIdentity}
                    </div>
                    <div className="line-clamp-5 whitespace-pre-wrap break-words">
                      {message.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
