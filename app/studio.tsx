"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  COMPONENT_CATALOG,
  SUPPORTED_COMPONENT_TYPES,
  createDefaultBlinkProject,
  createDefaultProperties,
  getComponentDefinition,
  safeParseCircuitProject,
  type CircuitComponent,
  type CircuitProject,
  type ConnectionEndpoint,
} from "../lib/circuit";
import {
  ArduinoSimulator,
  type SimulatorSnapshot,
} from "../lib/simulator";

const STORAGE_KEY = "ai-circuit-studio.project.v1";
const WIRE_COLORS = ["#ffb547", "#ff6b6b", "#56d7c3", "#68a7ff", "#b38cff"];
const PALETTE_CATEGORIES = ["all", "inputs", "outputs", "displays", "sensors", "logic"] as const;

type SideTab = "assistant" | "inspector";
type BottomTab = "code" | "serial" | "problems";
type ChatMessage = { id: string; role: "assistant" | "user"; text: string; meta?: string };
type CompileMessage = { severity: "error" | "warning"; line?: number; message: string };

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
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
  "pir-sensor": "PIR",
  "arduino-uno": "UNO",
};

const initialChat: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    text: "Describe the circuit you want. I’ll create the schematic and Arduino sketch together, then check that every part can run in this simulator.",
    meta: "Arduino Uno · digital simulation",
  },
];

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function deepClone(project: CircuitProject): CircuitProject {
  return JSON.parse(JSON.stringify(project)) as CircuitProject;
}

function nodeSize(component: CircuitComponent) {
  if (component.type === "arduino-uno") return { width: 176, height: 190 };
  if (component.type === "lcd-16x2") return { width: 164, height: 92 };
  if (component.type === "l293d") return { width: 126, height: 132 };
  if (component.type.includes("logic")) return { width: 92, height: 64 };
  return { width: 104, height: 78 };
}

function componentCenter(component: CircuitComponent) {
  const size = nodeSize(component);
  return { x: component.x + size.width / 2, y: component.y + size.height / 2 };
}

function displayPins(component: CircuitComponent) {
  const definition = getComponentDefinition(component.type);
  if (!definition) return [];
  if (component.type === "arduino-uno") {
    const preferred = ["5V", "D2", "D3", "D9", "D10", "D11", "D12", "D13", "A0", "GND"];
    return preferred.map((id) => definition.pins.find((pin) => pin.id === id)).filter(Boolean) as typeof definition.pins[number][];
  }
  return definition.pins.slice(0, 8);
}

function createTrafficLightProject(): CircuitProject {
  const project = createDefaultBlinkProject();
  project.id = uid("traffic-light");
  project.name = "Three-light traffic signal";
  project.description = "A timed red, amber, and green traffic signal driven by Arduino Uno.";
  project.components = [
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 96, y: 114, properties: createDefaultProperties("arduino-uno") },
    { id: "red", type: "led", label: "RED", x: 548, y: 86, properties: { color: "#ff4e5c" } },
    { id: "amber", type: "led", label: "AMBER", x: 548, y: 210, properties: { color: "#ffb547" } },
    { id: "green", type: "led", label: "GREEN", x: 548, y: 334, properties: { color: "#43d9a3" } },
    { id: "r1", type: "resistor", label: "R1 · 220 ohm", x: 386, y: 92, properties: { resistance: 220 } },
    { id: "r2", type: "resistor", label: "R2 · 220 ohm", x: 386, y: 216, properties: { resistance: 220 } },
    { id: "r3", type: "resistor", label: "R3 · 220 ohm", x: 386, y: 340, properties: { resistance: 220 } },
  ];
  project.connections = [
    ["D10", "r1", "1", "red", "A", "#ff5b65"],
    ["D11", "r2", "1", "amber", "A", "#ffb547"],
    ["D12", "r3", "1", "green", "A", "#43d9a3"],
  ].flatMap((item, index) => {
    const [pin, resistor, resistorPin, led, ledPin, color] = item as string[];
    return [
      { id: `signal-${index}`, from: { componentId: "uno", pin }, to: { componentId: resistor, pin: resistorPin }, color },
      { id: `lamp-${index}`, from: { componentId: resistor, pin: "2" }, to: { componentId: led, pin: ledPin }, color },
      { id: `ground-${index}`, from: { componentId: led, pin: "K" }, to: { componentId: "uno", pin: "GND" }, color: "#526071" },
    ];
  });
  project.code = `// Three-light traffic signal\nconst int RED = 10;\nconst int AMBER = 11;\nconst int GREEN = 12;\n\nvoid setup() {\n  pinMode(RED, OUTPUT);\n  pinMode(AMBER, OUTPUT);\n  pinMode(GREEN, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  digitalWrite(RED, HIGH);\n  digitalWrite(AMBER, LOW);\n  digitalWrite(GREEN, LOW);\n  Serial.println("STOP");\n  delay(3000);\n  digitalWrite(RED, LOW);\n  digitalWrite(AMBER, HIGH);\n  delay(1000);\n  digitalWrite(AMBER, LOW);\n  digitalWrite(GREEN, HIGH);\n  Serial.println("GO");\n  delay(3000);\n  digitalWrite(GREEN, LOW);\n  digitalWrite(AMBER, HIGH);\n  delay(1000);\n}`;
  return project;
}

