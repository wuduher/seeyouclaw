export type VisionRouteLevel = "audio_only" | "vision_snapshot" | "vision_burst";

export type VisionRouteTrigger =
  | "appearance_query"
  | "camera_disabled"
  | "contextual_followup"
  | "cooldown"
  | "emotion_shift"
  | "explicit_visual_reference"
  | "image_limit"
  | "implicit_deixis"
  | "llm_router"
  | "manual_attachment"
  | "no_visual_need"
  | "screen_or_ocr";

export type VisionRouteContextKind = "appearance" | "emotion" | "scene" | "screen";

export interface VisionRouteContext {
  attribute?: string | null;
  confidence?: number;
  expiresAtMs: number;
  kind: VisionRouteContextKind;
  lastTrigger: VisionRouteTrigger;
  questionType?: string | null;
  subject?: string | null;
}

export interface VisionRouteOptions {
  attachedImageCount: number;
  cameraEnabled: boolean;
  context?: VisionRouteContext | null;
  cooldownActive?: boolean;
  maxImagesPerTurn: number;
  nowMs?: number;
}

export interface VisionRouteDecision {
  bypassCooldown?: boolean;
  level: VisionRouteLevel;
  nextContext: VisionRouteContext | null;
  reason: string;
  shouldCapture: boolean;
  trigger: VisionRouteTrigger;
}

export interface SeeyouclawVisionRouteRequest {
  attachedImageCount: number;
  cameraEnabled: boolean;
  context?: VisionRouteContext | null;
  cooldownActive: boolean;
  maxImagesPerTurn: number;
  text: string;
}

export interface SeeyouclawVisionRouteSlot {
  attribute?: string | null;
  kind?: VisionRouteContextKind | null;
  questionType?: string | null;
  subject?: string | null;
}

export interface SeeyouclawVisionRouteResponse {
  bypassCooldown?: boolean;
  confidence?: number;
  emotionEscalation?: "low" | "medium" | "high";
  intent?: string;
  model?: string;
  needVision: boolean;
  ok: boolean;
  reason?: string;
  route: VisionRouteLevel;
  slot?: SeeyouclawVisionRouteSlot | null;
}

interface PendingVisionIntent {
  attribute?: string | null;
  bypassCooldown?: boolean;
  confidence?: number;
  contextKind: VisionRouteContextKind;
  level: VisionRouteLevel;
  questionType?: string | null;
  reason: string;
  shouldCapture: boolean;
  subject?: string | null;
  trigger: VisionRouteTrigger;
}

export const VISION_CONTEXT_TTL_MS = 45_000;
const SHORT_FOLLOWUP_MAX_CHARS = 32;

function zhPattern(source: string): RegExp {
  return new RegExp(source);
}

const EXPLICIT_VISUAL_PATTERNS: RegExp[] = [
  /(^|\s)(look|see|watch|inspect|check|show)\b/i,
  /\b(camera|webcam|photo|picture|image|video|visible)\b/i,
  /\b(can you see|do you see|see me|look at me)\b/i,
  zhPattern(
    "\\u770b\\u770b|\\u770b\\u4e00\\u4e0b|\\u770b\\u4e0b|\\u4f60\\u770b|"
      + "\\u62cd\\u4e00\\u4e0b|\\u6444\\u50cf\\u5934|\\u955c\\u5934|\\u753b\\u9762|"
      + "\\u56fe\\u7247|\\u7167\\u7247|\\u89c6\\u9891|\\u89c6\\u89c9|\\u89c2\\u5bdf",
  ),
  zhPattern(
    "\\u80fd\\u770b\\u5230|\\u770b\\u5f97\\u89c1|\\u770b\\u5f97\\u5230|"
      + "\\u80fd\\u5426\\u770b\\u5230|\\u4f60\\u80fd\\u770b\\u5230|"
      + "\\u770b\\u5230\\u6211|\\u770b\\u89c1\\u6211",
  ),
];

