"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AssistantMarkdown } from "./assistant-markdown";
import {
  COMPONENT_CATALOG,
  COMPONENT_CATEGORIES,
  componentMatchesSearch,
  SUPPORTED_COMPONENT_TYPES,
  connectFloatingMotorDriverEnables,
  createDefaultProperties,
  activateBoardProgram,
  getActiveBoard,
  isPositionOnlyProjectChange,
  isBoardType,
  resolveBoardPin,
  updateActiveBoardProgram,
  getComponentDefinition,
  normalizeGroundReturns,
  removeComponentFromProject,
  removeComponentsFromProject,
  safeParseCircuitProject,
  type CircuitComponent,
  type CircuitConnection,
  type CircuitProject,
  type ConnectionEndpoint,
} from "../lib/circuit";
import {
  MultiBoardSimulator,
  isBuzzerActive,
  isUninitializedMotorControlWarning,
  isLedCircuitPowered,
  resolveBuzzerCircuitBindings,
  resolveComponentBoardPinEndpoints,
  resolveComponentIoPins,
  resolveLedCircuitBindings,
  solveCircuit,
  type SimulatorSnapshot,
} from "../lib/simulator";
import {
  componentSize,
  fitViewport,
  pinPosition,
  type CoordinatedWireRoute,
} from "../lib/schematic";
import { spaceGeneratedComponents } from "../lib/schematic/generated-layout.ts";
import { isLatestWireRouteResponse, type WireRouteRequest, type WireRouteResponse } from "../lib/schematic/route-worker-core.ts";
import { DeviceFeedback } from "./device-feedback";
import { SchematicSymbol } from "./schematic-symbols";
import { accountProjectCacheKey } from "../lib/circuit/account-storage";
import { generationFailureNextStep } from "../lib/circuit/generation-error-guidance";
import { createClient as createSupabaseClient } from "../lib/supabase/client";
import { serializeJson } from "../lib/supabase/database.types";
import { signOutFromCirkitra } from "../lib/firebase/session-client";

const LAYOUT_STORAGE_KEY = "ai-circuit-studio.layout.v1";
const MODEL_STORAGE_KEY = "ai-circuit-studio.ai-model.v1";
const GEMINI_MODELS = ["gemini-3.5-flash-lite"] as const;
type GeminiModel = (typeof GEMINI_MODELS)[number];
const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-3.5-flash-lite";
const GEMINI_MODEL_LABELS: Record<GeminiModel, string> = {
  "gemini-3.5-flash-lite": "Autopilot",
};
const WIRE_COLORS = ["#ffb547", "#ff6b6b", "#56d7c3", "#68a7ff", "#b38cff"];
const PALETTE_CATEGORIES = ["all", ...COMPONENT_CATEGORIES] as const;

type SideTab = "assistant" | "inspector";
type BottomTab = "code" | "serial" | "problems";
type ChatMessage = { id: string; role: "assistant" | "user"; text: string; meta?: string; modeChoice?: { prompt: string; model: GeminiModel; selected?: "create" | "edit" } };
type ChatHistoryTurn = { role: "assistant" | "user"; text: string };
type AssistantMode = "chat" | "build";
type GenerationFailure = { prompt: string; model: GeminiModel; assistantMode: AssistantMode; chatHistory: ChatHistoryTurn[]; generationModeOverride?: "create" | "edit"; retryable: boolean; code: string };
type CompileMessage = { severity: "error" | "warning"; line?: number; message: string };
type PanelSizes = { left: number; right: number; bottom: number; assistantPrompt: number };
type ResizeTarget = keyof PanelSizes;
type PanelResizeState = {
  target: ResizeTarget;
  startX: number;
  startY: number;
  startSize: number;
};
type CanvasTool = "select" | "pan";
type MobilePanel = "library" | "assistant" | null;
type GenerationProgress = { stage: string; detail?: string; progress?: { completed: number; total: number } };
type GenerationEnvelope = { kind?: "chat" | "mode-clarification"; reply?: string; message?: string; options?: string[]; project?: unknown; explanation?: string; assumptions?: string[]; warnings?: string[]; generationMode?: "create" | "edit"; model?: unknown; error?: { code?: string; message?: string; retryable?: boolean; details?: string[] } };
type MarqueeState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
};

const DEFAULT_PANEL_SIZES: PanelSizes = { left: 232, right: 356, bottom: 230, assistantPrompt: 320 };
const PANEL_LIMITS = {
  left: { min: 176, max: 380 },
  right: { min: 280, max: 560 },
  bottom: { min: 140, max: 520 },
  assistantPrompt: { min: 220, max: 620 },
} satisfies Record<ResizeTarget, { min: number; max: number }>;
const COMPACT_BREAKPOINT = 1180;
const LEFT_PANEL_BREAKPOINT = 930;
const RIGHT_PANEL_BREAKPOINT = 720;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isGeminiModel(value: unknown): value is GeminiModel {
  return typeof value === "string" && (GEMINI_MODELS as readonly string[]).includes(value);
}