function createBuzzerProject(): CircuitProject {
  const project = createDefaultBlinkProject();
  project.id = uid("buzzer");
  project.name = "Interval alert buzzer";
  project.description = "A piezo buzzer pulses every second and reports its state over Serial.";
  project.components = [
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 120, y: 118, properties: createDefaultProperties("arduino-uno") },
    { id: "buzz", type: "buzzer", label: "BZ1 · Piezo", x: 524, y: 176 },
  ];
  project.connections = [
    { id: "buzz-signal", from: { componentId: "uno", pin: "D9" }, to: { componentId: "buzz", pin: "+" }, color: "#b38cff" },
    { id: "buzz-ground", from: { componentId: "buzz", pin: "-" }, to: { componentId: "uno", pin: "GND" }, color: "#526071" },
  ];
  project.code = `const int BUZZER = 9;\n\nvoid setup() {\n  pinMode(BUZZER, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  digitalWrite(BUZZER, HIGH);\n  Serial.println("Alert on");\n  delay(300);\n  digitalWrite(BUZZER, LOW);\n  Serial.println("Alert off");\n  delay(700);\n}`;
  return project;
}

function createDemoFromPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("traffic") || normalized.includes("three led") || normalized.includes("3 led")) return createTrafficLightProject();
  if (normalized.includes("buzzer") || normalized.includes("alarm") || normalized.includes("alert")) return createBuzzerProject();
  const project = createDefaultBlinkProject();
  project.id = uid("blink");
  const speed = normalized.includes("fast") || normalized.includes("500") ? 500 : 1000;
  project.name = speed === 500 ? "Fast LED blinker" : "Blink an LED";
  project.code = project.code.replaceAll("1000", String(speed));
  return project;
}

function statusLabel(snapshot: SimulatorSnapshot) {
  if (snapshot.status === "running") return "Simulation running";
  if (snapshot.status === "paused") return "Simulation paused";
  if (snapshot.status === "error") return "Code needs attention";
  if (snapshot.status === "completed") return "Simulation complete";
  return "Ready to simulate";
}

