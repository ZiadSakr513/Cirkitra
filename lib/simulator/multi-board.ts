import { getActiveBoard, getBoardProgram } from "../circuit/board-programs.ts";
import { boardPinLabel, getBoardProfile, isBoardType, resolveBoardPin } from "../circuit/boards.ts";
import type { CircuitProject } from "../circuit/types.ts";
import { resolveComponentBoardPinEndpoints, solveCircuit } from "./circuit-state.ts";
import { DeviceWiring } from "./device-wiring.ts";
import { ArduinoSimulator } from "./engine.ts";
import type { ArduinoSimulatorOptions, SimulatorDiagnostic, SimulatorListener, SimulatorSnapshot } from "./types.ts";

/** Runs each placed controller on its own interpreter while sharing circuit wiring. */
export class MultiBoardSimulator {
  private project?: CircuitProject;
  private runtimes = new Map<string, ArduinoSimulator>();
  private unsubscribers = new Map<string, () => void>();
  private activeBoardId?: string;
  private fallback: ArduinoSimulator;
  private listeners = new Set<SimulatorListener>();
  private uartFaults = new Map<string, SimulatorDiagnostic>();
  private snapshot: SimulatorSnapshot;

  constructor(source = "", private readonly options: Omit<ArduinoSimulatorOptions, "boardId" | "boardComponentId"> = {}) {
    this.fallback = new ArduinoSimulator(source, options);
    this.snapshot = this.fallback.getSnapshot();
  }

  attachProject(project: CircuitProject) {
    this.uartFaults.clear();
    this.project = project;
    const boards = project.components.filter(component => isBoardType(component.type));
    const existing = new Set(boards.map(board => board.id));
    for (const id of this.runtimes.keys()) if (!existing.has(id)) {
      this.unsubscribers.get(id)?.();
      this.unsubscribers.delete(id);
      this.runtimes.delete(id);
    }
    for (const board of boards) {
      const source = getBoardProgram(project, board.id);
      let runtime = this.runtimes.get(board.id);
      if (!runtime) {
        runtime = new ArduinoSimulator(source, { ...this.options, boardId: board.type, boardComponentId: board.id });
        this.runtimes.set(board.id, runtime);
        this.unsubscribers.set(board.id, runtime.subscribe(() => this.publish()));
      }
      runtime.attachProject(project);
      if (runtime.getSource() !== source) runtime.load(source);
    }
    this.activeBoardId = project.activeBoardId && existing.has(project.activeBoardId)
      ? project.activeBoardId
      : getActiveBoard(project)?.id ?? boards[0]?.id;
    this.syncI2cPeers();
    this.reconcileNetwork();
    this.publish();
  }

  selectBoard(boardComponentId: string): SimulatorSnapshot {
    if (!this.runtimes.has(boardComponentId)) throw new Error(`Board ${boardComponentId} is not present in the attached project.`);
    this.activeBoardId = boardComponentId;
    this.publish();
    return this.snapshot;
  }

  getSnapshot = (): SimulatorSnapshot => this.snapshot;
  getSource(): string { return this.activeRuntime()?.getSource() ?? this.fallback.getSource(); }
  getCompiledSketch() { return this.activeRuntime()?.getCompiledSketch() ?? this.fallback.getCompiledSketch(); }