const APPEARANCE_PATTERNS: RegExp[] = [
  /\b(what am i wearing|what.*wearing|my outfit|how do i look)\b/i,
  zhPattern(
    "\\u7a7f\\u5565|\\u7a7f\\u4ec0\\u4e48|\\u4ec0\\u4e48\\u8863\\u670d|"
      + "\\u7a7f\\u4ec0\\u4e48\\u8863\\u670d|\\u6211\\u7a7f|"
      + "\\u7a7f\\u7740\\u4ec0\\u4e48|\\u7a7f\\u7740\\u5565|\\u7a7f\\u7740\\u600e\\u6837",
  ),
  zhPattern(
    "\\u6253\\u626e|\\u7740\\u88c5|\\u5916\\u8c8c|\\u957f\\u76f8|"
      + "\\u957f\\u4ec0\\u4e48\\u6837|\\u4ec0\\u4e48\\u6837\\u5b50|\\u5565\\u6837",
  ),
];

const SCREEN_OR_OCR_PATTERNS: RegExp[] = [
  /\b(screen|display|monitor|error|ocr|text on|read this)\b/i,
  zhPattern(
    "\\u5c4f\\u5e55|\\u663e\\u793a\\u5668|\\u62a5\\u9519|\\u9519\\u8bef\\u4fe1\\u606f|"
      + "\\u4ee3\\u7801|\\u8bfb\\u4e00\\u4e0b|\\u8bc6\\u522b\\u6587\\u5b57|"
      + "\\u8fd9\\u6bb5\\u6587\\u5b57|\\u8fd9\\u4e2a\\u5b57",
  ),
];

const CONTEXTUAL_FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(and now|how about now|what about now|what about this|and this|now then)\b/i,
  zhPattern(
    "\\u73b0\\u5728\\u5462|\\u90a3\\u73b0\\u5728\\u5462|\\u8fd9\\u4e0b\\u5462|"
      + "\\u8fd9\\u6837\\u5462|\\u90a3\\u8fd9\\u6837\\u5462|\\u73b0\\u5728\\u600e\\u4e48\\u6837|"
      + "\\u8fd9\\u6b21\\u5462|\\u8fd9\\u56de\\u5462",
  ),
];

const REFRESH_FOLLOWUP_PATTERNS: RegExp[] = [
  /\b(and now|how about now|what about now)\b/i,
  zhPattern("\\u73b0\\u5728\\u5462|\\u90a3\\u73b0\\u5728\\u5462|\\u73b0\\u5728\\u600e\\u4e48\\u6837"),
];

const SLOT_DEICTIC_PATTERNS: RegExp[] = [
  /\b(this one|that one|this part|that part|same one|same thing)\b/i,
  zhPattern(
    "\\u8fd9\\u4e2a\\u5462|\\u90a3\\u4e2a\\u5462|\\u8fd9\\u4e2a\\u600e\\u4e48\\u6837|"
      + "\\u90a3\\u4e2a\\u600e\\u4e48\\u6837|\\u8fd9\\u6b21\\u53ef\\u4ee5\\u5417|"
      + "\\u8fd9\\u6837\\u53ef\\u4ee5\\u5417|\\u8fd9\\u4e2a\\u53ef\\u4ee5\\u5417|"
      + "\\u90a3\\u8fd9\\u4e2a\\u5462|\\u8fd9\\u90e8\\u5206\\u5462|\\u90a3\\u90e8\\u5206\\u5462",
  ),
];

const APPEARANCE_SLOT_PATTERNS: RegExp[] = [
  /\b(color|style|fit|matching|match|look now|better now|this outfit)\b/i,
  zhPattern(
    "\\u989c\\u8272|\\u642d\\u914d|\\u6b3e\\u5f0f|\\u5408\\u9002|\\u5408\\u4e0d\\u5408\\u9002|"
      + "\\u597d\\u770b\\u5417|\\u8fd9\\u8eab|\\u8fd9\\u5957|\\u8fd9\\u4ef6|\\u6362\\u8fd9\\u4ef6|"
      + "\\u8fd9\\u4e2a\\u989c\\u8272|\\u73b0\\u5728\\u8fd9\\u6837",
  ),
];

const SCREEN_SLOT_PATTERNS: RegExp[] = [
  /\b(this line|that line|this error|that error|read this part|button|dialog|popup)\b/i,
  zhPattern(
    "\\u8fd9\\u4e00\\u884c|\\u90a3\\u4e00\\u884c|\\u8fd9\\u4e2a\\u62a5\\u9519|\\u90a3\\u4e2a\\u62a5\\u9519|"
      + "\\u8fd9\\u6bb5|\\u90a3\\u6bb5|\\u8fd9\\u4e2a\\u6309\\u94ae|\\u5f39\\u7a97|"
      + "\\u8fd9\\u91cc\\u5199\\u4e86\\u4ec0\\u4e48|\\u8fd9\\u884c\\u662f\\u4ec0\\u4e48",
  ),
];

