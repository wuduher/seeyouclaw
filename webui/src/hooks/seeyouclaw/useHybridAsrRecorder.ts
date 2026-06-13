import { useCallback, useRef } from "react";

export const TELEPHONE_HYBRID_ASR_GRACE_MS = 1_000;

const VOICE_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function normalizeHybridAsrText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function resolveHybridAsrText(
  browserText: string,
  cloudTranscribe: () => Promise<string>,
  graceMs: number = TELEPHONE_HYBRID_ASR_GRACE_MS,
): Promise<{ source: "browser" | "cloud"; text: string }> {
  const normalized = normalizeHybridAsrText(browserText);

  const cloudText = await Promise.race([
    cloudTranscribe()
      .then((value) => normalizeHybridAsrText(value))
      .catch(() => null),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), graceMs);
    }),
  ]);

  if (cloudText) return { source: "cloud", text: cloudText };
  if (normalized) return { source: "browser", text: normalized };
  return { source: "browser", text: "" };
}

interface HybridAsrRecorderOptions {
  enabled: boolean;
  onTranscribe?: (dataUrl: string, options?: { durationMs?: number }) => Promise<string>;
}

export function useHybridAsrRecorder({
  enabled,
  onTranscribe,
}: HybridAsrRecorderOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const segmentActiveRef = useRef(false);

  const hybridEnabled = Boolean(enabled && onTranscribe);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const abortSegment = useCallback(() => {
    discardRef.current = true;
    segmentActiveRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    chunksRef.current = [];
    if (!recorder || recorder.state === "inactive") return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    try {
      recorder.stop();
    } catch {
      // ignore stale recorders during teardown
    }
  }, []);

  const release = useCallback(() => {
    abortSegment();
    stopTracks();
  }, [abortSegment, stopTracks]);

  const startSegment = useCallback(async () => {
    if (!hybridEnabled || !onTranscribe) return;
    if (typeof navigator === "undefined"
      || !navigator.mediaDevices?.getUserMedia
      || typeof MediaRecorder === "undefined") {
      return;
    }

    abortSegment();
    discardRef.current = false;

    try {
      const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, mediaRecorderOptions());
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      segmentActiveRef.current = true;
    } catch {
      segmentActiveRef.current = false;
    }
  }, [abortSegment, hybridEnabled, onTranscribe]);

  const finalizeSegment = useCallback(async (browserText: string): Promise<string> => {
    const normalized = normalizeHybridAsrText(browserText);
    if (!normalized) {
      abortSegment();
      return "";
    }
    if (!hybridEnabled || !onTranscribe || !segmentActiveRef.current) {
      abortSegment();
      return normalized;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;
    segmentActiveRef.current = false;
    if (!recorder || recorder.state === "inactive") {
      chunksRef.current = [];
      return normalized;
    }

    const durationMs = Math.max(0, Date.now() - startedAtRef.current);
    const blob = await stopRecorderToBlob(recorder, chunksRef.current.splice(0));
    if (discardRef.current || !blob || blob.size === 0) {
      return normalized;
    }

    const dataUrl = await blobToDataUrl(blob);
    const resolved = await resolveHybridAsrText(
      normalized,
      () => onTranscribe(dataUrl, { durationMs }),
    );
    return resolved.text || normalized;
  }, [abortSegment, hybridEnabled, onTranscribe]);

  return {
    abortSegment,
    finalizeSegment,
    hybridEnabled,
    release,
    startSegment,
  };
}

function mediaRecorderOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const mimeType = VOICE_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : undefined;
}

function stopRecorderToBlob(
  recorder: MediaRecorder,
  chunks: BlobPart[],
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (recorder.state === "inactive") {
      resolve(chunks.length > 0
        ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
        : null);
      return;
    }
    recorder.onstop = () => {
      resolve(chunks.length > 0
        ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
        : null);
    };
    try {
      recorder.stop();
    } catch {
      resolve(null);
    }
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("invalid_data_url"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}