function finiteSize(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function centerMinimum(viewportWidth: number) {
  return viewportWidth <= COMPACT_BREAKPOINT ? 320 : 420;
}

function bottomMaximum(viewportHeight: number) {
  const available = Math.max(650, viewportHeight) - 60 - 24 - 320;
  return clamp(available, PANEL_LIMITS.bottom.min, PANEL_LIMITS.bottom.max);
}

function assistantPromptMaximum(viewportHeight: number) {
  return clamp(viewportHeight - 220, PANEL_LIMITS.assistantPrompt.min, PANEL_LIMITS.assistantPrompt.max);
}

function constrainPanelSizes(sizes: Partial<PanelSizes>, viewportWidth: number, viewportHeight: number): PanelSizes {
  let left = clamp(finiteSize(sizes.left, DEFAULT_PANEL_SIZES.left), PANEL_LIMITS.left.min, PANEL_LIMITS.left.max);
  let right = clamp(finiteSize(sizes.right, DEFAULT_PANEL_SIZES.right), PANEL_LIMITS.right.min, PANEL_LIMITS.right.max);
  const bottom = clamp(
    finiteSize(sizes.bottom, DEFAULT_PANEL_SIZES.bottom),
    PANEL_LIMITS.bottom.min,
    bottomMaximum(viewportHeight),
  );
  const assistantPrompt = clamp(
    finiteSize(sizes.assistantPrompt, DEFAULT_PANEL_SIZES.assistantPrompt),
    PANEL_LIMITS.assistantPrompt.min,
    assistantPromptMaximum(viewportHeight),
  );

  if (viewportWidth > LEFT_PANEL_BREAKPOINT) {
    const availableForPanels = Math.max(
      PANEL_LIMITS.left.min + PANEL_LIMITS.right.min,
      viewportWidth - centerMinimum(viewportWidth),
    );
    let overflow = Math.max(0, left + right - availableForPanels);
    const rightReduction = Math.min(overflow, right - PANEL_LIMITS.right.min);
    right -= rightReduction;
    overflow -= rightReduction;
    left -= Math.min(overflow, left - PANEL_LIMITS.left.min);
  } else if (viewportWidth > RIGHT_PANEL_BREAKPOINT) {
    right = Math.min(right, Math.max(PANEL_LIMITS.right.min, viewportWidth - centerMinimum(viewportWidth)));
  }

  return { left, right, bottom, assistantPrompt };
}

function resizePanel(
  sizes: PanelSizes,
  target: ResizeTarget,
  requestedSize: number,
  viewportWidth: number,
  viewportHeight: number,
): PanelSizes {
  if (target === "bottom") {
    return {
      ...sizes,
      bottom: clamp(requestedSize, PANEL_LIMITS.bottom.min, bottomMaximum(viewportHeight)),
    };
  }

  if (target === "assistantPrompt") {
    return {
      ...sizes,
      assistantPrompt: clamp(requestedSize, PANEL_LIMITS.assistantPrompt.min, assistantPromptMaximum(viewportHeight)),
    };
  }

  if (target === "left") {
    const dynamicMax = viewportWidth > LEFT_PANEL_BREAKPOINT
      ? viewportWidth - sizes.right - centerMinimum(viewportWidth)
      : PANEL_LIMITS.left.max;
    return {
      ...sizes,
      left: clamp(requestedSize, PANEL_LIMITS.left.min, Math.max(PANEL_LIMITS.left.min, Math.min(PANEL_LIMITS.left.max, dynamicMax))),
    };
  }

  const dynamicMax = viewportWidth > LEFT_PANEL_BREAKPOINT
    ? viewportWidth - sizes.left - centerMinimum(viewportWidth)
    : viewportWidth > RIGHT_PANEL_BREAKPOINT
      ? viewportWidth - centerMinimum(viewportWidth)
      : PANEL_LIMITS.right.max;
  return {
    ...sizes,
    right: clamp(requestedSize, PANEL_LIMITS.right.min, Math.max(PANEL_LIMITS.right.min, Math.min(PANEL_LIMITS.right.max, dynamicMax))),
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  motors: "Motors", drivers: "Drivers", wireless: "Wireless", multiplexers: "Mux / Expansion", power: "Power", storage: "Storage",
  boards: "Boards",
  passives: "Passives",
  inputs: "Input",
  outputs: "Output",
  displays: "Display",
  sensors: "Sensor",
  logic: "Logic",
};

const PART_GLYPHS: Record<string, string> = {
  led: "LED",
  "rgb-led": "RGB",
  resistor: "R",
  "push-button": "BTN",
  "toggle-switch": "SW",
  potentiometer: "POT",
  "seven-segment": "8.",
  "lcd-16x2": "LCD",
  buzzer: "BZ",
  servo: "SRV",
  "dc-motor": "M",
  l293d: "IC",
  "logic-and": "&",
  "logic-or": ">1",
  "logic-xor": "=1",
  "logic-nand": "!&",
  "logic-nor": "!>1",
  "logic-not": "!1",
  "hc-sr04": "SON",
  "temperature-sensor": "TMP",
  "pir-sensor": "PIR",
  "arduino-uno": "UNO",
  ground: "GND",
};

let uidCounter = 0;

function uid(prefix: string) {
  // These IDs are created by user actions, never during render, so use unique
  // values even across Fast Refresh/module reloads while chat state is retained.
  const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${uidCounter++}`;
  return `${prefix}-${randomId}`;
}

function deepClone(project: CircuitProject): CircuitProject {
  return JSON.parse(JSON.stringify(project)) as CircuitProject;
}

function statusLabel(snapshot: SimulatorSnapshot) {
  if (snapshot.status === "running") return "Simulation running";
  if (snapshot.status === "paused") return "Simulation paused";
  if (snapshot.status === "error") return "Code needs attention";
  if (snapshot.status === "completed") return "Simulation complete";
  return "Stopped";
}

class GenerationRequestError extends Error {
  code: string;
  retryable: boolean;
  details?: string[];
  constructor(message: string, code = "AI_UNAVAILABLE", retryable = true, details?: string[]) {
    super(message);
    this.name = "GenerationRequestError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

function conciseGenerationError(error: GenerationRequestError) {
  if (error.code === "COMPONENT_UNAVAILABLE") {
    return `${error.message} Try a supported equivalent from the parts catalog, or describe the same behavior using available parts.`;
  }
  if (error.details?.some(detail => /outside the simulator expression grammar|unsupported (?:expression|syntax)|must be a balanced expression/i.test(detail))) {
    return "The generated sketch used syntax the simulator cannot run. Open View diagnostics for the exact issue, then simplify the request to supported sketch syntax; your current circuit was left unchanged.";
  }
  if (error.details?.some(detail => /missing sketch for board|programs\.\w+: program\.(?:objects|globals|functions)/i.test(detail))) {
    return "The generated project is missing a complete sketch for one or more boards. Open View diagnostics, then simplify the multi-board request; your current circuit was left unchanged.";
  }
  if (error.details?.some(detail => /UNSUPPORTED_CALL|calls unsupported/i.test(detail))) {
    if (error.details.some(detail => /selectMuxChannel/i.test(detail))) {
      return "The sketch used an unsupported TCA9548A method. Use mux.selectChannel(channel), which the simulator supports.";
    }
    return "The sketch called a method this part does not support in the simulator. Open View diagnostics for the exact call, then use a registered API or describe the behavior without that method.";
  }
  if (["AI_WHOLE_PROJECT_RECOVERY_FAILED", "AI_REPAIR_NO_CHANGE", "AI_REPAIR_EXHAUSTED", "AI_STAGE_INVALID", "AI_VALIDATION_FAILED", "AI_ASSEMBLY_FAILED"].includes(error.code)) {
    return "Cirkitra could not validate the complete circuit after its repair attempt. Open View diagnostics to see whether the issue is wiring, code, or simulation, then simplify that part of the request. Your current circuit was left unchanged.";
  }
  if (error.code === "AI_DEADLINE_EXCEEDED") {
    return "Circuit generation took too long to finish. Try a smaller request or split this design into steps.";
  }
  return error.message;
}

async function readGenerationResponse(response: Response, onProgress: (progress: GenerationProgress) => void): Promise<GenerationEnvelope> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await response.json().catch(() => ({})) as GenerationEnvelope;
    if (!response.ok) throw new GenerationRequestError(body.error?.message ?? "AI generation failed.", body.error?.code, body.error?.retryable ?? response.status >= 500, body.error?.details);
    return body;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new GenerationRequestError("The generation stream ended before a result arrived.");
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: GenerationEnvelope | undefined;
  const processLine = (line: string) => {
    if (!line.trim()) return;
    let event: { type?: string; stage?: string; detail?: string; progress?: { completed: number; total: number }; result?: GenerationEnvelope; error?: { code?: string; message?: string; retryable?: boolean; details?: string[] } };
    try { event = JSON.parse(line) as typeof event; }
    catch { throw new GenerationRequestError("Cirkitra received an unreadable generation update."); }
    if (event.type === "progress" && event.stage) onProgress({ stage: event.stage, detail: event.detail, progress: event.progress });
    else if (event.type === "complete") terminal = event.result ?? {};
    else if (event.type === "error") throw new GenerationRequestError(event.error?.message ?? "AI generation failed.", event.error?.code, event.error?.retryable ?? true, event.error?.details);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (!terminal) throw new GenerationRequestError("The generation stream ended without a complete result.");
  return terminal;
}

type CloudSaveState = "saved" | "saving" | "error";
type ProjectCache = { savedAt: number; project: unknown };
type AiUsageStatus = { used: number; limit: number; remaining: number; unlimited: boolean; resetsAt: string | null; planName: string };

export function CircuitStudio({ initialProject: loadedProject, projectUpdatedAt, userId }: { initialProject: CircuitProject; projectUpdatedAt: string; userId: string }) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const initialProject = loadedProject;
  const [project, setProject] = useState<CircuitProject>(initialProject);
  const [circuitProject, setCircuitProject] = useState<CircuitProject>(initialProject);
  const projectRef = useRef(project);
  const codeLineNumbersRef = useRef<HTMLPreElement | null>(null);
  const lastObservedProjectRef = useRef(project);
  const lastSimulatorProjectRef = useRef(project);
  const historyRef = useRef<CircuitProject[]>([deepClone(initialProject)]);
  const skipInitialSaveRef = useRef(false);
  const localRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const cloudSavingRef = useRef(false);
  const cloudSaveFailedRef = useRef(false);
  const retryCloudSaveRef = useRef<() => void>(() => undefined);
  const remoteUpdatedAtRef = useRef(projectUpdatedAt);
  const [cloudSaveState, setCloudSaveState] = useState<CloudSaveState>("saved");
  const projectCacheKey = accountProjectCacheKey(userId, initialProject.id);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyLength, setHistoryLength] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>(["led1"]);
  const [pendingPin, setPendingPin] = useState<ConnectionEndpoint | null>(null);
  const [hoveredWireId, setHighlightedWireId] = useState<string | null>(null);
  const [pinnedWireId, setPinnedWireId] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const highlightedWireId = project.connections.some((wire) => wire.id === pinnedWireId)
    ? pinnedWireId : hoveredWireId;
  const tracedWire = project.connections.find((wire) => wire.id === highlightedWireId);
  const endpointLabel = (endpoint: ConnectionEndpoint) => {
    const component = project.components.find((part) => part.id === endpoint.componentId);
    return `${component?.label ?? endpoint.componentId} · ${endpoint.pin}`;
  };
  const [paletteCategory, setPaletteCategory] = useState<(typeof PALETTE_CATEGORIES)[number]>("all");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [sideTab, setSideTab] = useState<SideTab>("assistant");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>("code");
  const [bottomOpen, setBottomOpen] = useState(true);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(DEFAULT_PANEL_SIZES);
  const [layoutHydrated, setLayoutHydrated] = useState(false);
  const [panelResize, setPanelResize] = useState<PanelResizeState | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 72, y: 42 });
  const [panDrag, setPanDrag] = useState<{
    pointerId: number;
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("select");
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("build");
  const [aiUsage, setAiUsage] = useState<AiUsageStatus | null>(null);
  const [aiModel, setAiModel] = useState<GeminiModel>(DEFAULT_GEMINI_MODEL);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationErrorDetails, setGenerationErrorDetails] = useState<string[]>([]);
  const [generationStage, setGenerationStage] = useState<GenerationProgress | null>(null);
  const [failedGeneration, setFailedGeneration] = useState<GenerationFailure | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [compileMessages, setCompileMessages] = useState<CompileMessage[]>([]);
  const [buildState, setBuildState] = useState<"idle" | "building" | "ready" | "error">("idle");
  const [dragState, setDragState] = useState<{ id: string; startX: number; startY: number; currentX: number; currentY: number; componentX: number; componentY: number; element: HTMLElement; pointerId: number } | null>(null);
  const dragStateRef = useRef<typeof dragState>(null);
  const routeWorkerRef = useRef<Worker | null>(null);
  const routeRequestIdRef = useRef(0);
  const latestWireRequestRef = useRef<Omit<WireRouteRequest, "requestId"> | null>(null);
  const [wireRoutes, setWireRoutes] = useState<Map<string, CoordinatedWireRoute>>(() => new Map());
  const [wireRoutingError, setWireRoutingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const ultrasonicEchoPinsRef = useRef<Set<string>>(new Set());
  const [simulator] = useState(() => new MultiBoardSimulator(initialProject.code));
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot>(() => simulator.getSnapshot());

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    const previous = lastObservedProjectRef.current;
    lastObservedProjectRef.current = project;
    if (!isPositionOnlyProjectChange(previous, project)) setCircuitProject(project);
  }, [project]);

  useEffect(() => {
    // Prevent hydration mismatch by deferring localStorage access until after mount
    if (typeof window === 'undefined') return;
    
    const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!isGeminiModel(savedModel)) return;
    const frame = window.requestAnimationFrame(() => setAiModel(savedModel));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshAiUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/usage", { cache: "no-store" });
      if (!response.ok) return;
      const usage = await response.json() as Partial<AiUsageStatus>;
      if (Number.isInteger(usage.used) && Number.isInteger(usage.limit) && Number.isInteger(usage.remaining) && typeof usage.unlimited === "boolean" && (typeof usage.resetsAt === "string" || usage.resetsAt === null) && typeof usage.planName === "string") {
        setAiUsage(usage as AiUsageStatus);
      }
    } catch {
      // Usage display is helpful context, but the server remains authoritative.
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void refreshAiUsage(); });
    return () => window.cancelAnimationFrame(frame);
  }, [refreshAiUsage]);

  const beginPanelResize = (target: ResizeTarget, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setPanelResize({
      target,
      startX: event.clientX,
      startY: event.clientY,
      startSize: panelSizes[target],
    });
  };

  const setPanelSize = (target: ResizeTarget, requestedSize: number) => {
    setPanelSizes((current) => resizePanel(
      current,
      target,
      requestedSize,
      window.innerWidth,
      window.innerHeight,
    ));
  };

  const resetPanelSize = (target: ResizeTarget) => {
    setPanelSize(target, DEFAULT_PANEL_SIZES[target]);
  };

  const handlePanelResizeKey = (target: ResizeTarget, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 40 : 10;
    let nextSize: number | null = null;
    if (event.key === "Home") nextSize = PANEL_LIMITS[target].min;
    if (event.key === "End") nextSize = PANEL_LIMITS[target].max;
    if (target === "left") {
      if (event.key === "ArrowLeft") nextSize = panelSizes.left - step;
      if (event.key === "ArrowRight") nextSize = panelSizes.left + step;
    } else if (target === "right") {
      if (event.key === "ArrowLeft") nextSize = panelSizes.right + step;
      if (event.key === "ArrowRight") nextSize = panelSizes.right - step;
    } else if (target === "bottom") {
      if (event.key === "ArrowUp") nextSize = panelSizes.bottom + step;
      if (event.key === "ArrowDown") nextSize = panelSizes.bottom - step;
    } else {
      if (event.key === "ArrowUp") nextSize = panelSizes.assistantPrompt + step;
      if (event.key === "ArrowDown") nextSize = panelSizes.assistantPrompt - step;
    }
    if (nextSize === null) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelSize(target, nextSize);
  };

  const commitProject = useCallback((next: CircuitProject) => {
    const normalized = normalizeGroundReturns({ ...next, id: initialProject.id });
    const copy = deepClone(normalized);
    const nextHistory = historyRef.current.slice(0, historyIndex + 1);
    nextHistory.push(copy);
    if (nextHistory.length > 60) nextHistory.shift();
    historyRef.current = nextHistory;
    projectRef.current = normalized;
    setHistoryIndex(nextHistory.length - 1);
    setHistoryLength(nextHistory.length);
    setProject(normalized);
    setBuildState("idle");
  }, [historyIndex, initialProject.id, setBuildState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      let restoredProject = initialProject;
      let shouldSyncRestoredProject = false;
      try {
        const saved = window.localStorage.getItem(projectCacheKey);
        if (saved) {
          const cache = JSON.parse(saved) as ProjectCache;
          const parsed = safeParseCircuitProject(cache.project);
          const cacheTime = Number(cache.savedAt);
          const remoteTime = Date.parse(projectUpdatedAt);
          if (parsed.success && Number.isFinite(cacheTime) && cacheTime > remoteTime) {
            restoredProject = normalizeGroundReturns({ ...parsed.data, id: initialProject.id });
            shouldSyncRestoredProject = true;
          }
        }
      } catch {
        // The server copy remains available if this device cache is invalid.
      }
      projectRef.current = restoredProject;
      setProject(restoredProject);
      historyRef.current = [deepClone(restoredProject)];
      setHistoryIndex(0);
      setHistoryLength(1);
      skipInitialSaveRef.current = !shouldSyncRestoredProject;
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialProject, projectCacheKey, projectUpdatedAt]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      setCloudSaveState("saved");
      return;
    }

    localRevisionRef.current += 1;
    cloudSaveFailedRef.current = false;
    const savedAt = Date.now();
    try {
      window.localStorage.setItem(projectCacheKey, JSON.stringify({ savedAt, project } satisfies ProjectCache));
    } catch {
      // Sync still proceeds if local cache storage is unavailable.
    }
    setCloudSaveState("saving");

    const persistLatest = () => {
      if (cloudSavingRef.current || savedRevisionRef.current >= localRevisionRef.current) return;
      cloudSavingRef.current = true;
      void (async () => {
        try {
          const supabase = createSupabaseClient();
          while (savedRevisionRef.current < localRevisionRef.current) {
            const sendingRevision = localRevisionRef.current;
            const latestProject = deepClone({ ...projectRef.current, id: initialProject.id });
            const previousTime = Date.parse(remoteUpdatedAtRef.current) || 0;
            const updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
            const { data: savedRow, error: saveError } = await supabase.from("projects").upsert({
              id: initialProject.id,
              owner_id: userId,
              name: latestProject.name,
              project: serializeJson(latestProject),
              updated_at: updatedAt,
            }, { onConflict: "id" }).select("updated_at").single();
            if (saveError) throw saveError;
            remoteUpdatedAtRef.current = savedRow.updated_at;
            savedRevisionRef.current = sendingRevision;
            try {
              window.localStorage.setItem(projectCacheKey, JSON.stringify({
                savedAt: Date.parse(savedRow.updated_at),
                project: latestProject,
              } satisfies ProjectCache));
            } catch {
              // The database copy is authoritative if the device cache is unavailable.
            }
          }
          setCloudSaveState("saved");
        } catch {
          cloudSaveFailedRef.current = true;
          setCloudSaveState("error");
        } finally {
          cloudSavingRef.current = false;
          if (savedRevisionRef.current < localRevisionRef.current && !cloudSaveFailedRef.current) persistLatest();
        }
      })();
    };
    retryCloudSaveRef.current = () => {
      cloudSaveFailedRef.current = false;
      persistLatest();
    };
    const timer = window.setTimeout(persistLatest, 650);
    return () => window.clearTimeout(timer);
  }, [hydrated, initialProject.id, project, projectCacheKey, userId]);

  useEffect(() => {
    const retryWhenOnline = () => retryCloudSaveRef.current();
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, []);

  useEffect(() => {
    // Prevent hydration mismatch by deferring localStorage and window access until after mount
    if (typeof window === 'undefined') return;
    
    let restored: Partial<PanelSizes> = DEFAULT_PANEL_SIZES;
    try {
      const saved = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as unknown;
        if (parsed && typeof parsed === "object") restored = parsed as Partial<PanelSizes>;
      }
    } catch {
      // Invalid layout preferences fall back to a balanced default layout.
    }
    const next = constrainPanelSizes(restored, window.innerWidth, window.innerHeight);
    queueMicrotask(() => {
      setPanelSizes(next);
      setLayoutHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!layoutHydrated) return;
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(panelSizes));
    } catch {
      // The layout remains usable when storage is unavailable.
    }
  }, [layoutHydrated, panelSizes]);

  useEffect(() => {
    const keepLayoutInViewport = () => {
      setPanelSizes((current) => constrainPanelSizes(current, window.innerWidth, window.innerHeight));
    };
    window.addEventListener("resize", keepLayoutInViewport);
    return () => window.removeEventListener("resize", keepLayoutInViewport);
  }, []);

  useEffect(() => {
    if (!panelResize) return;

    const move = (event: PointerEvent) => {
      const requestedSize = panelResize.target === "left"
        ? panelResize.startSize + event.clientX - panelResize.startX
        : panelResize.target === "right"
          ? panelResize.startSize - (event.clientX - panelResize.startX)
          : panelResize.startSize - (event.clientY - panelResize.startY);
      setPanelSizes((current) => resizePanel(
        current,
        panelResize.target,
        requestedSize,
        window.innerWidth,
        window.innerHeight,
      ));
    };
    const stop = () => setPanelResize(null);
    const resizeClass = panelResize.target === "left" || panelResize.target === "right" ? "resizing-column" : "resizing-row";
    document.body.classList.add("resizing-panels", resizeClass);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      document.body.classList.remove("resizing-panels", resizeClass);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [panelResize]);

  useEffect(() => simulator.subscribe(setSnapshot), [simulator]);

  useEffect(() => {
    const previous = lastSimulatorProjectRef.current;
    lastSimulatorProjectRef.current = project;
    if (isPositionOnlyProjectChange(previous, project)) return;
    simulator.attachProject(project);
  }, [project, simulator]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let accumulator = 0;
    const SIMULATION_STEP = 16.67; // ~60fps for simulation
    const MAX_DELTA = 100;

    const tick = (now: number) => {
      const delta = Math.max(0, Math.min(MAX_DELTA, now - last));
      last = now;
      accumulator += delta;
      
      // Limit simulation updates to reduce CPU usage with complex circuits
      if (accumulator >= SIMULATION_STEP) {
        const solved = solveCircuit(circuitProject, simulator.getSnapshot());
        simulator.applyCircuitState({ 
          digital: solved.digitalInputs, 
          analog: solved.analogInputs, 
          components: solved.componentStates 
        });
        simulator.advance(accumulator);
        accumulator = 0;
      }
      
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [circuitProject, simulator]);

  useEffect(() => {
    if (!dragState) return;
    
    const move = (event: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.currentX = event.clientX;
      current.currentY = event.clientY;
      current.element.style.transform = `translate(${(current.currentX - current.startX) / zoom}px, ${(current.currentY - current.startY) / zoom}px)`;
    };
    
    const finish = (event: PointerEvent | FocusEvent) => {
      const current = dragStateRef.current;
      if (!current) return;
      if (event.type === "pointerup" || event.type === "pointercancel") {
        const pointerEvent = event as PointerEvent;
        if (pointerEvent.pointerId !== current.pointerId) return;
        if (event.type === "pointerup") {
          current.currentX = pointerEvent.clientX;
          current.currentY = pointerEvent.clientY;
        }
      }
      const dx = (current.currentX - current.startX) / zoom;
      const dy = (current.currentY - current.startY) / zoom;
      current.element.style.transform = "";
      dragStateRef.current = null;
      if (dx !== 0 || dy !== 0) {
        routeRequestIdRef.current += 1;
        const nextProject: CircuitProject = {
          ...projectRef.current,
          components: projectRef.current.components.map((component) => component.id === current.id
            ? { ...component, x: current.componentX + dx, y: current.componentY + dy }
            : component),
        };
        projectRef.current = nextProject;
        setProject(nextProject);
        const nextHistory = historyRef.current.slice(0, historyIndex + 1);
        nextHistory.push(deepClone(nextProject));
        historyRef.current = nextHistory;
        setHistoryIndex(nextHistory.length - 1);
        setHistoryLength(nextHistory.length);
        setBuildState("idle");
      }
      setDragState(null);
    };
    
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, [dragState, historyIndex, zoom]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const index = historyIndex - 1;
    setHistoryIndex(index);
    setProject(deepClone(historyRef.current[index]));
  }, [historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= historyLength - 1) return;
    const index = historyIndex + 1;
    setHistoryIndex(index);
    setProject(deepClone(historyRef.current[index]));
  }, [historyIndex, historyLength]);

  const removeComponent = useCallback((componentId: string) => {
    const current = projectRef.current;
    const component = current.components.find((item) => item.id === componentId);
    if (!component) return;
    commitProject(removeComponentFromProject(current, componentId));
    setSelectedIds((selected) => selected.filter((id) => id !== componentId));
    setPendingPin((endpoint) => endpoint?.componentId === componentId ? null : endpoint);
    announce(`${component.label} removed`);
  }, [announce, commitProject]);

  const removeSelectedComponents = useCallback(() => {
    const current = projectRef.current;
    const existingIds = selectedIds.filter((id) =>
      current.components.some((component) => component.id === id),
    );
    if (!existingIds.length) return;
    commitProject(removeComponentsFromProject(current, existingIds));
    setSelectedIds([]);
    setPendingPin((endpoint) => endpoint && existingIds.includes(endpoint.componentId) ? null : endpoint);
    announce(existingIds.length === 1 ? "Component removed" : `${existingIds.length} components removed`);
  }, [announce, commitProject, selectedIds]);

  const selectAllComponents = useCallback(() => {
    const componentIds = projectRef.current.components.map((component) => component.id);
    setSelectedIds(componentIds);
    if (componentIds.length > 1) setSideTab("inspector");
    announce(componentIds.length ? `${componentIds.length} components selected` : "No components to select");
  }, [announce]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest("input, textarea, [contenteditable='true']"));
      const interactive = Boolean(target?.closest("input, textarea, button, select, [role='separator'], [contenteditable='true']"));
      if (!interactive && event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllComponents();
      }
      if (!editing && event.key === "Escape") { setPinnedWireId(null); setHighlightedWireId(null); setShowConnections(false); }
      if (!editing && (event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
        event.preventDefault();
        removeSelectedComponents();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, [redo, removeSelectedComponents, selectAllComponents, selectedIds.length, undo]);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selected = project.components.find((component) => component.id === selectedId) ?? null;
  const selectedDefinition = selected ? getComponentDefinition(selected.type) : undefined;
  const boards = project.components.filter((component) => isBoardType(component.type));
  const activeBoard = getActiveBoard(project);
  const activeBoardName = activeBoard ? getComponentDefinition(activeBoard.type)?.displayName ?? activeBoard.type : "No board";
  const ledCircuitBindings = useMemo(
    () => resolveLedCircuitBindings(circuitProject),
    [circuitProject],
  );
  const buzzerCircuitBindings = useMemo(
    () => resolveBuzzerCircuitBindings(circuitProject),
    [circuitProject],
  );
  
  const circuitMessages = useMemo<CompileMessage[]>(() => {
    const diagnostics = [...solveCircuit(circuitProject, snapshot).diagnostics, ...snapshot.diagnostics]
      .filter(item => !isUninitializedMotorControlWarning(circuitProject, snapshot, item));
    const uniqueDiagnostics = [...new Map(diagnostics.map(item => [`${item.code}:${item.line ?? 0}:${item.message}`, item])).values()];
    return uniqueDiagnostics.map((item) => ({
      severity: item.severity, 
      message: item.message 
    }));
  }, [circuitProject, snapshot]);
  
  const problemMessages = useMemo(() => [...compileMessages, ...circuitMessages], [compileMessages, circuitMessages]);
  const enableRepair = useMemo(() => connectFloatingMotorDriverEnables(circuitProject), [circuitProject]);
  const hasEnableRepair = enableRepair !== circuitProject;
  const missingEnableCount = enableRepair.connections.length - circuitProject.connections.length;
  useEffect(() => {
    const powered = solveCircuit(circuitProject, simulator.getSnapshot()).componentStates;
    const echoPins = new Set<string>();
    circuitProject.components.forEach((component) => {
      if (component.type === "hc-sr04") {
        const distance = Number(component.properties?.distanceCm ?? 100);
        const duration = powered[component.id]?.powered ? distance * 58.3 : 0;
        resolveComponentIoPins(circuitProject, component.id, "ECHO").forEach((pin) => { simulator.setPulseInput(pin, duration); echoPins.add(pin); });
      }
    });
    ultrasonicEchoPinsRef.current.forEach(pin => { if (!echoPins.has(pin)) simulator.setPulseInput(pin, 0); });
    ultrasonicEchoPinsRef.current = echoPins;
  }, [circuitProject, simulator]);

  const connections = project.connections;
  const componentById = useMemo(() => new Map(project.components.map((component) => [component.id, component])), [project.components]);
  const connectedWiresByPin = useMemo(() => {
    const result = new Map<string, CircuitConnection[]>();
    for (const connection of connections) {
      for (const endpoint of [connection.from, connection.to]) {
        const key = `${endpoint.componentId}\u0000${endpoint.pin}`;
        const connected = result.get(key);
        if (connected) connected.push(connection);
        else result.set(key, [connection]);
      }
    }
    return result;
  }, [connections]);
  const wireRouteInputs = useMemo(() => {
    return connections.flatMap((connection) => {
      const fromComponent = componentById.get(connection.from.componentId);
      const toComponent = componentById.get(connection.to.componentId);
      const fromDefinition = fromComponent ? getComponentDefinition(fromComponent.type) : undefined;
      const toDefinition = toComponent ? getComponentDefinition(toComponent.type) : undefined;
      if (!fromComponent || !toComponent || !fromDefinition || !toDefinition) return [];
      const fromPin = fromDefinition.pins.find((pin) => pin.id === connection.from.pin);
      const toPin = toDefinition.pins.find((pin) => pin.id === connection.to.pin);
      const from = pinPosition({ ...fromComponent, rotation: 0 }, connection.from.pin, fromDefinition);
      const to = pinPosition({ ...toComponent, rotation: 0 }, connection.to.pin, toDefinition);
      if (!fromPin || !toPin || !from || !to) return [];
      return [{ id: connection.id, from: { point: from, side: fromPin.side }, to: { point: to, side: toPin.side } }];
    });
  }, [componentById, connections]);
  const wireRouteComponents = useMemo(() => project.components.map(({ type, x, y, rotation }) => ({ type, x, y, rotation })), [project.components]);

  useLayoutEffect(() => {
    const request = { wires: wireRouteInputs, components: wireRouteComponents };
    latestWireRequestRef.current = request;
    const worker = routeWorkerRef.current;
    const requestId = ++routeRequestIdRef.current;
    if (!worker) return;
    try {
      worker.postMessage({ requestId, ...request });
    } catch (error) {
      console.error("Could not send the wire-routing request.", error);
      window.setTimeout(() => setWireRoutingError("Wire routes could not refresh. Refresh to retry."), 0);
    }
  }, [wireRouteInputs, wireRouteComponents]);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/schematic/wire-router.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      console.error("Could not start the wire-routing worker.", error);
      window.setTimeout(() => setWireRoutingError("Wire routing could not start. Refresh to retry."), 0);
      return;
    }
    routeWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WireRouteResponse>) => {
      const response = event.data;
      if (!isLatestWireRouteResponse(response, routeRequestIdRef.current)) return;
      if (response.error || !response.routes) {
        console.error("Could not refresh wire routes.", response.error);
        setWireRoutingError("Wire routes could not refresh. Refresh to retry.");
        return;
      }
      setWireRoutes(new Map(response.routes.map((route) => [route.id, route])));
      setWireRoutingError(null);
    };
    worker.onerror = (event) => {
      console.error("The wire-routing worker failed.", event.message);
      setWireRoutingError("Wire routing failed. Refresh to retry.");
      worker.terminate();
      if (routeWorkerRef.current === worker) routeWorkerRef.current = null;
    };
    worker.onmessageerror = () => {
      console.error("The wire-routing worker returned an unreadable result.");
      setWireRoutingError("Wire routing failed. Refresh to retry.");
    };
    const request = latestWireRequestRef.current;
    if (request) {
      const requestId = ++routeRequestIdRef.current;
      try {
        worker.postMessage({ requestId, ...request });
      } catch (error) {
        console.error("Could not send the wire-routing request.", error);
        window.setTimeout(() => setWireRoutingError("Wire routes could not refresh. Refresh to retry."), 0);
      }
    }
    return () => {
      worker.terminate();
      if (routeWorkerRef.current === worker) routeWorkerRef.current = null;
    };
  }, []);

  const parts = useMemo(() => {
    const search = paletteSearch.trim().toLowerCase();
    return SUPPORTED_COMPONENT_TYPES
      .map((type) => COMPONENT_CATALOG[type])
      .filter((definition) => paletteCategory === "all" || definition.category === paletteCategory)
      .filter((definition) => !search || componentMatchesSearch(definition, search));
  }, [paletteCategory, paletteSearch]);

  const addPart = (type: string) => {
    const definition = getComponentDefinition(type);
    if (!definition) return;
    const count = project.components.filter((component) => component.type === type).length + 1;
    const viewport = viewportRef.current?.getBoundingClientRect();
    const centerX = viewport ? (viewport.width / 2 - pan.x) / zoom : 480;
    const centerY = viewport ? (viewport.height / 2 - pan.y) / zoom : 260;
    const size = componentSize(type);
    const component: CircuitComponent = {
      id: uid(type),
      type,
      label: `${definition.displayName} ${count}`,
      x: centerX - size.width / 2 + ((project.components.length * 19) % 90),
      y: centerY - size.height / 2 + ((project.components.length * 23) % 70),
      properties: createDefaultProperties(type),
    };
    const nextProject = { ...project, components: [...project.components, component] };
    if (isBoardType(type)) {
      const selectedProject = activateBoardProgram(nextProject, component.id);
      simulator.attachProject(nextProject);
      simulator.selectBoard(component.id);
      simulator.load(selectedProject.code);
      commitProject(selectedProject);
    } else commitProject(nextProject);
    setSelectedIds([component.id]);
    setSideTab("inspector");
    announce(`${definition.displayName} added`);
  };

  const beginDrag = (event: ReactPointerEvent, component: CircuitComponent) => {
    if (spaceHeld || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".schematic-pin")) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedIds([component.id]);
    const drag = {
      id: component.id, 
      startX: event.clientX, 
      startY: event.clientY, 
      currentX: event.clientX, 
      currentY: event.clientY,
      componentX: component.x, 
      componentY: component.y,
      element: event.currentTarget as HTMLElement,
      pointerId: event.pointerId,
    };
    dragStateRef.current = drag;
    setDragState(drag);
  };

  const beginCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest(".connection-panel, .wire-trace-card, .wire-segment")) return;
    setPinnedWireId(null);
    setHighlightedWireId(null);
    const forcedPan = spaceHeld || canvasTool === "pan" || event.button === 1;
    if (!forcedPan && target.closest(".circuit-node, .wire-segment, .minimap")) return;
    event.preventDefault();
    if (!forcedPan) {
      const rect = event.currentTarget.getBoundingClientRect();
      const clientX = event.clientX - rect.left;
      const clientY = event.clientY - rect.top;
      const worldX = (clientX - pan.x) / zoom;
      const worldY = (clientY - pan.y) / zoom;
      setSelectedIds([]);
      setMarquee({
        pointerId: event.pointerId,
        startClientX: clientX,
        startClientY: clientY,
        currentClientX: clientX,
        currentClientY: clientY,
        startWorldX: worldX,
        startWorldY: worldY,
        currentWorldX: worldX,
        currentWorldY: worldY,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    setSelectedIds([]);
    setPanDrag({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (marquee && event.pointerId === marquee.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const clientX = event.clientX - rect.left;
      const clientY = event.clientY - rect.top;
      const worldX = (clientX - pan.x) / zoom;
      const worldY = (clientY - pan.y) / zoom;
      const left = Math.min(marquee.startWorldX, worldX);
      const right = Math.max(marquee.startWorldX, worldX);
      const top = Math.min(marquee.startWorldY, worldY);
      const bottom = Math.max(marquee.startWorldY, worldY);
      const nextSelectedIds = project.components
        .filter((component) => {
          const size = componentSize(component.type);
          return component.x < right && component.x + size.width > left &&
            component.y < bottom && component.y + size.height > top;
        })
        .map((component) => component.id);
      setMarquee((current) => current ? {
        ...current,
        currentClientX: clientX,
        currentClientY: clientY,
        currentWorldX: worldX,
        currentWorldY: worldY,
      } : current);
      setSelectedIds(nextSelectedIds);
      return;
    }
    if (!panDrag || event.pointerId !== panDrag.pointerId) return;
    setPan({
      x: panDrag.panX + event.clientX - panDrag.clientX,
      y: panDrag.panY + event.clientY - panDrag.clientY,
    });
  };

  const endCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (marquee && event.pointerId === marquee.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setMarquee(null);
      return;
    }
    if (!panDrag || event.pointerId !== panDrag.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanDrag(null);
  };

  const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
    const clamped = Math.min(2.2, Math.max(0.2, nextZoom));
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      setZoom(clamped);
      return;
    }
    const focusX = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const focusY = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const worldX = (focusX - pan.x) / zoom;
    const worldY = (focusY - pan.y) / zoom;
    setPan({ x: focusX - worldX * clamped, y: focusY - worldY * clamped });
    setZoom(clamped);
  };

  const handleCanvasWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(zoom * factor, event.clientX, event.clientY);
  };

  const fitComponentsInCanvas = (components: readonly CircuitComponent[]) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fitted = fitViewport(components, rect.width, rect.height, 64, {
      minZoom: 0.2,
      maxZoom: 1.5,
    });
    setZoom(fitted.zoom);
    setPan(fitted.pan);
  };

  const fitCanvas = () => fitComponentsInCanvas(project.components);

  const connectPin = (endpoint: ConnectionEndpoint) => {
    if (!pendingPin) {
      setPendingPin(endpoint);
      announce(`Selected ${endpoint.pin}. Choose another pin.`);
      return;
    }
    if (pendingPin.componentId === endpoint.componentId && pendingPin.pin === endpoint.pin) {
      setPendingPin(null);
      return;
    }
    const connection = {
      id: uid("wire"),
      from: pendingPin,
      to: endpoint,
      color: WIRE_COLORS[project.connections.length % WIRE_COLORS.length],
    };
    commitProject({ ...project, connections: [...project.connections, connection] });
    setPendingPin(null);
    announce("Wire connected");
  };

  const updateSelected = (updates: Partial<CircuitComponent>) => {
    if (!selected) return;
    commitProject({
      ...project,
      components: project.components.map((component) => component.id === selected.id ? { ...component, ...updates } : component),
    });
  };

  const switchSketchBoard = (boardComponentId: string) => {
    const nextProject = activateBoardProgram(project, boardComponentId);
    const keepBuildReady = buildState === "ready";
    simulator.selectBoard(boardComponentId);
    commitProject(nextProject);
    setCompileMessages([]);
    setBuildState(keepBuildReady && simulator.getCompiledSketch().valid ? "ready" : "idle");
  };

  const build = async (autoRun = false) => {
    setBuildState("building");
    setCompileMessages([]);
    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: project.board, code: project.code }),
      });
      const result = await response.json() as { success?: boolean; diagnostics?: CompileMessage[]; error?: { message?: string } };
      const messages = result.diagnostics ?? [];
      setCompileMessages(messages);
      if (!response.ok || !result.success) {
        setBuildState("error");
        setBottomTab("problems");
        setBottomOpen(true);
        announce(result.error?.message ?? "Build failed — check Problems");
        return false;
      }
      simulator.load(project.code);
      setBuildState("ready");
      if (messages.length) setBottomTab("problems");
      announce("Build ready for browser simulation");
      if (autoRun) simulator.run();
      return true;
    } catch {
      const compiled = simulator.load(project.code);
      const messages = compiled.diagnostics.map((item) => ({ severity: item.severity, line: item.line, message: item.message }));
      setCompileMessages(messages);
      if (compiled.status === "error") {
        setBuildState("error");
        setBottomTab("problems");
        return false;
      }
      setBuildState("ready");
      if (autoRun) simulator.run();
      return true;
    }
  };

  const runOrPause = async () => {
    if (snapshot.status === "running") {
      simulator.pause();
      return;
    }
    if (buildState !== "ready" || simulator.getSource() !== project.code) await build(true);
    else simulator.run();
  };

  const submitPrompt = async (
    value = prompt,
    retry = false,
    retryModel = aiModel,
    retryMode: AssistantMode = assistantMode,
    retryHistory: ChatHistoryTurn[] = [],
    generationModeOverride?: "create" | "edit",
  ) => {
    const clean = value.trim();
    if (!clean || generating) return;
    const requestMode = retry ? retryMode : assistantMode;
    const requestHistory = retry
      ? retryHistory
      : chat.slice(-12).map(({ role, text }) => ({ role, text }));
    setSideTab("assistant");
    setGenerating(true);
    setGenerationError(null);
    setGenerationErrorDetails([]);
    setGenerationStage({ stage: "planning", detail: requestMode === "chat" ? "Preparing your reply." : "Preparing the circuit plan." });
    if (!retry) {
      setFailedGeneration(null);
      setPrompt(clean);
      setChat((items) => [...items, { id: uid("user"), role: "user", text: clean }]);
    }
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          prompt: clean,
          currentProject: project,
          model: retryModel,
          assistantMode: requestMode,
          ...(requestMode === "chat" ? { chatHistory: requestHistory } : {}),
          ...(requestMode === "build" && generationModeOverride ? { generationModeOverride } : {}),
        }),
      });
      const result = await readGenerationResponse(response, setGenerationStage);
      if (result.error) {
        throw new GenerationRequestError(
          result.error.message ?? "AI generation failed.",
          result.error.code,
          result.error.retryable ?? true,
          result.error.details,
        );
      }
      if (!response.ok) {
        throw new GenerationRequestError("AI generation failed.", "AI_UNAVAILABLE", true);
      }
      const responseModel = isGeminiModel(result.model) ? result.model : retryModel;
      if (result.kind === "chat") {
        const reply = typeof result.reply === "string" ? result.reply.trim() : "";
        if (!reply) throw new Error("AI returned an empty response.");
        setPrompt("");
        setFailedGeneration(null);
        setChat((items) => [...items, {
          id: uid("assistant"),
          role: "assistant",
          text: reply,
          meta: GEMINI_MODEL_LABELS[responseModel],
        }]);
        announce(`${GEMINI_MODEL_LABELS[responseModel]} replied`);
        return;
      }

      if (result.kind === "mode-clarification") {
        setPrompt(clean);
        setFailedGeneration(null);
        setChat((items) => [...items, {
          id: uid("assistant"),
          role: "assistant",
          text: result.message?.trim() || "Should I edit the circuit that is open, or create a separate new circuit?",
          meta: GEMINI_MODEL_LABELS[responseModel],
          modeChoice: { prompt: clean, model: responseModel },
        }]);
        announce("Choose whether to edit the current circuit or create a new one");
        return;
      }

      const parsed = safeParseCircuitProject(result.project);
      if (!parsed.success) {
        throw new Error("AI returned circuit data that failed project validation.");
      }
      const explanation = typeof result.explanation === "string"
        ? result.explanation.trim()
        : "";
      if (!explanation) {
        throw new Error("AI returned a circuit change without an explanation.");
      }

      const isEdit = result.generationMode === "edit";
      const previousProject = projectRef.current;
      const previousComponents = new Map(previousProject.components.map((component) => [component.id, component]));
      const fixedComponentIds = isEdit
        ? new Set(parsed.data.components.flatMap((component) => {
          const previous = previousComponents.get(component.id);
          return previous && previous.x === component.x && previous.y === component.y && previous.rotation === component.rotation
            ? [component.id]
            : [];
        }))
        : undefined;
      const nextProject = {
        ...parsed.data,
        id: previousProject.id,
        components: spaceGeneratedComponents(parsed.data.components, {
          ...(fixedComponentIds ? { fixedComponentIds } : {}),
          center: !isEdit,
        }),
      };
      const previousComponentIds = new Set(previousProject.components.map((component) => component.id));
      const metaParts = [GEMINI_MODEL_LABELS[responseModel], "simulation validated"];
      if (result.warnings?.length) metaParts.push(...result.warnings);
      const meta = metaParts.join(" · ");
      commitProject(nextProject);
      const layoutChanged = nextProject.components.some((component) => {
        const previous = previousComponents.get(component.id);
        return !previous || previous.x !== component.x || previous.y !== component.y || previous.rotation !== component.rotation;
      });
      if (!isEdit || layoutChanged) fitComponentsInCanvas(nextProject.components);
      setPendingPin(null);
      if (isEdit) {
        const addedIds = nextProject.components.filter((component) => !previousComponentIds.has(component.id)).map((component) => component.id);
        setSelectedIds(addedIds.length ? addedIds : selectedIds.filter((id) => nextProject.components.some((component) => component.id === id)));
      } else {
        const firstGeneratedPart = nextProject.components.find((component) => !isBoardType(component.type));
        setSelectedIds(firstGeneratedPart ? [firstGeneratedPart.id] : []);
      }
      const assumptions = Array.isArray(result.assumptions) ? result.assumptions.filter((item: unknown): item is string => typeof item === "string" && !!item.trim()) : [];
      const responseText = assumptions.length ? `${explanation}\n\nAssumption: ${assumptions.join("; ")}` : explanation;
      setChat((items) => [...items, { id: uid("assistant"), role: "assistant", text: responseText, meta }]);
      simulator.load(nextProject.code);
      setPrompt("");
      setFailedGeneration(null);
      announce(isEdit ? `${GEMINI_MODEL_LABELS[responseModel]} edited the circuit and code` : `${GEMINI_MODEL_LABELS[responseModel]} generated the circuit and code`);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "The app could not reach the AI service. Try again.";
      const requestError = error instanceof GenerationRequestError ? error : undefined;
      setGenerationError(requestError ? conciseGenerationError(requestError) : message);
      setGenerationErrorDetails([...new Set(requestError?.details ?? [])].slice(0, 20));
      setFailedGeneration({ prompt: clean, model: retryModel, assistantMode: requestMode, chatHistory: requestHistory, ...(generationModeOverride ? { generationModeOverride } : {}), retryable: requestError?.retryable ?? true, code: requestError?.code ?? "AI_UNAVAILABLE" });
      announce(requestMode === "chat" ? "AI chat reply failed" : "AI generation failed — current circuit unchanged");
    } finally {
      setGenerating(false);
      setGenerationStage(null);
      void refreshAiUsage();
    }
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "circuit"}.aics`;
    anchor.click();
    URL.revokeObjectURL(url);
    announce("Project exported");
  };

  const importProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = safeParseCircuitProject(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.issues[0]?.message);
      const imported = { ...parsed.data, id: projectRef.current.id };
      commitProject(imported);
      simulator.load(imported.code);
      fitComponentsInCanvas(imported.components);
      setSelectedIds([]);
      announce("Project imported");
    } catch {
      announce("That file is not a valid Cirkitra project");
    }
  };

  return (
    <main
      className="studio-shell"
      style={{
        "--left-panel-width": `${panelSizes.left}px`,
        "--right-panel-width": `${panelSizes.right}px`,
        "--bottom-drawer-height": `${panelSizes.bottom}px`,
        "--assistant-prompt-height": `${panelSizes.assistantPrompt}px`,
      } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="brand-block">
          <Image className="brand-logo" src="/cirkitra-logo.png" alt="" width={34} height={34} priority />
          <div>
            <div className="brand-name">Cirkitra</div>
            <div className="brand-owner">Founded by <strong>Ziad Sakr</strong></div>
          </div>
        </div>

        <div className="project-heading">
          <input
            className="project-name"
            aria-label="Project name"
            value={project.name}
            onChange={(event) => setProject((current) => ({ ...current, name: event.target.value }))}
            onBlur={() => commitProject(projectRef.current)}
          />
          <span className={`save-state ${cloudSaveState}`} role="status" aria-live="polite" title={cloudSaveState === "error" ? "Your latest changes are kept on this device. Click to retry cloud sync." : undefined}>
            <i></i>{cloudSaveState === "saving" ? "Saving…" : cloudSaveState === "error" ? <><span>Sync failed</span><button type="button" onClick={() => retryCloudSaveRef.current()}>Retry</button></> : "Saved to account"}
          </span>
        </div>

        <div className="top-actions">
          <Link className="text-button account-action projects-link" href="/projects">Projects</Link>
          <button className="icon-button desktop-only" onClick={undo} disabled={historyIndex <= 0} title="Undo (Ctrl+Z)">↶</button>
          <button className="icon-button desktop-only" onClick={redo} disabled={historyIndex >= historyLength - 1} title="Redo (Ctrl+Shift+Z)">↷</button>
          <button className="text-button" onClick={() => fileInputRef.current?.click()}>Import</button>
          <button className="text-button" onClick={exportProject}>Export</button>
          <button className={`build-button ${buildState}`} onClick={() => build(false)} disabled={buildState === "building"}>
            <span>{buildState === "building" ? "Building…" : buildState === "ready" ? "Build ready" : "Build sketch"}</span>
            <small>{buildState === "ready" ? "✓" : "⌘B"}</small>
          </button>
          <button className="text-button account-action signout-button" onClick={async () => { try { await signOutFromCirkitra(); router.replace("/"); router.refresh(); } catch { announce("Could not sign out. Please try again."); } }}>Sign out</button>
          <input ref={fileInputRef} hidden type="file" accept=".aics,.json,application/json" onChange={(event) => importProject(event.target.files?.[0])} />
        </div>
      </header>

      <section className="workspace">
        <aside className={`parts-panel ${mobilePanel === "library" ? "mobile-open" : ""}`} id="components-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Library</span><h2>Components</h2></div>
            <div className="panel-heading-actions">
              <span className="count-badge">{SUPPORTED_COMPONENT_TYPES.length}</span>
              <button className="mobile-panel-close" onClick={() => setMobilePanel(null)} aria-label="Close component library">×</button>
            </div>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder="Search parts" aria-label="Search components" />
            <kbd>/</kbd>
          </label>
            <div className="category-list" role="group" aria-label="Component categories; scroll horizontally for more" tabIndex={0}>
            {PALETTE_CATEGORIES.map((category) => (
              <button key={category} className={paletteCategory === category ? "active" : ""} onClick={() => setPaletteCategory(category)}>{CATEGORY_LABELS[category]}</button>
            ))}
          </div>
          <div className="parts-list">
            {parts.map((part) => (
              <button className="part-card" key={part.id} onClick={() => { addPart(part.id); setMobilePanel(null); }} title={`Add ${part.displayName}`}>
                <span className="part-glyph" style={{ "--part-accent": part.accent } as React.CSSProperties}>{PART_GLYPHS[part.id] ?? "IC"}</span>
                <span><strong>{part.displayName}</strong><small>{CATEGORY_LABELS[part.category]}</small></span>
                <i>+</i>
              </button>
            ))}
            {!parts.length && <p className="empty-note">No supported parts match that search.</p>}
          </div>
          <button
            type="button"
            role="separator"
            aria-label="Resize Components panel"
            aria-orientation="vertical"
            aria-controls="components-panel"
            aria-valuemin={PANEL_LIMITS.left.min}
            aria-valuemax={PANEL_LIMITS.left.max}
            aria-valuenow={Math.round(panelSizes.left)}
            aria-valuetext={`${Math.round(panelSizes.left)} pixels wide`}
            className={`panel-resizer panel-resizer-left ${panelResize?.target === "left" ? "active" : ""}`}
            title="Drag to resize. Double-click to reset. Use Left/Right, Home, or End from the keyboard."
            onPointerDown={(event) => beginPanelResize("left", event)}
            onDoubleClick={(event) => { event.preventDefault(); resetPanelSize("left"); }}
            onKeyDown={(event) => handlePanelResizeKey("left", event)}
          />
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div className="tool-group">
              <button className={`tool ${canvasTool === "select" && !spaceHeld ? "active" : ""}`} onClick={() => setCanvasTool("select")} aria-label="Select" title="Select, move, or drag a box around parts">↖ <span>Select</span></button>
              <button className={`tool ${canvasTool === "pan" || spaceHeld || panDrag ? "active" : ""}`} onClick={() => setCanvasTool("pan")} aria-label="Pan" title="Drag empty canvas to pan, or drag a component to move it. Middle-drag or hold Space to pan anywhere.">✋ <span>Pan</span></button>
              <button className={`tool ${pendingPin ? "active amber" : ""}`} onClick={() => setPendingPin(null)} aria-label={pendingPin ? "Cancel wire" : "Wire"} title="Wire">⌁ <span>{pendingPin ? "Cancel wire" : "Wire"}</span></button>
              <button className={`tool connections-tool ${showConnections ? "active" : ""}`} onClick={() => setShowConnections((value) => !value)} aria-label="Connections" title="Show connections" aria-expanded={showConnections} aria-controls="connection-list">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 5h5v10h5"/><circle cx="3" cy="5" r="2"/><circle cx="17" cy="15" r="2"/></svg>
                <span>Connections</span>
              </button>
            </div>
            <div className="mobile-panel-buttons" aria-label="Workspace panels">
              <button onClick={() => setMobilePanel("library")} aria-controls="components-panel" aria-expanded={mobilePanel === "library"}>Components</button>
              <button onClick={() => { setSideTab("assistant"); setMobilePanel("assistant"); }} aria-controls="ai-panel" aria-expanded={mobilePanel === "assistant"}>AI assistant</button>
            </div>
            <div className="canvas-title">
              <strong>Schematic</strong><span>{project.components.length} parts · {project.connections.length} wires</span>
              {wireRoutingError && <small className="wire-routing-error" role="status" aria-live="polite">{wireRoutingError}</small>}
            </div>
            <div className="zoom-controls">
              <button onClick={() => zoomAt(zoom - 0.1)} title="Zoom out">−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => zoomAt(zoom + 0.1)} title="Zoom in">+</button>
              <button onClick={fitCanvas} title="Fit all components">⊙</button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className={`canvas-viewport ${panDrag ? "is-panning" : ""} ${spaceHeld ? "space-pan" : ""} ${marquee ? "is-selecting" : ""}`}
            style={{
              "--grid-major": `${80 * zoom}px`,
              "--grid-minor": `${16 * zoom}px`,
              "--grid-pan-x": `${pan.x}px`,
              "--grid-pan-y": `${pan.y}px`,
            } as React.CSSProperties}
            onPointerDown={beginCanvasPan}
            onPointerMove={moveCanvasPan}
            onPointerUp={endCanvasPan}
            onPointerCancel={endCanvasPan}
            onWheel={handleCanvasWheel}
          >
            <div className={`schematic-grid ${tracedWire ? "tracing-wire" : ""}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {project.connections.map((connection, wireIndex) => {
                const fromComponent = componentById.get(connection.from.componentId);
                const toComponent = componentById.get(connection.to.componentId);
                const fromDefinition = fromComponent ? getComponentDefinition(fromComponent.type) : undefined;
                const toDefinition = toComponent ? getComponentDefinition(toComponent.type) : undefined;
                if (!fromComponent || !toComponent || !fromDefinition || !toDefinition) return null;
                const from = pinPosition({ ...fromComponent, rotation: 0 }, connection.from.pin, fromDefinition);
                const to = pinPosition({ ...toComponent, rotation: 0 }, connection.to.pin, toDefinition);
                if (!from || !to) return null;
                const fromPin = fromDefinition.pins.find((pin) => pin.id === connection.from.pin);
                const toPin = toDefinition.pins.find((pin) => pin.id === connection.to.pin);
                if (!fromPin || !toPin) return null;
                const route = wireRoutes.get(connection.id);
                if (!route) return null;
                const segments = route.segments;
                const wireTitle = `W${wireIndex + 1}: ${fromComponent.label} · ${fromPin.label} → ${toComponent.label} · ${toPin.label}. Click to trace.`;
                return (
                  <div className={`wire-route ${route.overlaid ? "overlaid" : ""} ${highlightedWireId === connection.id ? "highlighted" : ""}`} key={connection.id} style={{ "--wire-color": connection.color ?? "#47b86b" } as React.CSSProperties}>
                    {segments.map((segment, index) => {
                      const horizontal = segment.from.y === segment.to.y;
                      return (
                        <button
                          key={index}
                          className={`wire-segment ${horizontal ? "horizontal" : "vertical"}`}
                          style={{
                            left: Math.min(segment.from.x, segment.to.x),
                            top: Math.min(segment.from.y, segment.to.y),
                            width: horizontal ? Math.max(1, Math.abs(segment.to.x - segment.from.x)) : 9,
                            height: horizontal ? 9 : Math.max(1, Math.abs(segment.to.y - segment.from.y)),
                          }}
                          onPointerEnter={() => setHighlightedWireId(connection.id)}
                          onPointerLeave={() => setHighlightedWireId((current) => current === connection.id ? null : current)}
                          onFocus={() => setHighlightedWireId(connection.id)}
                          onBlur={() => setHighlightedWireId((current) => current === connection.id ? null : current)}
                          aria-label={wireTitle}
                          tabIndex={index === 0 ? 0 : -1}
                          aria-pressed={pinnedWireId === connection.id}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => { event.stopPropagation(); setPinnedWireId((current) => current === connection.id ? null : connection.id); }}
                        />
                      );
                    })}
                    {route.bridges.map((bridge, index) => (
                      <i
                        className={`wire-bridge ${bridge.orientation}`}
                        key={`bridge-${index}`}
                        style={{ left: bridge.point.x, top: bridge.point.y }}
                      />
                    ))}
                    <i className="wire-junction from" style={{ left: from.x, top: from.y }} />
                    <i className="wire-junction to" style={{ left: to.x, top: to.y }} />
                  </div>
                );
              })}

              {project.components.map((component) => {
                const definition = getComponentDefinition(component.type);
                const size = componentSize(component.type);
                const isSelected = selectedIds.includes(component.id);
                const isLedOn = component.type === "led" && isLedCircuitPowered(
                  ledCircuitBindings.get(component.id),
                  snapshot,
                );
                const isBuzzerOn = component.type === "buzzer" && isBuzzerActive(
                  buzzerCircuitBindings.get(component.id),
                  snapshot,
                );
                const servoState = component.type === "servo"
                  ? snapshot.servos.find((servo) => resolveComponentBoardPinEndpoints(project, component.id, "SIG").some((pin) => pin.boardId === (servo.boardId ?? project.board) && pin.componentId === (servo.boardComponentId ?? activeBoard?.id) && resolveBoardPin(pin.boardId, pin.pin) === servo.pin))
                  : undefined;
                const lcdState = component.type === "lcd-16x2" ? snapshot.lcds[0] : undefined;
                const electricalState = snapshot.componentStates[component.id];
                const symbolProperties = component.type === "servo" && servoState
                  ? { ...component.properties, angle: servoState.angle }
                  : component.type === "lcd-16x2" && lcdState
                    ? { ...component.properties, text: lcdState.lines.join("\n") }
                    : { ...component.properties, __electricalState: JSON.stringify(electricalState ?? null) };
                const isPowered = component.type === "buzzer"
                  ? isBuzzerOn
                  : (electricalState?.powered ?? isLedOn) || Boolean(servoState?.attached) || Boolean(lcdState) || Boolean(electricalState?.powered);
                
                // Apply CSS transform during drag - GPU accelerated, no wire recalc!
                const isDragging = dragState?.id === component.id;
                
                return (
                  <article
                    key={component.id}
                    className={`circuit-node schematic-component component-${component.type} ${isSelected ? "selected" : ""} ${isPowered ? "powered" : ""} ${isDragging ? "dragging" : ""}`}
                    style={{ 
                      left: component.x, 
                      top: component.y, 
                      width: size.width, 
                      height: size.height, 
                      "--node-accent": definition?.accent ?? "#64748b",
                      ...(isDragging ? { transition: "none" } : {})
                    } as React.CSSProperties}
                    onPointerDown={(event) => beginDrag(event, component)}
                    onDoubleClick={() => { setSelectedIds([component.id]); setSideTab("inspector"); }}
                  >
                    <div className="symbol-caption"><strong>{component.label}</strong><small>{component.type === "arduino-uno" ? "ARDUINO UNO R3" : definition?.displayName}</small></div>
                    <SchematicSymbol type={component.type} properties={symbolProperties} powered={isPowered || isBoardType(component.type)} simulationStatus={snapshot.status} playbackSpeed={snapshot.speed} zoom={zoom} />
                    {definition?.pins.map((pin) => {
                        const localPoint = pinPosition({ ...component, x: 0, y: 0, rotation: 0 }, pin.id, definition);
                        if (!localPoint) return null;
                        const active = pendingPin?.componentId === component.id && pendingPin.pin === pin.id;
                        const connectedWires = connectedWiresByPin.get(`${component.id}\u0000${pin.id}`) ?? [];
                        const highlightedWire = connectedWires.find((connection) => connection.id === highlightedWireId);
                        const displayWire = highlightedWire ?? connectedWires[0];
                        return <button key={pin.id} className={`schematic-pin side-${pin.side} ${active ? "active" : ""} ${displayWire ? "connected" : ""} ${highlightedWire ? "wire-highlighted" : ""}`} style={{ left: localPoint.x, top: localPoint.y, "--pin-wire-color": displayWire?.color ?? "#47b86b" } as React.CSSProperties} aria-label={pin.number ? `${pin.label}, pin ${pin.number}` : pin.label} title={`${pin.number ? `Pin ${pin.number} · ` : ""}${pin.label}${displayWire ? " · connected" : ""} · click to wire`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connectPin({ componentId: component.id, pin: pin.id }); }}><i />{(!definition.symbol || isBoardType(component.type)) && <span>{pin.label}</span>}</button>;
                      })}
                  </article>
                );
              })}
              <div className="canvas-origin"><i></i><span>0,0</span></div>
            </div>

            {marquee && (
              <div
                className="selection-marquee"
                aria-hidden="true"
                style={{
                  left: Math.min(marquee.startClientX, marquee.currentClientX),
                  top: Math.min(marquee.startClientY, marquee.currentClientY),
                  width: Math.abs(marquee.currentClientX - marquee.startClientX),
                  height: Math.abs(marquee.currentClientY - marquee.startClientY),
                }}
              />
            )}

            {showConnections && <div className="connection-panel" id="connection-list" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
              <div className="connection-panel-heading"><strong>Connections <small>{project.connections.length}</small></strong><button onClick={() => setShowConnections(false)} aria-label="Close connections">×</button></div>
              <p>Select a wire to isolate its path and endpoints.</p>
              <div className="connection-list">
                {project.connections.map((wire, index) => <button key={wire.id} className={highlightedWireId === wire.id ? "active" : ""} aria-pressed={pinnedWireId === wire.id} onClick={() => { setPinnedWireId((current) => current === wire.id ? null : wire.id); setSelectedIds([]); }}>
                  <span className="connection-number" style={{ color: wire.color ?? "#42d7bd" }}>W{index + 1}</span>
                  <span><strong>{endpointLabel(wire.from)}</strong><small>→ {endpointLabel(wire.to)}</small></span>
                </button>)}
                {!project.connections.length && <p>No wires yet. Connect two pins to add one.</p>}
              </div>
            </div>}
            {tracedWire && <div className="wire-trace-card" onPointerDown={(event) => event.stopPropagation()}>
              <span className="trace-swatch" style={{ background: tracedWire.color ?? "#42d7bd" }} />
              <div><strong>W{project.connections.indexOf(tracedWire) + 1} · {endpointLabel(tracedWire.from)}</strong><span>→ {endpointLabel(tracedWire.to)}</span>
              </div>
              <button onClick={() => { commitProject({ ...project, connections: project.connections.filter((wire) => wire.id !== tracedWire.id) }); setPinnedWireId(null); setHighlightedWireId(null); announce("Wire removed"); }}>Remove wire</button>
              <button onClick={() => { setPinnedWireId(null); setHighlightedWireId(null); }} aria-label="Clear wire trace">×</button>
            </div>}
            <div className="canvas-help">
              <span className={pendingPin ? "active" : ""}>{pendingPin ? `Wiring from ${pendingPin.pin} — choose a destination pin` : "Click a wire to trace · Connections lists every endpoint"}</span>
              <span>{selectedIds.length > 1 ? `${selectedIds.length} parts selected · Delete removes all` : "Drag empty space to select · Space or middle-drag to pan"}</span>
            </div>
            <div className="pan-readout" aria-hidden="true">X {Math.round(-pan.x / zoom)} &nbsp; Y {Math.round(-pan.y / zoom)}</div>
          </div>
        </section>

        <aside className={`ai-panel ${mobilePanel === "assistant" ? "mobile-open" : ""}`} id="ai-panel">
          <button
            type="button"
            role="separator"
            aria-label="Resize AI and Inspector panel"
            aria-orientation="vertical"
            aria-controls="ai-panel"
            aria-valuemin={PANEL_LIMITS.right.min}
            aria-valuemax={PANEL_LIMITS.right.max}
            aria-valuenow={Math.round(panelSizes.right)}
            aria-valuetext={`${Math.round(panelSizes.right)} pixels wide`}
            className={`panel-resizer panel-resizer-right ${panelResize?.target === "right" ? "active" : ""}`}
            title="Drag to resize. Double-click to reset. Use Left/Right, Home, or End from the keyboard."
            onPointerDown={(event) => beginPanelResize("right", event)}
            onDoubleClick={(event) => { event.preventDefault(); resetPanelSize("right"); }}
            onKeyDown={(event) => handlePanelResizeKey("right", event)}
          />
          <div className="side-tabs" role="tablist">
            <button className={sideTab === "assistant" ? "active" : ""} onClick={() => setSideTab("assistant")}>AI assistant <span className="spark">✦</span></button>
            <button className={sideTab === "inspector" ? "active" : ""} onClick={() => setSideTab("inspector")}>Inspector</button>
            <button className="mobile-panel-close" onClick={() => setMobilePanel(null)} aria-label="Close AI assistant">×</button>
          </div>

          {sideTab === "assistant" ? (
            <>
              <div className="chat-scroll">
                <div className="ai-model-line"><span></span> {assistantMode === "chat" ? "GENERAL AI CHAT" : "AI CIRCUIT BUILDER"} {assistantMode === "build" && <i>SUPPORTED PARTS ONLY</i>}</div>
                {!chat.length && !generating && (
                  <div className="ai-empty-state">
                    <p>{assistantMode === "chat"
                      ? "Ask anything, or ask about the circuit open in the editor. Chat will not change your circuit."
                      : "Describe a circuit to create or an edit to make. Cirkitra will generate the schematic, wiring, and Arduino code together."}</p>
                  </div>
                )}
                {chat.map((message) => {
                  const modeChoice = message.modeChoice;
                  return (
                    <div className={`chat-message ${message.role}`} key={message.id}>
                      {message.role === "assistant" && <div className="avatar">✦</div>}
                      <div>
                        {message.role === "assistant"
                          ? <AssistantMarkdown text={message.text} />
                          : <p>{message.text}</p>}
                        {modeChoice && (
                          <div className="mode-choice-actions" role="group" aria-label="Choose how to apply this request">
                            <button
                              type="button"
                              disabled={generating || !!modeChoice.selected}
                              aria-pressed={modeChoice.selected === "edit"}
                              onClick={() => {
                                setChat((items) => items.map((item) => item.id === message.id && item.modeChoice
                                  ? { ...item, modeChoice: { ...item.modeChoice, selected: "edit" } }
                                  : item));
                                void submitPrompt(modeChoice.prompt, true, modeChoice.model, "build", [], "edit");
                              }}
                            >Edit current circuit</button>
                            <button
                              type="button"
                              disabled={generating || !!modeChoice.selected}
                              aria-pressed={modeChoice.selected === "create"}
                              onClick={() => {
                                setChat((items) => items.map((item) => item.id === message.id && item.modeChoice
                                  ? { ...item, modeChoice: { ...item.modeChoice, selected: "create" } }
                                  : item));
                                void submitPrompt(modeChoice.prompt, true, modeChoice.model, "build", [], "create");
                              }}
                            >Create new circuit</button>
                          </div>
                        )}
                        {message.meta && <small>{message.meta}</small>}
                      </div>
                    </div>
                  );
                })}
                {generating && <div className="chat-message assistant"><div className="avatar">✦</div><div className="thinking"><i></i><i></i><i></i><span>{generationStage?.detail ?? (assistantMode === "chat" ? "Writing a reply…" : "Working on your circuit…")}</span></div></div>}
              </div>
              <button
                type="button"
                role="separator"
                aria-label="Resize chat and prompt panels"
                aria-orientation="horizontal"
                aria-controls="ai-panel"
                aria-valuemin={PANEL_LIMITS.assistantPrompt.min}
                aria-valuemax={PANEL_LIMITS.assistantPrompt.max}
                aria-valuenow={Math.round(panelSizes.assistantPrompt)}
                aria-valuetext={`${Math.round(panelSizes.assistantPrompt)} pixels tall`}
                className={`panel-resizer panel-resizer-assistant ${panelResize?.target === "assistantPrompt" ? "active" : ""}`}
                title="Drag up or down to resize chat and prompt. Double-click to reset. Use Up/Down, Home, or End from the keyboard."
                tabIndex={sideTab === "assistant" ? 0 : -1}
                aria-hidden={sideTab !== "assistant"}
                onPointerDown={(event) => beginPanelResize("assistantPrompt", event)}
                onDoubleClick={(event) => { event.preventDefault(); resetPanelSize("assistantPrompt"); }}
                onKeyDown={(event) => handlePanelResizeKey("assistantPrompt", event)}
              />
              <div className="prompt-zone">
                <div className="prompt-controls-scroll">
                <label className="assistant-mode-select">
                  <span>Mode</span>
                  <select
                    aria-label="Assistant mode"
                    value={assistantMode}
                    disabled={generating}
                    onChange={(event) => {
                      const nextMode = event.target.value;
                      if (nextMode !== "chat" && nextMode !== "build") return;
                      setAssistantMode(nextMode);
                      setGenerationError(null);
                      setGenerationErrorDetails([]);
                      setFailedGeneration(null);
                    }}
                  >
                    <option value="chat">Chat</option>
                    <option value="build">Build</option>
                  </select>
                </label>
                <div className={`ai-usage-card${aiUsage && !aiUsage.unlimited && aiUsage.remaining === 0 ? " is-empty" : ""}`} aria-live="polite">
                  <span className="ai-usage-mark" aria-hidden="true">✦</span>
                  <div className="ai-usage-copy">
                    <span className="ai-usage-plan">{aiUsage ? aiUsage.unlimited ? "OWNER ACCESS" : `${aiUsage.planName} CIRCUIT PLAN` : "CIRCUIT PLAN"}</span>
                    <strong>
                      {aiUsage
                        ? aiUsage.unlimited
                          ? "Unlimited AI circuit requests"
                          : aiUsage.remaining === 0
                          ? `You've used all ${aiUsage.limit} AI requests`
                          : `${aiUsage.remaining} of ${aiUsage.limit} AI requests left`
                        : "Checking your AI requests…"}
                    </strong>
                      {aiUsage && !aiUsage.unlimited && <span className="ai-usage-meter" role="progressbar" aria-label="AI requests used" aria-valuemin={0} aria-valuemax={aiUsage.limit} aria-valuenow={Math.max(0, Math.min(aiUsage.limit, aiUsage.limit - aiUsage.remaining))}>
                        <i style={{ width: `${aiUsage.limit > 0 ? Math.max(0, Math.min(100, ((aiUsage.limit - aiUsage.remaining) / aiUsage.limit) * 100)) : 0}%` }} />
                      </span>}
                    {assistantMode === "chat" && <span className="ai-usage-note">Chat doesn’t use circuit requests.</span>}
                  </div>
                  {!aiUsage?.unlimited && <Link className="ai-usage-upgrade" href="/pricing" aria-label="View Cirkitra upgrade plans">
                    Upgrade <span aria-hidden="true">↗</span>
                  </Link>}
                </div>
                {generationError && (
                  <div className="generation-error" role="alert">
                    <strong>{failedGeneration?.assistantMode === "chat" ? "Chat reply failed" : "Circuit not generated"}</strong>
                    <span>{generationError}</span>
                    {generationErrorDetails.length > 0 && (
                      <details className="generation-error-diagnostics">
                        <summary>View diagnostics ({generationErrorDetails.length})</summary>
                        <small className="generation-error-details">{generationErrorDetails.join(" · ")}</small>
                      </details>
                    )}
                    <small>Your current circuit was not changed.</small>
                    <small className="generation-error-next-action">{generationFailureNextStep(failedGeneration?.code, generationErrorDetails)}</small>
                    {failedGeneration?.retryable && <button type="button" onClick={() => submitPrompt(failedGeneration.prompt, true, failedGeneration.model, failedGeneration.assistantMode, failedGeneration.chatHistory, failedGeneration.generationModeOverride)}>Retry this prompt</button>}
                  </div>
                )}
                <label className="model-selector">
                  <span>AI model</span>
                  <select
                    aria-label="AI model"
                    value={aiModel}
                    disabled={generating}
                    onChange={(event) => {
                      const nextModel = event.target.value;
                      if (!isGeminiModel(nextModel)) return;
                      setAiModel(nextModel);
                      window.localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
                    }}
                  >
                    {GEMINI_MODELS.map((model) => <option key={model} value={model}>{GEMINI_MODEL_LABELS[model]}</option>)}
                  </select>
                </label>
                {assistantMode === "build" && <div className="suggestion-row">
                  {["Traffic light with 3 LEDs", "Buzzer alert every second", "Blink LED fast"].map((item) => <button key={item} onClick={() => submitPrompt(item)}>{item}</button>)}
                </div>}
                </div>
                <label className="prompt-box">
                  <textarea value={prompt} disabled={generating} onChange={(event) => { setPrompt(event.target.value); setGenerationError(null); setGenerationErrorDetails([]); setFailedGeneration(null); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitPrompt(); } }} placeholder={assistantMode === "chat" ? "Ask Cirkitra anything…" : "Describe a circuit to build or edit…"} rows={3} />
                  <div><span>Enter to {assistantMode === "chat" ? "send" : "build"} · Shift+Enter for a new line</span><button onClick={() => submitPrompt()} disabled={!prompt.trim() || generating} aria-label={assistantMode === "chat" ? "Send chat message" : "Build circuit"}>↑</button></div>
                </label>
                <p className="ai-disclaimer"><i></i> AI can make mistakes. Verify generated circuits and advice before relying on them.{assistantMode === "chat" ? " Chat does not change your circuit or use circuit request credits." : " Generated output is checked before reaching your canvas."}</p>
              </div>
            </>
          ) : (
            <div className="inspector-content">
              {selectedIds.length > 1 ? (
                <div className="multi-selection-inspector">
                  <span>{selectedIds.length}</span>
                  <h3>Components selected</h3>
                  <p>Press Delete or remove them together. Attached wires will also be removed.</p>
                  <button className="danger-button" onClick={removeSelectedComponents}>Remove selected components</button>
                </div>
              ) : selected && selectedDefinition ? (
                <>
                  <div className="inspector-hero"><span style={{ "--part-accent": selectedDefinition.accent } as React.CSSProperties}>{PART_GLYPHS[selected.type] ?? "IC"}</span><div><small>SELECTED COMPONENT</small><h3>{selectedDefinition.displayName}</h3><p>{selectedDefinition.description}</p></div></div>
                  <label className="field-label">Reference label<input value={selected.label} onChange={(event) => setProject((current) => ({ ...current, components: current.components.map((component) => component.id === selected.id ? { ...component, label: event.target.value } : component) }))} onBlur={() => commitProject(projectRef.current)} /></label>
                  <div className="coordinate-row"><label>X<input type="number" value={Math.round(selected.x)} onChange={(event) => updateSelected({ x: Number(event.target.value) })} /></label><label>Y<input type="number" value={Math.round(selected.y)} onChange={(event) => updateSelected({ y: Number(event.target.value) })} /></label></div>
                  {Object.entries(selectedDefinition.properties).map(([key, property]) => (
                    <label className="field-label" key={key}>{property.label}{property.unit ? ` (${property.unit})` : ""}
                      {property.kind === "boolean" ? <input type="checkbox" checked={Boolean(selected.properties?.[key] ?? property.defaultValue)} onChange={(event) => updateSelected({ properties: { ...selected.properties, [key]: event.target.checked } })} /> : <input type={property.kind === "number" ? "number" : property.kind === "color" ? "color" : "text"} min={property.min} max={property.max} step={property.kind === "number" ? "any" : undefined} value={String(selected.properties?.[key] ?? property.defaultValue)} onChange={(event) => updateSelected({ properties: { ...selected.properties, [key]: property.kind === "number" ? Number(event.target.value) : event.target.value } })} />}
                    </label>
                  ))}
                  {COMPONENT_CATALOG[selected.type] && <DeviceFeedback key={selected.id} component={selected} state={snapshot.componentStates[selected.id]} status={snapshot.status} inject={(id, payload) => simulator.injectPacket(id, payload)} />}
                  <section className="component-capabilities">
                    <p>{selectedDefinition.simulation?.behavior ?? "Supported by the normalized browser simulator."}</p>
                    <p>{selectedDefinition.simulation?.limitations ?? "Electrical levels are normalized; this is not an analog circuit analysis."}</p>
                    {selectedDefinition.metadata && <>
                      <h4>{selectedDefinition.metadata.manufacturer}</h4><p>{selectedDefinition.metadata.variant}</p>
                      <p>{selectedDefinition.metadata.interfaces.join(" · ")}</p>
                      {selectedDefinition.metadata.supplies.map((supply, index) => <p key={index}>{supply.pins.join(", ")}: {supply.minVolts}–{supply.maxVolts} V</p>)}
                      {selectedDefinition.metadata.currentRatings?.map(rating => <p key={rating.label}>{rating.label}: {rating.maxAmps} A. {rating.conditions}</p>)}
                      {selectedDefinition.metadata.notes.map(note => <p key={note}>{note}</p>)}
                      {selectedDefinition.metadata.documentation.map(doc => <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer">Datasheet · {doc.section}</a>)}
                      <h4>Hardware library references</h4>
                      {selectedDefinition.metadata.libraries.length ? selectedDefinition.metadata.libraries.map(library => <p key={library.url}><a href={library.url} target="_blank" rel="noreferrer">{library.name}</a><small>{library.note}</small></p>) : <p>{selectedDefinition.metadata.libraryNote}</p>}
                    </>}
                  </section>
                  <div className="pin-table"><header><span>Pin</span><span>Signals</span></header>{selectedDefinition.pins.map((pin) => <button key={pin.id} onClick={() => connectPin({ componentId: selected.id, pin: pin.id })}><strong>{pin.number ? `${pin.number} · ` : ""}{pin.id}</strong><span>{pin.noConnect ? "Do not connect" : pin.signals.join(" · ")}</span></button>)}</div>
                  <button className="danger-button" onClick={() => removeComponent(selected.id)}>Remove component</button>
                </>
              ) : <div className="inspector-empty"><span>↖</span><h3>Select a component</h3><p>Click a part on the schematic to edit its label, values, pins, and placement.</p></div>}
            </div>
          )}
        </aside>

        {mobilePanel && <button className="mobile-panel-backdrop" onClick={() => setMobilePanel(null)} aria-label="Close open panel" />}
      </section>

      <section className={`bottom-drawer ${bottomOpen ? "open" : "closed"}`} id="bottom-drawer">
        {bottomOpen && (
          <button
            type="button"
            role="separator"
            aria-label="Resize Code and Serial drawer"
            aria-orientation="horizontal"
            aria-controls="bottom-drawer"
            aria-valuemin={PANEL_LIMITS.bottom.min}
            aria-valuemax={PANEL_LIMITS.bottom.max}
            aria-valuenow={Math.round(panelSizes.bottom)}
            aria-valuetext={`${Math.round(panelSizes.bottom)} pixels tall`}
            className={`panel-resizer panel-resizer-bottom ${panelResize?.target === "bottom" ? "active" : ""}`}
            title="Drag to resize. Double-click to reset. Use Up/Down, Home, or End from the keyboard."
            onPointerDown={(event) => beginPanelResize("bottom", event)}
            onDoubleClick={(event) => { event.preventDefault(); resetPanelSize("bottom"); }}
            onKeyDown={(event) => handlePanelResizeKey("bottom", event)}
          />
        )}
        <div className="drawer-bar">
          <div className="bottom-tabs">
            <button className={bottomTab === "code" ? "active" : ""} onClick={() => { setBottomTab("code"); setBottomOpen(true); }}>Sketch.ino <span className="language-dot">C++</span></button>
            {boards.length > 0 && <label className="sketch-board-select"><span>Board</span><select aria-label="Board sketch" value={activeBoard?.id ?? ""} onChange={event => switchSketchBoard(event.target.value)}>{boards.map(board => <option key={board.id} value={board.id}>{board.label}</option>)}</select></label>}
            <button className={bottomTab === "serial" ? "active" : ""} onClick={() => { setBottomTab("serial"); setBottomOpen(true); }}>Serial monitor <i>{snapshot.serial.length}</i></button>
            <button className={bottomTab === "problems" ? "active" : ""} onClick={() => { setBottomTab("problems"); setBottomOpen(true); }}>Problems <i className={problemMessages.some((message) => message.severity === "error") ? "error" : ""}>{problemMessages.length}</i></button>
          </div>
          <div className="simulation-controls">
            <span className={`sim-status ${snapshot.status}`}><i></i>{statusLabel(snapshot)}</span>
            <label>Speed<select value={snapshot.speed} onChange={(event) => simulator.setSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select></label>
            <button className="control-button" onClick={() => simulator.reset()} title="Reset">↺</button>
            <button className="control-button" onClick={() => simulator.step()} title="Step">↦</button>
            <button className={`run-button ${snapshot.status === "running" ? "pause" : ""}`} onClick={runOrPause}>{snapshot.status === "running" ? "Ⅱ  Pause" : "▶  Run simulation"}</button>
            <button className="drawer-toggle" onClick={() => setBottomOpen((open) => !open)}>{bottomOpen ? "⌄" : "⌃"}</button>
          </div>
        </div>

        {bottomOpen && (
          <div className="drawer-content">
            {bottomTab === "code" && <div className="code-editor"><pre ref={codeLineNumbersRef} aria-hidden="true">{project.code.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</pre><textarea spellCheck={false} aria-label={`${activeBoardName} sketch`} value={project.code} onChange={(event) => { setProject((current) => updateActiveBoardProgram(current, event.target.value)); setBuildState("idle"); }} onScroll={(event) => { if (codeLineNumbersRef.current) codeLineNumbersRef.current.scrollTop = event.currentTarget.scrollTop; }} onBlur={() => commitProject(projectRef.current)} /></div>}
            {bottomTab === "serial" && <div className="serial-console"><header><span>{activeBoardName} · Serial output</span><button onClick={() => simulator.clearSerial()}>Clear output</button></header><div>{snapshot.serial.length ? snapshot.serial.map((entry) => <p key={entry.id}><time>{(entry.timestampMs / 1000).toFixed(2)}s</time><span>{entry.text}{entry.newline ? "" : "_"}</span></p>) : <div className="console-empty">Run the selected board to see its Serial output here.<small>Choose another board to inspect its sketch and output.</small></div>}</div></div>}
            {bottomTab === "problems" && <div className="problems-list">{hasEnableRepair && <button className="motor-enable-repair" onClick={() => { commitProject(enableRepair); announce(missingEnableCount > 0 ? `Repaired ${missingEnableCount} motor driver enable ${missingEnableCount === 1 ? "pin" : "pins"}` : "Repaired floating motor driver standby wiring"); }}><span>↗</span><strong>{missingEnableCount > 0 ? `Connect ${missingEnableCount} disconnected motor driver enable or standby ${missingEnableCount === 1 ? "pin" : "pins"}` : "Fix floating motor driver standby wiring"}</strong><small>Fix wiring</small></button>}{problemMessages.length ? problemMessages.map((message, index) => <button key={index} onClick={() => setBottomTab("code")}><span className={message.severity}>{message.severity === "error" ? "×" : "!"}</span><strong>{message.message}</strong><small>{message.line ? `Sketch.ino:${message.line}` : "Circuit"}</small></button>) : <div className="console-empty"><span className="success-check">✓</span>No build problems detected.<small>The supported simulation subset is ready.</small></div>}</div>}
          </div>
        )}
      </section>

      <footer className="statusbar">
        <span><i className={boards.length ? "status-ok" : "status-warning"}></i>{boards.length === 0 ? "No board" : boards.length === 1 ? activeBoardName : `${boards.length} boards · ${activeBoardName} active`}</span><span>Digital simulator</span><span>{project.components.length} components</span><span>{project.connections.length} nets</span><span className="status-spacer"></span><span>Schema v{project.schemaVersion}</span><span>Local project</span>
      </footer>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
