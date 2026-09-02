"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import Image from "next/image";
import {
  COMPONENT_CATALOG,
  SUPPORTED_COMPONENT_TYPES,
  createDefaultBlinkProject,
  createDefaultProperties,
  getComponentDefinition,
  normalizeGroundReturns,
  removeComponentFromProject,
  removeComponentsFromProject,
  safeParseCircuitProject,
  type CircuitComponent,
  type CircuitProject,
  type ConnectionEndpoint,
} from "../lib/circuit";
import {
  ArduinoSimulator,
  isBuzzerCircuitPowered,
  isLedCircuitPowered,
  resolveBuzzerCircuitBindings,
  resolveComponentBoardPins,
  resolveComponentIoPins,
  resolveLedCircuitBindings,
  solveCircuit,
  parseUnoPinLabel,
  type SimulatorSnapshot,
} from "../lib/simulator";
import {
  centerComponentsAtOrigin,
  componentSize,
  coordinatedWireRoutes,
  fitViewport,
  pinPosition,
} from "../lib/schematic";
import { SchematicSymbol } from "./schematic-symbols";

const STORAGE_KEY = "ai-circuit-studio.project.v1";
const LAYOUT_STORAGE_KEY = "ai-circuit-studio.layout.v1";
const MODEL_STORAGE_KEY = "ai-circuit-studio.ai-model.v1";
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"] as const;
type GeminiModel = (typeof GEMINI_MODELS)[number];
const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-3.5-flash";
const GEMINI_MODEL_LABELS: Record<GeminiModel, string> = {
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
};
const WIRE_COLORS = ["#ffb547", "#ff6b6b", "#56d7c3", "#68a7ff", "#b38cff"];
const PALETTE_CATEGORIES = ["all", "boards", "passives", "inputs", "outputs", "displays", "sensors", "logic"] as const;

type SideTab = "assistant" | "inspector";
type BottomTab = "code" | "serial" | "problems";
type ChatMessage = { id: string; role: "assistant" | "user"; text: string; meta?: string };
type CompileMessage = { severity: "error" | "warning"; line?: number; message: string };
type PanelSizes = { left: number; right: number; bottom: number };
type ResizeTarget = keyof PanelSizes;
type PanelResizeState = {
  target: ResizeTarget;
  startX: number;
  startY: number;
  startSize: number;
};
type CanvasTool = "select" | "pan";
type MobilePanel = "library" | "assistant" | null;
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