  subscribe(listener: SimulatorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(source: string): SimulatorSnapshot {
    const result = (this.activeRuntime() ?? this.fallback).load(source);
    this.publish();
    return result;
  }

  run(): SimulatorSnapshot {
    for (const [id, runtime] of this.runtimes) {
      if (getBoardProgram(this.project!, id).trim()) runtime.run();
    }
    this.reconcileNetwork();
    this.publish();
    return this.snapshot;
  }

  pause(): SimulatorSnapshot {
    this.runtimes.forEach(runtime => runtime.pause());
    this.publish();
    return this.snapshot;
  }

  reset(): SimulatorSnapshot {
    this.uartFaults.clear();
    this.runtimes.forEach(runtime => runtime.reset());
    this.reconcileNetwork();
    this.publish();
    return this.snapshot;
  }

  setSpeed(speed: number): SimulatorSnapshot {
    this.runtimes.forEach(runtime => runtime.setSpeed(speed));
    this.fallback.setSpeed(speed);
    this.publish();
    return this.snapshot;
  }

  step(): SimulatorSnapshot {
    for (const [id, runtime] of this.runtimes) {
      if (getBoardProgram(this.project!, id).trim()) runtime.step();
    }
    this.deliverUart();
    this.reconcileNetwork();
    this.publish();
    return this.snapshot;
  }

  applyCircuitState(_input: { digital?: Readonly<Record<number, 0 | 1>>; analog?: Readonly<Record<number, number>>; components?: Readonly<Record<string, import("./types.ts").SimulatedComponentState>> }): SimulatorSnapshot {
    void _input;
    this.reconcileNetwork();
    this.publish();
    return this.snapshot;
  }

  advance(realDeltaMs: number): SimulatorSnapshot {
    const boardPins = this.collectBoardPins();
    this.runtimes.forEach(runtime => runtime.setNetworkBoardPins(boardPins));
    for (const [id, runtime] of this.runtimes) {
      if (getBoardProgram(this.project!, id).trim()) runtime.advance(realDeltaMs);
    }
    this.deliverUart();
    this.reconcileNetwork();
    this.publish();
    return this.snapshot;
  }

  clearSerial(): SimulatorSnapshot {
    (this.activeRuntime() ?? this.fallback).clearSerial();
    this.publish();
    return this.snapshot;
  }

  setPulseInput(pin: number | string, durationMicroseconds: number): SimulatorSnapshot {
    this.runtimes.forEach(runtime => runtime.setPulseInput(pin, durationMicroseconds));
    this.publish();
    return this.snapshot;
  }

  injectPacket(componentId: string, payload: string): boolean {
    const delivered = [...this.runtimes.values()].some(runtime => runtime.injectPacket(componentId, payload));
    this.publish();
    return delivered;
  }

  private activeRuntime() { return this.activeBoardId ? this.runtimes.get(this.activeBoardId) : undefined; }

  private collectBoardPins(): NonNullable<SimulatorSnapshot["boardPins"]> {
    return Object.fromEntries([...this.runtimes].map(([id, runtime]) => [id, runtime.getSnapshot().pins]));
  }

  private deliverUart() {
    if (!this.project) return;
    const boards = this.project.components.filter(component => isBoardType(component.type));
    for (const [sourceId, sourceRuntime] of this.runtimes) {
      const sourceBoard = boards.find(board => board.id === sourceId);
      if (!sourceBoard) continue;
      for (const transmission of sourceRuntime.drainUartTransmissions()) {
        const key = `${sourceId}:${transmission.port}`;
        const sourcePort = getBoardProfile(sourceBoard.type)?.uart[transmission.port];
        if (!sourcePort) continue;
        const txPin = boardPinLabel(sourceBoard.type, sourcePort.tx);
        const endpoints = resolveComponentBoardPinEndpoints(this.project, sourceId, txPin);
        const recipients = endpoints.flatMap(endpoint => {
          const target = boards.find(board => board.id === endpoint.componentId && board.id !== sourceId);
          if (!target) return [];
          const pinNumber = resolveBoardPin(target.type, endpoint.pin);
          const ports = getBoardProfile(target.type)?.uart ?? [];
          return ports.flatMap((port, index) => index > 0 && port.rx === pinNumber ? [{ id: target.id, index }] : []);
        });
        if (recipients.length === 0) {
          this.uartFaults.set(key, {
            severity: "warning",
            code: "UART_RECEIVER_DISCONNECTED",
            message: `${sourceBoard.label} transmitted on UART${transmission.port} TX (${txPin}), but no wired compatible board RX pin received the data. Connect TX to the receiver's RX pin.`,
          });
          continue;
        }
        if (recipients.length !== 1) {
          this.uartFaults.set(key, {
            severity: "warning",
            code: "UART_RECEIVER_AMBIGUOUS",
            message: `${sourceBoard.label} transmitted on UART${transmission.port}, but the TX net reaches ${recipients.length} compatible board RX pins. Connect it to one receiver RX pin.`,
          });
          continue;
        }
        const target = this.runtimes.get(recipients[0].id);
        const delivered = target?.enqueueUart(recipients[0].index, transmission.baud, transmission.data) ?? false;
        if (delivered) {
          this.uartFaults.delete(key);
        } else {
          const receiverBoard = boards.find(board => board.id === recipients[0].id);
          const rxPort = getBoardProfile(receiverBoard?.type ?? "arduino-uno")?.uart[recipients[0].index];
          this.uartFaults.set(key, {
            severity: "warning",
            code: "UART_RECEIVER_NOT_READY",
            message: `${sourceBoard.label} transmitted on UART${transmission.port} at ${transmission.baud} baud, but ${receiverBoard?.label ?? "the receiver"} did not accept it on UART${recipients[0].index} RX (${rxPort ? boardPinLabel(receiverBoard!.type, rxPort.rx) : "RX"}). Begin that UART at the same baud on the receiving sketch.`,
          });
        }
      }
    }
  }

  private reconcileNetwork() {
    if (!this.project || !this.runtimes.size) return;
    this.syncI2cPeers();
    const boardPins = this.collectBoardPins();
    this.runtimes.forEach(runtime => runtime.setNetworkBoardPins(boardPins));
    const snapshot = this.composeSnapshot();
    const solution = solveCircuit(this.project, snapshot);
    for (const [id, runtime] of this.runtimes) runtime.applyCircuitState({
      digital: solution.boardDigitalInputs[id],
      analog: solution.boardAnalogInputs[id],
      components: solution.componentStates,
    });
  }

  private syncI2cPeers() {
    if (!this.project) return;
    const boards = this.project.components.filter(component => isBoardType(component.type));
    const wiring = new DeviceWiring(this.project, [], [], undefined, this.collectBoardPins());
    for (const [sourceId, sourceRuntime] of this.runtimes) {
      const sourceBoard = boards.find(board => board.id === sourceId);
      if (!sourceBoard) continue;
      const peers = boards.filter(board => board.id !== sourceId
        && wiring.connected(sourceBoard.id, "SDA", board.id, "SDA")
        && wiring.connected(sourceBoard.id, "SCL", board.id, "SCL"))
        .flatMap(board => {
          const target = this.runtimes.get(board.id);
          return target ? [{
            address: () => target.getI2cPeripheralAddress(),
            receive: (data: readonly number[]) => target.receiveI2cData(data),
            request: (length: number) => target.requestI2cData(length),
          }] : [];
        });
      sourceRuntime.setI2cPeers(peers);
    }
  }

  private composeSnapshot(): SimulatorSnapshot {
    const selected = this.activeRuntime() ?? this.fallback;
    const base = selected.getSnapshot();
    const runtimes = [...this.runtimes.entries()];
    const boardPins = this.collectBoardPins();
    const boardSerial = Object.fromEntries(runtimes.map(([id, runtime]) => [id, runtime.getSnapshot().serial]));
    const runtimeSnapshots = runtimes.map(([id, runtime]) => [id, runtime, runtime.getSnapshot()] as const);
    const componentStates = Object.assign({}, ...runtimeSnapshots.map(([, , snapshot]) => snapshot.componentStates));
    const deviceOwners = new Map<string, string>();
    for (const [id, runtime] of runtimeSnapshots) {
      for (const componentId of runtime.getBoundDeviceComponentIds()) {
        const currentOwner = deviceOwners.get(componentId);
        if (!currentOwner || id === this.activeBoardId) deviceOwners.set(componentId, id);
      }
    }
    for (const [componentId, ownerId] of deviceOwners) {
      const state = this.runtimes.get(ownerId)?.getSnapshot().componentStates[componentId];
      if (state) componentStates[componentId] = state;
    }
    const activeStates = this.activeRuntime()?.getSnapshot().componentStates ?? {};
    for (const [componentId, state] of Object.entries(activeStates)) {
      if (!deviceOwners.has(componentId)) componentStates[componentId] = state;
    }
    const diagnostics = runtimes.flatMap(([id, runtime]) => {
      const source = getBoardProgram(this.project!, id);
      if (!source.trim()) return [];
      const board = this.project?.components.find(item => item.id === id);
      return runtime.getSnapshot().diagnostics.map(item => ({ ...item, message: `${board?.label ?? id}: ${item.message}` }));
    });
    const status = runtimes.some(([, runtime]) => runtime.getSnapshot().status === "running")
      ? "running"
      : base.status;
    return Object.freeze({
      ...base,
      status,
      primaryBoardId: this.activeBoardId ?? base.primaryBoardId,
      primaryBoardType: this.project?.components.find(item => item.id === this.activeBoardId)?.type ?? base.primaryBoardType,
      boardPins: Object.freeze(boardPins),
      boardSnapshots: Object.freeze(Object.fromEntries(runtimes.map(([id, runtime]) => [id, runtime.getSnapshot()]))),
      boardSerial: Object.freeze(boardSerial),
      componentStates: Object.freeze(componentStates),
      servos: Object.freeze(runtimes.flatMap(([, runtime]) => runtime.getSnapshot().servos)),
      lcds: Object.freeze(runtimes.flatMap(([, runtime]) => runtime.getSnapshot().lcds)),
      tones: Object.freeze(runtimes.flatMap(([, runtime]) => runtime.getSnapshot().tones)),
      diagnostics: Object.freeze([...diagnostics, ...this.uartFaults.values()]),
      deviceDrives: Object.freeze([...new Map(runtimes.flatMap(([, runtime]) => runtime.getSnapshot().deviceDrives ?? []).map(item => [item.componentId + ":" + item.pin, item])).values()]),
      deviceBridges: Object.freeze([...new Map(runtimes.flatMap(([, runtime]) => runtime.getSnapshot().deviceBridges ?? []).map(item => [item.componentId + ":" + item.from + ":" + item.to, item])).values()]),
    });
  }

  private publish() {
    this.snapshot = this.composeSnapshot();
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