const SCENE_SLOT_PATTERNS: RegExp[] = [
  /\b(closer|zoom in|left side|right side|behind me|next to me|this item)\b/i,
  zhPattern(
    "\\u9760\\u8fd1\\u4e00\\u70b9|\\u653e\\u5927\\u4e00\\u70b9|\\u5de6\\u8fb9|\\u53f3\\u8fb9|"
      + "\\u540e\\u9762|\\u65c1\\u8fb9|\\u8fd9\\u4e2a\\u4e1c\\u897f|\\u8fd9\\u4e2a\\u7269\\u4ef6",
  ),
];

const EMOTION_SLOT_PATTERNS: RegExp[] = [
  /\b(better now|calmer now|do i look okay|am i still)\b/i,
  zhPattern(
    "\\u597d\\u70b9\\u4e86\\u5417|\\u73b0\\u5728\\u8fd8\\u597d\\u5417|\\u6211\\u770b\\u8d77\\u6765\\u8fd8\\u884c\\u5417|"
      + "\\u8fd8\\u5f88\\u7d27\\u5f20\\u5417|\\u73b0\\u5728\\u597d\\u4e00\\u70b9\\u5417",
  ),
];

const IMPLICIT_DEIXIS_PATTERNS: RegExp[] = [
  /\b(this|that|here|there|these|those|it)\b/i,
  zhPattern(
    "\\u8fd9\\u4e2a|\\u90a3\\u4e2a|\\u8fd9\\u91cc|\\u90a3\\u91cc|\\u8fd9\\u8fb9|"
      + "\\u90a3\\u8fb9|\\u8fd9\\u6837|\\u8fd9\\u662f\\u4ec0\\u4e48|"
      + "\\u5b83\\u662f\\u4ec0\\u4e48|\\u624b\\u91cc|\\u684c\\u4e0a",
  ),
];