export function CircuitStudio() {
  const initialProject = useMemo(() => createDefaultBlinkProject(), []);
  const [project, setProject] = useState<CircuitProject>(initialProject);
  const projectRef = useRef(project);
  const historyRef = useRef<CircuitProject[]>([deepClone(initialProject)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyLength, setHistoryLength] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>("led1");
  const [pendingPin, setPendingPin] = useState<ConnectionEndpoint | null>(null);
  const [paletteCategory, setPaletteCategory] = useState<(typeof PALETTE_CATEGORIES)[number]>("all");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [sideTab, setSideTab] = useState<SideTab>("assistant");
  const [bottomTab, setBottomTab] = useState<BottomTab>("code");
  const [bottomOpen, setBottomOpen] = useState(true);
  const [zoom, setZoom] = useState(0.9);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>(initialChat);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [compileMessages, setCompileMessages] = useState<CompileMessage[]>([]);
  const [buildState, setBuildState] = useState<"idle" | "building" | "ready" | "error">("idle");
  const [dragState, setDragState] = useState<{ id: string; pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [simulator] = useState(() => new ArduinoSimulator(initialProject.code));
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot>(() => simulator.getSnapshot());

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const commitProject = useCallback((next: CircuitProject) => {
    const copy = deepClone(next);
    const nextHistory = historyRef.current.slice(0, historyIndex + 1);
    nextHistory.push(copy);
    if (nextHistory.length > 60) nextHistory.shift();
    historyRef.current = nextHistory;
    setHistoryIndex(nextHistory.length - 1);
    setHistoryLength(nextHistory.length);
    setProject(next);
    setBuildState("idle");
  }, [historyIndex]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = safeParseCircuitProject(JSON.parse(saved));
        if (parsed.success) {
          queueMicrotask(() => {
            setProject(parsed.data);
            historyRef.current = [deepClone(parsed.data)];
            setHistoryIndex(0);
            setHistoryLength(1);
          });
        }
      }
    } catch {
      // A broken local draft should never prevent the studio from opening.
    }
    queueMicrotask(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [hydrated, project]);

  useEffect(() => simulator.subscribe(setSnapshot), [simulator]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(100, now - last);
      last = now;
      simulator.advance(delta);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [simulator]);

  useEffect(() => {
    if (!dragState) return;
    const move = (event: PointerEvent) => {
      const dx = (event.clientX - dragState.pointerX) / zoom;
      const dy = (event.clientY - dragState.pointerY) / zoom;
      setProject((current) => ({
        ...current,
        components: current.components.map((component) =>
          component.id === dragState.id
            ? { ...component, x: Math.max(12, dragState.x + dx), y: Math.max(12, dragState.y + dy) }
            : component,
        ),
      }));
    };
    const up = () => {
      const current = projectRef.current;
      const nextHistory = historyRef.current.slice(0, historyIndex + 1);
      nextHistory.push(deepClone(current));
      historyRef.current = nextHistory;
      setHistoryIndex(nextHistory.length - 1);
      setHistoryLength(nextHistory.length);
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

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if (!typing && (event.key === "Delete" || event.key === "Backspace") && selectedId) {
        const next = {
          ...projectRef.current,
          components: projectRef.current.components.filter((component) => component.id !== selectedId || component.type === "arduino-uno"),
          connections: projectRef.current.connections.filter((connection) => connection.from.componentId !== selectedId && connection.to.componentId !== selectedId),
        };
        commitProject(next);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [commitProject, redo, selectedId, undo]);

  const selected = project.components.find((component) => component.id === selectedId) ?? null;
  const selectedDefinition = selected ? getComponentDefinition(selected.type) : undefined;
  const pin13 = snapshot.pins.find((pin) => pin.label === "D13");

  const parts = useMemo(() => {
    const search = paletteSearch.trim().toLowerCase();
    return SUPPORTED_COMPONENT_TYPES.filter((type) => type !== "arduino-uno")
      .map((type) => COMPONENT_CATALOG[type])
      .filter((definition) => paletteCategory === "all" || definition.category === paletteCategory)
      .filter((definition) => !search || `${definition.displayName} ${definition.description}`.toLowerCase().includes(search));
  }, [paletteCategory, paletteSearch]);

  const addPart = (type: string) => {
    const definition = getComponentDefinition(type);
    if (!definition) return;
    const count = project.components.filter((component) => component.type === type).length + 1;
    const component: CircuitComponent = {
      id: uid(type),
      type,
      label: `${definition.displayName} ${count}`,
      x: 430 + ((project.components.length * 37) % 280),
      y: 94 + ((project.components.length * 71) % 320),
      properties: createDefaultProperties(type),
    };
    commitProject({ ...project, components: [...project.components, component] });
    setSelectedId(component.id);
    setSideTab("inspector");
    announce(`${definition.displayName} added`);
  };

  const beginDrag = (event: ReactPointerEvent, component: CircuitComponent) => {
    if ((event.target as HTMLElement).closest(".pin-button")) return;
    event.preventDefault();
    setSelectedId(component.id);
    setDragState({ id: component.id, pointerX: event.clientX, pointerY: event.clientY, x: component.x, y: component.y });
  };

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
    setChat((items) => [...items, { id: uid("user"), role: "user", text: clean }]);
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: clean, currentProject: project }),
      });
      const result = await response.json() as {
        project?: unknown;
        explanation?: string;
        warnings?: string[];
        error?: { code?: string; message?: string };
      };
      let nextProject: CircuitProject;
      let explanation: string;
      let meta: string;
      const parsed = safeParseCircuitProject(result.project);
      if (response.ok && parsed.success) {
        nextProject = parsed.data;
        explanation = result.explanation || `Created ${nextProject.name} with ${nextProject.components.length} components.`;
        meta = result.warnings?.length ? result.warnings.join(" · ") : "Validated against the v1 parts catalog";
      } else {
        nextProject = createDemoFromPrompt(clean);
        explanation = result.error?.code === "AI_NOT_CONFIGURED"
          ? `I created a local simulation-ready draft for “${clean}”. Add a server-side Groq key to unlock open-ended generation.`
          : `I created a safe, simulation-ready draft for “${clean}” using the local circuit planner.`;
        meta = "Local planner · all parts validated";
      }
      commitProject(nextProject);
      setSelectedId(nextProject.components.find((component) => component.type !== "arduino-uno")?.id ?? null);
      setChat((items) => [...items, { id: uid("assistant"), role: "assistant", text: explanation, meta }]);
      simulator.load(nextProject.code);
      announce("Circuit and code generated");
    } catch {
      const nextProject = createDemoFromPrompt(clean);
      commitProject(nextProject);
      setChat((items) => [...items, {
        id: uid("assistant"),
        role: "assistant",
        text: `I created a simulation-ready ${nextProject.name.toLowerCase()} locally. The cloud model was unavailable, so I kept the design inside the supported parts catalog.`,
        meta: "Local planner · offline-safe",
      }]);
      announce("Local circuit generated");
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
      setSelectedId(null);
      announce("Project imported");
    } catch {
      announce("That file is not a valid AI Circuit Studio project");
    }
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <div>
            <div className="brand-name">AI Circuit Studio</div>
            <div className="brand-kicker">UNO WORKBENCH</div>
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
        <aside className="parts-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Library</span><h2>Components</h2></div>
            <span className="count-badge">{SUPPORTED_COMPONENT_TYPES.length - 1}</span>
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
              <button className="part-card" key={part.id} onClick={() => addPart(part.id)} title={`Add ${part.displayName}`}>
                <span className="part-glyph" style={{ "--part-accent": part.accent } as React.CSSProperties}>{PART_GLYPHS[part.id] ?? "IC"}</span>
                <span><strong>{part.displayName}</strong><small>{part.category}</small></span>
                <i>+</i>
              </button>
            ))}
            {!parts.length && <p className="empty-note">No supported parts match that search.</p>}
          </div>
          <div className="library-note"><span>19</span><p><strong>Simulation-ready parts</strong><br />Every listed part is understood by the AI circuit schema.</p></div>
        </aside>

        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div className="tool-group">
              <button className="tool active" title="Select">↖ <span>Select</span></button>
              <button className={`tool ${pendingPin ? "active amber" : ""}`} onClick={() => setPendingPin(null)} title="Wire">⌁ <span>{pendingPin ? "Cancel wire" : "Wire"}</span></button>
            </div>
            <div className="canvas-title">
              <strong>Schematic</strong><span>{project.components.length} parts · {project.connections.length} wires</span>
            </div>
            <div className="zoom-controls">
              <button onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((value) => Math.min(1.35, value + 0.1))}>+</button>
              <button onClick={() => setZoom(0.9)} title="Fit to screen">⊙</button>
            </div>
          </div>

          <div className="canvas-viewport" onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
            <div className="schematic-grid" style={{ transform: `scale(${zoom})` }}>
              {project.connections.map((connection) => {
                const fromComponent = project.components.find((component) => component.id === connection.from.componentId);
                const toComponent = project.components.find((component) => component.id === connection.to.componentId);
                if (!fromComponent || !toComponent) return null;
                const from = componentCenter(fromComponent);
                const to = componentCenter(toComponent);
                const length = Math.hypot(to.x - from.x, to.y - from.y);
                const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
                return (
                  <button
                    className="wire-line"
                    key={connection.id}
                    title={`${connection.from.pin} → ${connection.to.pin}. Click to remove.`}
                    style={{ left: from.x, top: from.y, width: length, transform: `rotate(${angle}deg)`, "--wire-color": connection.color ?? "#ffb547" } as React.CSSProperties}
                    onClick={(event) => {
                      event.stopPropagation();
                      commitProject({ ...project, connections: project.connections.filter((item) => item.id !== connection.id) });
                      announce("Wire removed");
                    }}
                  ><span>{connection.from.pin}</span><i></i><span>{connection.to.pin}</span></button>
                );
              })}

              {project.components.map((component) => {
                const definition = getComponentDefinition(component.type);
                const size = nodeSize(component);
                const isSelected = component.id === selectedId;
                const isLedOn = component.type === "led" && pin13?.digitalValue === 1 && snapshot.status === "running";
                return (
                  <article
                    key={component.id}
                    className={`circuit-node ${component.type === "arduino-uno" ? "board-node" : ""} ${isSelected ? "selected" : ""} ${isLedOn ? "powered" : ""}`}
                    style={{ left: component.x, top: component.y, width: size.width, minHeight: size.height, "--node-accent": definition?.accent ?? "#64748b" } as React.CSSProperties}
                    onPointerDown={(event) => beginDrag(event, component)}
                    onDoubleClick={() => { setSelectedId(component.id); setSideTab("inspector"); }}
                  >
                    <header>
                      <span className="node-glyph">{PART_GLYPHS[component.type] ?? "IC"}</span>
                      <div><strong>{component.label}</strong><small>{component.type === "arduino-uno" ? "ATmega328P · 16 MHz" : definition?.displayName}</small></div>
                      {isLedOn && <i className="live-dot" title="High output"></i>}
                    </header>
                    {component.type === "arduino-uno" && (
                      <div className="board-art" aria-hidden="true">
                        <span className="usb-port">USB</span><span className="chip">ATMEGA<br />328P</span><span className={`builtin-led ${pin13?.digitalValue ? "on" : ""}`}>L</span>
                      </div>
                    )}
                    {component.type === "led" && <div className={`led-art ${isLedOn ? "on" : ""}`} style={{ "--led-color": String(component.properties?.color ?? "#ff5b65") } as React.CSSProperties}><span></span></div>}
                    {component.type === "resistor" && <div className="resistor-art"><span></span><i></i><span></span></div>}
                    {component.type === "push-button" && <button className="push-art" title="Press simulated button"><span></span></button>}
                    {component.type === "buzzer" && <div className="buzzer-art">)))</div>}
                    {component.type === "lcd-16x2" && <div className="lcd-art"><span>AI CIRCUIT STUDIO</span><span>READY_</span></div>}
                    <div className="node-pins">
                      {displayPins(component).map((pin) => {
                        const active = pendingPin?.componentId === component.id && pendingPin.pin === pin.id;
                        return <button key={pin.id} className={`pin-button ${active ? "active" : ""}`} title={`${pin.label} · click to wire`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); connectPin({ componentId: component.id, pin: pin.id }); }}><i></i>{pin.id}</button>;
                      })}
                    </div>
                  </article>
                );
              })}
              <div className="canvas-origin">0,0</div>
            </div>

            <div className="canvas-help">
              <span className={pendingPin ? "active" : ""}>{pendingPin ? `Wiring from ${pendingPin.pin} — choose a destination pin` : "Click any pin to start a wire"}</span>
              <span>Drag parts to arrange · Double-click to inspect</span>
            </div>
            <div className="minimap" aria-hidden="true">
              <div className="mini-board"></div>
              {project.components.filter((component) => component.type !== "arduino-uno").slice(0, 8).map((component) => <i key={component.id} style={{ left: `${Math.min(88, component.x / 10)}%`, top: `${Math.min(80, component.y / 7)}%` }}></i>)}
              <span></span>
            </div>
          </div>
        </section>

        <aside className="ai-panel">
          <div className="side-tabs" role="tablist">
            <button className={sideTab === "assistant" ? "active" : ""} onClick={() => setSideTab("assistant")}>AI assistant <span className="spark">✦</span></button>
            <button className={sideTab === "inspector" ? "active" : ""} onClick={() => setSideTab("inspector")}>Inspector</button>
          </div>

          {sideTab === "assistant" ? (
            <>
              <div className="chat-scroll">
                <div className="ai-model-line"><span></span> GROQ CIRCUIT PLANNER <i>SUPPORTED PARTS ONLY</i></div>
                {chat.map((message) => (
                  <div className={`chat-message ${message.role}`} key={message.id}>
                    {message.role === "assistant" && <div className="avatar">✦</div>}
                    <div><p>{message.text}</p>{message.meta && <small>{message.meta}</small>}</div>
                  </div>
                ))}
                {generating && <div className="chat-message assistant"><div className="avatar">✦</div><div className="thinking"><i></i><i></i><i></i><span>Planning circuit and checking pins…</span></div></div>}
              </div>
              <div className="prompt-zone">
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
              {selected && selectedDefinition ? (
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
                  {selected.type !== "arduino-uno" && <button className="danger-button" onClick={() => { commitProject({ ...project, components: project.components.filter((component) => component.id !== selected.id), connections: project.connections.filter((connection) => connection.from.componentId !== selected.id && connection.to.componentId !== selected.id) }); setSelectedId(null); }}>Remove component</button>}
                </>
              ) : <div className="inspector-empty"><span>↖</span><h3>Select a component</h3><p>Click a part on the schematic to edit its label, values, pins, and placement.</p></div>}
            </div>
          )}
        </aside>
      </section>

      <section className={`bottom-drawer ${bottomOpen ? "open" : "closed"}`}>
        <div className="drawer-bar">
          <div className="bottom-tabs">
            <button className={bottomTab === "code" ? "active" : ""} onClick={() => { setBottomTab("code"); setBottomOpen(true); }}>Sketch.ino <span className="language-dot">C++</span></button>
            <button className={bottomTab === "serial" ? "active" : ""} onClick={() => { setBottomTab("serial"); setBottomOpen(true); }}>Serial monitor <i>{snapshot.serial.length}</i></button>
            <button className={bottomTab === "problems" ? "active" : ""} onClick={() => { setBottomTab("problems"); setBottomOpen(true); }}>Problems <i className={compileMessages.some((message) => message.severity === "error") ? "error" : ""}>{compileMessages.length}</i></button>
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
            {bottomTab === "problems" && <div className="problems-list">{compileMessages.length ? compileMessages.map((message, index) => <button key={index} onClick={() => setBottomTab("code")}><span className={message.severity}>{message.severity === "error" ? "×" : "!"}</span><strong>{message.message}</strong><small>{message.line ? `Sketch.ino:${message.line}` : "Sketch.ino"}</small></button>) : <div className="console-empty"><span className="success-check">✓</span>No build problems detected.<small>The supported simulation subset is ready.</small></div>}</div>}
          </div>
        )}
      </section>

      <footer className="statusbar">
        <span><i className="status-ok"></i> Arduino Uno</span><span>Digital simulator</span><span>{project.components.length} components</span><span>{project.connections.length} nets</span><span className="status-spacer"></span><span>Schema v{project.schemaVersion}</span><span>Local project</span>
      </footer>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