const DEFAULT_PANEL_SIZES: PanelSizes = { left: 232, right: 356, bottom: 230 };
const PANEL_LIMITS = {
  left: { min: 176, max: 380 },
  right: { min: 280, max: 560 },
  bottom: { min: 140, max: 520 },
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

function constrainPanelSizes(sizes: Partial<PanelSizes>, viewportWidth: number, viewportHeight: number): PanelSizes {
  let left = clamp(finiteSize(sizes.left, DEFAULT_PANEL_SIZES.left), PANEL_LIMITS.left.min, PANEL_LIMITS.left.max);
  let right = clamp(finiteSize(sizes.right, DEFAULT_PANEL_SIZES.right), PANEL_LIMITS.right.min, PANEL_LIMITS.right.max);
  const bottom = clamp(
    finiteSize(sizes.bottom, DEFAULT_PANEL_SIZES.bottom),
    PANEL_LIMITS.bottom.min,
    bottomMaximum(viewportHeight),
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

  return { left, right, bottom };
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
let isFirstRender = true;

function uid(prefix: string) {
  // Use deterministic counter-based IDs for SSR and initial client render
  // After hydration, use timestamp-based IDs for uniqueness
  if (typeof window === 'undefined' || isFirstRender) {
    return `${prefix}-${uidCounter++}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function deepClone(project: CircuitProject): CircuitProject {
  return JSON.parse(JSON.stringify(project)) as CircuitProject;
}

function statusLabel(snapshot: SimulatorSnapshot) {
  if (snapshot.status === "running") return "Simulation running";
  if (snapshot.status === "paused") return "Simulation paused";
  if (snapshot.status === "error") return "Code needs attention";
  if (snapshot.status === "completed") return "Simulation complete";
  return "Ready to simulate";
}

export function CircuitStudio() {
  const [hydrated, setHydrated] = useState(false);
  const initialProject = useMemo(() => createDefaultBlinkProject(), []);
  const [project, setProject] = useState<CircuitProject>(initialProject);
  const projectRef = useRef(project);
  const historyRef = useRef<CircuitProject[]>([deepClone(initialProject)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyLength, setHistoryLength] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>(["led1"]);
  const [pendingPin, setPendingPin] = useState<ConnectionEndpoint | null>(null);
  const [highlightedWireId, setHighlightedWireId] = useState<string | null>(null);
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
  const [aiModel, setAiModel] = useState<GeminiModel>(DEFAULT_GEMINI_MODEL);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [compileMessages, setCompileMessages] = useState<CompileMessage[]>([]);
  const [buildState, setBuildState] = useState<"idle" | "building" | "ready" | "error">("idle");
  const [dragState, setDragState] = useState<{ id: string; startX: number; startY: number; currentX: number; currentY: number; componentX: number; componentY: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [simulator] = useState(() => new ArduinoSimulator(initialProject.code));
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot>(() => simulator.getSnapshot());

  useEffect(() => {
    projectRef.current = project;
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
    } else {
      if (event.key === "ArrowUp") nextSize = panelSizes.bottom + step;
      if (event.key === "ArrowDown") nextSize = panelSizes.bottom - step;
    }
    if (nextSize === null) return;
    event.preventDefault();
    event.stopPropagation();
    setPanelSize(target, nextSize);
  };

  const commitProject = useCallback((next: CircuitProject) => {
    const normalized = normalizeGroundReturns(next);
    const copy = deepClone(normalized);
    const nextHistory = historyRef.current.slice(0, historyIndex + 1);
    nextHistory.push(copy);
    if (nextHistory.length > 60) nextHistory.shift();
    historyRef.current = nextHistory;
    setHistoryIndex(nextHistory.length - 1);
    setHistoryLength(nextHistory.length);
    setProject(normalized);
    setBuildState("idle");
  }, [historyIndex]);

  useEffect(() => {
    // Prevent hydration mismatch by deferring localStorage access until after mount
    if (typeof window === 'undefined') return;
    
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = safeParseCircuitProject(JSON.parse(saved));
        if (parsed.success) {
          const normalized = normalizeGroundReturns(parsed.data);
          queueMicrotask(() => {
            setProject(normalized);
            historyRef.current = [deepClone(normalized)];
            setHistoryIndex(0);
            setHistoryLength(1);
          });
        }
      }
    } catch {
      // A broken local draft should never prevent the studio from opening.
    }
    queueMicrotask(() => {
      setHydrated(true);
      isFirstRender = false; // Allow timestamp-based IDs after hydration
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [hydrated, project]);

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
    const resizeClass = panelResize.target === "bottom" ? "resizing-row" : "resizing-column";
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
        const solved = solveCircuit(project, simulator.getSnapshot());
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
  }, [project, simulator]);

  useEffect(() => {
    if (!dragState) return;
    
    const move = (event: PointerEvent) => {
      // Just update the current mouse position - no project state changes!
      setDragState(current => current ? {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
      } : null);
    };
    
    const up = () => {
      // NOW update the actual project - only once!
      const dx = (dragState.currentX - dragState.startX) / zoom;
      const dy = (dragState.currentY - dragState.startY) / zoom;
      
      setProject((current) => ({
        ...current,
        components: current.components.map((component) =>
          component.id === dragState.id
            ? { ...component, x: dragState.componentX + dx, y: dragState.componentY + dy }
            : component,
        ),
      }));
      
      // Add to history
      queueMicrotask(() => {
        const nextHistory = historyRef.current.slice(0, historyIndex + 1);
        nextHistory.push(deepClone(projectRef.current));
        historyRef.current = nextHistory;
        setHistoryIndex(nextHistory.length - 1);
        setHistoryLength(nextHistory.length);
      });
      
      setDragState(null);
      setBuildState("idle");
    };
    
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
  const arduinoCount = project.components.filter((component) => component.type === "arduino-uno").length;
  const ledCircuitBindings = useMemo(
    () => resolveLedCircuitBindings(project),
    [project.components, project.connections], // More specific dependencies
  );
  const buzzerCircuitBindings = useMemo(
    () => resolveBuzzerCircuitBindings(project),
    [project.components, project.connections], // More specific dependencies
  );
  
  // Throttle circuit diagnostics to improve performance with complex circuits
  const circuitMessages = useMemo<CompileMessage[]>(() => {
    // Only recalculate diagnostics when project structure changes, not on every snapshot update
    const diagnostics = solveCircuit(project, snapshot).diagnostics;
    return diagnostics.map((item) => ({ 
      severity: item.severity, 
      message: item.message 
    }));
  }, [project.components, project.connections]); // Removed snapshot dependency for better performance
  
  const problemMessages = useMemo(() => [...compileMessages, ...circuitMessages], [compileMessages, circuitMessages]);
  useEffect(() => {
    project.components.forEach((component) => {
      if (component.type === "pir-sensor") {
        resolveComponentIoPins(project, component.id, "OUT").forEach((pin) => simulator.setDigitalInput(pin, component.properties?.motion === true));
      }
      if (component.type === "temperature-sensor") {
        const temperature = Number(component.properties?.temperatureC ?? 24);
        const analogValue = Math.round(((temperature / 100 + 0.5) / 5) * 1023);
        resolveComponentIoPins(project, component.id, "OUT").forEach((pin) => simulator.setAnalogInput(pin, analogValue));
      }
      if (component.type === "hc-sr04") {
        const distance = Number(component.properties?.distanceCm ?? 100);
        resolveComponentIoPins(project, component.id, "ECHO").forEach((pin) => simulator.setPulseInput(pin, distance * 58.3));
      }
      if (component.type === "push-button") {
        const pressed = component.properties?.pressed === true;
        const normallyClosed = component.properties?.normallyClosed === true;
        const level = pressed !== normallyClosed ? 0 : 1;
        ["1", "2"].flatMap((terminal) => resolveComponentIoPins(project, component.id, terminal))
          .forEach((pin) => simulator.setDigitalInput(pin, level));
      }
    });
  }, [project, simulator]);
  const wireRoutes = useMemo(() => {
    const inputs = project.connections.flatMap((connection) => {
      const fromComponent = project.components.find((component) => component.id === connection.from.componentId);
      const toComponent = project.components.find((component) => component.id === connection.to.componentId);
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
    
    // Use a fast routing algorithm - coordinatedWireRoutes can be expensive
    const routes = coordinatedWireRoutes(inputs, project.components);
    return new Map(routes.map((route) => [route.id, route]));
  }, [project.components, project.connections]);

  const parts = useMemo(() => {
    const search = paletteSearch.trim().toLowerCase();
    return SUPPORTED_COMPONENT_TYPES
      .map((type) => COMPONENT_CATALOG[type])
      .filter((definition) => paletteCategory === "all" || definition.category === paletteCategory)
      .filter((definition) => !search || `${definition.displayName} ${definition.description}`.toLowerCase().includes(search));
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
    commitProject({ ...project, components: [...project.components, component] });
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
    setDragState({ 
      id: component.id, 
      startX: event.clientX, 
      startY: event.clientY, 
      currentX: event.clientX, 
      currentY: event.clientY,
      componentX: component.x, 
      componentY: component.y 
    });
  };

  const beginCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
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

  const submitPrompt = async (value = prompt) => {
    const clean = value.trim();
    if (!clean || generating) return;
    setPrompt("");
    setSideTab("assistant");
    setGenerating(true);
    setGenerationError(null);
    setChat((items) => [...items, { id: uid("user"), role: "user", text: clean }]);
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: clean, currentProject: project, model: aiModel }),
      });
      const result = await response.json() as {
        kind?: "chat";
        reply?: string;
        project?: unknown;
        explanation?: string;
        warnings?: string[];
        model?: unknown;
        error?: { code?: string; message?: string };
      };
      if (!response.ok) {
        throw new Error(
          result.error?.message ||
          `AI generation failed${result.error?.code ? ` (${result.error.code})` : ""}.`,
        );
      }

      const responseModel = isGeminiModel(result.model) ? result.model : aiModel;
      if (result.kind === "chat") {
        const reply = typeof result.reply === "string" ? result.reply.trim() : "";
        if (!reply) throw new Error("AI returned an empty response.");
        setChat((items) => [...items, {
          id: uid("assistant"),
          role: "assistant",
          text: reply,
          meta: GEMINI_MODEL_LABELS[responseModel],
        }]);
        announce(`${GEMINI_MODEL_LABELS[responseModel]} replied`);
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
        throw new Error("AI returned a circuit without an explanation.");
      }

      const nextProject = {
        ...parsed.data,
        components: centerComponentsAtOrigin(parsed.data.components),
      };
      const metaParts = [GEMINI_MODEL_LABELS[responseModel], "schema validated"];
      if (result.warnings?.length) metaParts.push(...result.warnings);
      const meta = metaParts.join(" · ");
      commitProject(nextProject);
      fitComponentsInCanvas(nextProject.components);
      setPendingPin(null);
      const firstGeneratedPart = nextProject.components.find(
        (component) => component.type !== "arduino-uno",
      );
      setSelectedIds(firstGeneratedPart ? [firstGeneratedPart.id] : []);
      setChat((items) => [...items, { id: uid("assistant"), role: "assistant", text: explanation, meta }]);
      simulator.load(nextProject.code);
      announce(`${GEMINI_MODEL_LABELS[responseModel]} generated the circuit and code`);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "The app could not reach the AI service. Try again.";
      setGenerationError(message);
      announce("AI generation failed — current circuit unchanged");
    } finally {
      setGenerating(false);
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
      commitProject(parsed.data);
      simulator.load(parsed.data.code);
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
          <span className="save-state"><i></i> Saved locally</span>
        </div>

        <div className="top-actions">
          <button className="icon-button desktop-only" onClick={undo} disabled={historyIndex <= 0} title="Undo (Ctrl+Z)">↶</button>
          <button className="icon-button desktop-only" onClick={redo} disabled={historyIndex >= historyLength - 1} title="Redo (Ctrl+Shift+Z)">↷</button>
          <button className="text-button" onClick={() => fileInputRef.current?.click()}>Import</button>
          <button className="text-button" onClick={exportProject}>Export</button>
          <button className={`build-button ${buildState}`} onClick={() => build(false)} disabled={buildState === "building"}>
            <span>{buildState === "building" ? "Building…" : buildState === "ready" ? "Build ready" : "Build sketch"}</span>
            <small>{buildState === "ready" ? "✓" : "⌘B"}</small>
          </button>
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
          <div className="category-list" aria-label="Component categories">
            {PALETTE_CATEGORIES.map((category) => (
              <button key={category} className={paletteCategory === category ? "active" : ""} onClick={() => setPaletteCategory(category)}>{CATEGORY_LABELS[category]}</button>
            ))}
          </div>
          <div className="parts-list">
            {parts.map((part) => (
              <button className="part-card" key={part.id} onClick={() => { addPart(part.id); setMobilePanel(null); }} title={`Add ${part.displayName}`}>
                <span className="part-glyph" style={{ "--part-accent": part.accent } as React.CSSProperties}>{PART_GLYPHS[part.id] ?? "IC"}</span>
                <span><strong>{part.displayName}</strong><small>{part.category}</small></span>
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
              <button className={`tool ${canvasTool === "select" && !spaceHeld ? "active" : ""}`} onClick={() => setCanvasTool("select")} title="Select, move, or drag a box around parts">↖ <span>Select</span></button>
              <button className={`tool ${canvasTool === "pan" || spaceHeld || panDrag ? "active" : ""}`} onClick={() => setCanvasTool("pan")} title="Drag empty canvas to pan, or drag a component to move it. Middle-drag or hold Space to pan anywhere.">✋ <span>Pan</span></button>
              <button className={`tool ${pendingPin ? "active amber" : ""}`} onClick={() => setPendingPin(null)} title="Wire">⌁ <span>{pendingPin ? "Cancel wire" : "Wire"}</span></button>
            </div>
            <div className="mobile-panel-buttons" aria-label="Workspace panels">
              <button onClick={() => setMobilePanel("library")} aria-controls="components-panel" aria-expanded={mobilePanel === "library"}>Components</button>
              <button onClick={() => { setSideTab("assistant"); setMobilePanel("assistant"); }} aria-controls="ai-panel" aria-expanded={mobilePanel === "assistant"}>AI assistant</button>
            </div>
            <div className="canvas-title">
              <strong>Schematic</strong><span>{project.components.length} parts · {project.connections.length} wires</span>
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
            <div className="schematic-grid" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {project.connections.map((connection) => {
                const fromComponent = project.components.find((component) => component.id === connection.from.componentId);
                const toComponent = project.components.find((component) => component.id === connection.to.componentId);
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
                const wireTitle = `${fromComponent.label}: ${fromPin.label} → ${toComponent.label}: ${toPin.label}. Click to remove.`;
                const removeWire = (event: React.MouseEvent) => {
                  event.stopPropagation();
                  commitProject({ ...project, connections: project.connections.filter((item) => item.id !== connection.id) });
                  announce("Wire removed");
                };
                return (
                  <div className={`wire-route ${highlightedWireId === connection.id ? "highlighted" : ""}`} key={connection.id} style={{ "--wire-color": connection.color ?? "#47b86b" } as React.CSSProperties}>
                    {segments.map((segment, index) => {
                      const horizontal = segment.from.y === segment.to.y;
                      return (
                        <button
                          key={index}
                          className={`wire-segment ${horizontal ? "horizontal" : "vertical"}`}
                          title={wireTitle}
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
                          onClick={removeWire}
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
                const isBuzzerOn = component.type === "buzzer" && isBuzzerCircuitPowered(
                  buzzerCircuitBindings.get(component.id),
                  snapshot,
                );
                const componentPins = component.type === "buzzer"
                  ? resolveComponentBoardPins(project, component.id, "+").map(parseUnoPinLabel).filter((pin): pin is number => pin !== undefined)
                  : [];
                const toneOn = component.type === "buzzer" && snapshot.tones.some((tone) => tone.active && componentPins.includes(tone.pin));
                const servoState = component.type === "servo"
                  ? snapshot.servos.find((servo) => resolveComponentBoardPins(project, component.id, "SIG").some((pin) => parseUnoPinLabel(pin) === servo.pin))
                  : undefined;
                const lcdState = component.type === "lcd-16x2" ? snapshot.lcds[0] : undefined;
                const electricalState = snapshot.componentStates[component.id];
                const symbolProperties = component.type === "servo" && servoState
                  ? { ...component.properties, angle: servoState.angle }
                  : component.type === "lcd-16x2" && lcdState
                    ? { ...component.properties, text: lcdState.lines.join("\n") }
                    : { ...component.properties, __electricalState: JSON.stringify(electricalState ?? null) };
                const isPowered = isLedOn || isBuzzerOn || toneOn || Boolean(servoState?.attached) || Boolean(lcdState) || Boolean(electricalState?.powered);
                
                // Apply CSS transform during drag - GPU accelerated, no wire recalc!
                const isDragging = dragState?.id === component.id;
                const dragTransform = isDragging 
                  ? `translate(${(dragState.currentX - dragState.startX) / zoom}px, ${(dragState.currentY - dragState.startY) / zoom}px)`
                  : undefined;
                
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
                      ...(dragTransform ? { transform: dragTransform, transition: 'none' } : {})
                    } as React.CSSProperties}
                    onPointerDown={(event) => beginDrag(event, component)}
                    onDoubleClick={() => { setSelectedIds([component.id]); setSideTab("inspector"); }}
                  >
                    <div className="symbol-caption"><strong>{component.label}</strong><small>{component.type === "arduino-uno" ? "ARDUINO UNO R3" : definition?.displayName}</small></div>
                    <SchematicSymbol type={component.type} properties={symbolProperties} powered={isPowered || component.type === "arduino-uno"} />
                    {definition?.pins.map((pin) => {
                        const localPoint = pinPosition({ ...component, x: 0, y: 0, rotation: 0 }, pin.id, definition);
                        if (!localPoint) return null;
                        const active = pendingPin?.componentId === component.id && pendingPin.pin === pin.id;
                        const connectedWires = project.connections.filter((connection) =>
                          (connection.from.componentId === component.id && connection.from.pin === pin.id) ||
                          (connection.to.componentId === component.id && connection.to.pin === pin.id),
                        );
                        const highlightedWire = connectedWires.find((connection) => connection.id === highlightedWireId);
                        const displayWire = highlightedWire ?? connectedWires[0];
                        return <button key={pin.id} className={`schematic-pin side-${pin.side} ${active ? "active" : ""} ${displayWire ? "connected" : ""} ${highlightedWire ? "wire-highlighted" : ""}`} style={{ left: localPoint.x, top: localPoint.y, "--pin-wire-color": displayWire?.color ?? "#47b86b" } as React.CSSProperties} title={`${pin.label}${displayWire ? " · connected" : ""} · click to wire`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connectPin({ componentId: component.id, pin: pin.id }); }}><i /><span>{pin.label}</span></button>;
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

            <div className="canvas-help">
              <span className={pendingPin ? "active" : ""}>{pendingPin ? `Wiring from ${pendingPin.pin} — choose a destination pin` : "Click any pin to start a wire"}</span>
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
                <div className="ai-model-line"><span></span> AI CIRCUIT PLANNER <i>SUPPORTED PARTS ONLY</i></div>
                {!chat.length && !generating && (
                  <div className="ai-empty-state">
                    <p>Your prompt is sent to AI to generate the schematic, wiring, and Arduino code together.</p>
                  </div>
                )}
                {chat.map((message) => (
                  <div className={`chat-message ${message.role}`} key={message.id}>
                    {message.role === "assistant" && <div className="avatar">✦</div>}
                    <div><p>{message.text}</p>{message.meta && <small>{message.meta}</small>}</div>
                  </div>
                ))}
                {generating && <div className="chat-message assistant"><div className="avatar">✦</div><div className="thinking"><i></i><i></i><i></i><span>Thinking…</span></div></div>}
              </div>
              <div className="prompt-zone">
                {generationError && (
                  <div className="generation-error" role="alert">
                    <strong>AI generation failed</strong>
                    <span>{generationError}</span>
                    <small>Your current circuit was not changed.</small>
                  </div>
                )}
                <label className="model-selector">
                  <span>AI model</span>
                  <select
                    aria-label="Circuit generation model"
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
                <div className="suggestion-row">
                  {["Traffic light with 3 LEDs", "Buzzer alert every second", "Blink LED fast"].map((item) => <button key={item} onClick={() => submitPrompt(item)}>{item}</button>)}
                </div>
                <label className="prompt-box">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitPrompt(); } }} placeholder="Describe a circuit…" rows={3} />
                  <div><span>Enter to generate · Shift+Enter for line</span><button onClick={() => submitPrompt()} disabled={!prompt.trim() || generating} aria-label="Generate circuit">↑</button></div>
                </label>
                <p className="ai-disclaimer"><i></i> AI output is schema-checked before it reaches your canvas.</p>
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
                    <label className="field-label" key={key}>{property.label}
                      {property.kind === "boolean" ? <input type="checkbox" checked={Boolean(selected.properties?.[key] ?? property.defaultValue)} onChange={(event) => updateSelected({ properties: { ...selected.properties, [key]: event.target.checked } })} /> : <input type={property.kind === "number" ? "number" : property.kind === "color" ? "color" : "text"} value={String(selected.properties?.[key] ?? property.defaultValue)} onChange={(event) => updateSelected({ properties: { ...selected.properties, [key]: property.kind === "number" ? Number(event.target.value) : event.target.value } })} />}
                    </label>
                  ))}
                  <div className="pin-table"><header><span>Pin</span><span>Signals</span></header>{selectedDefinition.pins.slice(0, 14).map((pin) => <button key={pin.id} onClick={() => connectPin({ componentId: selected.id, pin: pin.id })}><strong>{pin.id}</strong><span>{pin.signals.join(" · ")}</span></button>)}</div>
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
            {bottomTab === "code" && <div className="code-editor"><pre aria-hidden="true">{project.code.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</pre><textarea spellCheck={false} aria-label="Arduino code" value={project.code} onChange={(event) => { setProject((current) => ({ ...current, code: event.target.value })); setBuildState("idle"); }} onBlur={() => commitProject(projectRef.current)} /></div>}
            {bottomTab === "serial" && <div className="serial-console"><header><span>9600 baud</span><button onClick={() => simulator.clearSerial()}>Clear output</button></header><div>{snapshot.serial.length ? snapshot.serial.map((entry) => <p key={entry.id}><time>{(entry.timestampMs / 1000).toFixed(2)}s</time><span>{entry.text}{entry.newline ? "" : "_"}</span></p>) : <div className="console-empty">Run the simulation to see Serial output here.<small>Serial.begin(9600) detected automatically</small></div>}</div></div>}
            {bottomTab === "problems" && <div className="problems-list">{problemMessages.length ? problemMessages.map((message, index) => <button key={index} onClick={() => setBottomTab("code")}><span className={message.severity}>{message.severity === "error" ? "×" : "!"}</span><strong>{message.message}</strong><small>{message.line ? `Sketch.ino:${message.line}` : "Circuit"}</small></button>) : <div className="console-empty"><span className="success-check">✓</span>No build problems detected.<small>The supported simulation subset is ready.</small></div>}</div>}
          </div>
        )}
      </section>

      <footer className="statusbar">
        <span><i className={arduinoCount === 1 ? "status-ok" : "status-warning"}></i>{arduinoCount === 0 ? "No Arduino board" : arduinoCount === 1 ? "Arduino Uno" : `${arduinoCount} Arduino Uno boards`}</span><span>Digital simulator</span><span>{project.components.length} components</span><span>{project.connections.length} nets</span><span className="status-spacer"></span><span>Schema v{project.schemaVersion}</span><span>Local project</span>
      </footer>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