const EMOTION_SHIFT_PATTERNS: RegExp[] = [
  /\b(panic|scared|afraid|anxious|urgent|help me|stuck|confused)\b/i,
  zhPattern(
    "\\u5d29\\u4e86|\\u6025\\u6b7b|\\u5bb3\\u6015|\\u614c|\\u7126\\u8651|"
      + "\\u4e0d\\u884c\\u4e86|\\u6551\\u547d|\\u5361\\u4f4f\\u4e86|"
      + "\\u770b\\u4e0d\\u61c2|\\u600e\\u4e48\\u529e",
  ),
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function activeContext(
  context: VisionRouteContext | null | undefined,
  nowMs: number,
): VisionRouteContext | null {
  if (!context) return null;
  return context.expiresAtMs > nowMs ? context : null;
}

function isShortFollowup(text: string): boolean {
  return text.length > 0 && text.length <= SHORT_FOLLOWUP_MAX_CHARS;
}

function slotFollowupPatterns(kind: VisionRouteContextKind): RegExp[] {
  switch (kind) {
    case "appearance":
      return APPEARANCE_SLOT_PATTERNS;
    case "screen":
      return SCREEN_SLOT_PATTERNS;
    case "emotion":
      return EMOTION_SLOT_PATTERNS;
    case "scene":
    default:
      return SCENE_SLOT_PATTERNS;
  }
}

function detectContextualFollowup(
  text: string,
  context: VisionRouteContext | null,
): PendingVisionIntent | null {
  if (!context) return null;
  const shortFollowup = isShortFollowup(text);
  const refreshFollowup = matchesAny(text, REFRESH_FOLLOWUP_PATTERNS);
  const generalFollowup = matchesAny(text, CONTEXTUAL_FOLLOWUP_PATTERNS);
  const slotSpecificFollowup = matchesAny(text, slotFollowupPatterns(context.kind));
  const deicticSlotFollowup = shortFollowup && matchesAny(text, SLOT_DEICTIC_PATTERNS);

  if (!generalFollowup && !slotSpecificFollowup && !deicticSlotFollowup) {
    return null;
  }

  return {
    level: "vision_snapshot",
    shouldCapture: true,
    trigger: "contextual_followup",
    reason: slotSpecificFollowup
      ? `${context.kind} slot follow-up`
      : `contextual follow-up on ${context.kind}`,
    contextKind: context.kind,
    ...(refreshFollowup ? { bypassCooldown: true } : {}),
  };
}

function nextContextForIntent(
  intent: PendingVisionIntent | null,
  nowMs: number,
): VisionRouteContext | null {
  if (!intent) return null;
  return {
    kind: intent.contextKind,
    lastTrigger: intent.trigger,
    ...(intent.attribute ? { attribute: intent.attribute } : {}),
    ...(intent.confidence !== undefined ? { confidence: intent.confidence } : {}),
    ...(intent.questionType ? { questionType: intent.questionType } : {}),
    ...(intent.subject ? { subject: intent.subject } : {}),
    expiresAtMs: nowMs + VISION_CONTEXT_TTL_MS,
  };
}

function withContext(
  intent: PendingVisionIntent,
  nowMs: number,
): VisionRouteDecision {
  return {
    ...intent,
    nextContext: nextContextForIntent(intent, nowMs),
  };
}

export function decideVisionRoute(
  rawText: string,
  options: VisionRouteOptions,
): VisionRouteDecision {
  const text = rawText.trim();
  const nowMs = options.nowMs ?? Date.now();
  const context = activeContext(options.context, nowMs);

  if (options.attachedImageCount >= options.maxImagesPerTurn) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "image_limit",
      reason: "image limit reached",
      nextContext: context,
    };
  }

  let wanted: PendingVisionIntent | null = null;
  if (matchesAny(text, SCREEN_OR_OCR_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "screen_or_ocr",
      reason: "screen or OCR request",
      contextKind: "screen",
    };
  } else if (matchesAny(text, APPEARANCE_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "appearance_query",
      reason: "appearance or clothing question",
      contextKind: "appearance",
    };
  } else if (matchesAny(text, EXPLICIT_VISUAL_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "explicit_visual_reference",
      reason: "explicit visual request",
      contextKind: "scene",
    };
  } else {
    wanted = detectContextualFollowup(text, context);
  }

  if (!wanted && matchesAny(text, EMOTION_SHIFT_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "emotion_shift",
      reason: "emotion or stress cue",
      contextKind: "emotion",
    };
  } else if (!wanted && matchesAny(text, IMPLICIT_DEIXIS_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "implicit_deixis",
      reason: "implicit visual reference",
      contextKind: context?.kind ?? "scene",
    };
  }

  if (wanted && !options.cameraEnabled) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "camera_disabled",
      reason: "camera is off",
      nextContext: nextContextForIntent(wanted, nowMs),
    };
  }

  if (wanted && options.cooldownActive && !wanted.bypassCooldown) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "cooldown",
      reason: "camera capture cooldown",
      nextContext: nextContextForIntent(wanted, nowMs),
    };
  }

  if (wanted) return withContext(wanted, nowMs);

  if (options.attachedImageCount > 0) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "manual_attachment",
      reason: "manual image already attached",
      nextContext: context,
    };
  }

  return {
    level: "audio_only",
    shouldCapture: false,
    trigger: "no_visual_need",
    reason: "no visual trigger",
    nextContext: context,
  };
}

export function formatVisionRoute(decision: VisionRouteDecision): string {
  switch (decision.trigger) {
    case "screen_or_ocr":
      return "Vision snapshot: screen/OCR";
    case "appearance_query":
      return "Vision snapshot: appearance";
    case "explicit_visual_reference":
      return "Vision snapshot: visual request";
    case "contextual_followup":
      return "Vision snapshot: follow-up";
    case "implicit_deixis":
      return "Vision snapshot: implicit reference";
    case "emotion_shift":
      return "Vision snapshot: stress cue";
    case "llm_router":
      return decision.level === "vision_burst"
        ? "Vision burst: smart route"
        : "Vision snapshot: smart route";
    case "camera_disabled":
      return "Audio only: camera off";
    case "cooldown":
      return "Audio only: cooldown";
    case "image_limit":
      return "Audio only: image limit";
    case "manual_attachment":
      return "Audio only: image attached";
    case "no_visual_need":
    default:
      return "Audio only";
  }
}
