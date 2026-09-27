"use client";

import { useState } from "react";
import type { CircuitComponent } from "../lib/circuit/types.ts";
import type { SimulatedComponentState, SimulatorStatus } from "../lib/simulator/types.ts";

const units: Record<string, string> = { temperature: "°C", humidity: "%", pressure: "Pa", voltage: "V", batteryVoltage: "V", inputVoltage: "V", current: "A", chargeCurrent: "A", soc: "%", remainingMah: "mAh", capacityMah: "mAh", frequency: "Hz", bandwidth: "Hz", ax: "m/s²", ay: "m/s²", az: "m/s²", gx: "rad/s", gy: "rad/s", gz: "rad/s" };
export function formatReading(key: string, value: number) {
  return Number.isFinite(value) ? `${Number(value.toFixed(3)).toLocaleString("en-US")} ${units[key] ?? (key.startsWith("cell") ? "V" : "")}`.trim() : "Unavailable";
}

export function DeviceFeedback({ component, state, status, inject }: {
  component: CircuitComponent; state?: SimulatedComponentState; status: SimulatorStatus; inject: (id: string, payload: string) => boolean;
}) {
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState("");
  const wireless = component.type === "rfm95w" || component.type === "xbee-s2c-zigbee-th";
  if (!state?.readings && !state?.status && !wireless) return null;
  return <section className="device-feedback" aria-label="Live component state">
    <h4>Simulation state</h4>
    <p>{state?.status ?? "Not running"}{status === "paused" ? " · Paused" : ""}</p>
    {state?.fault && <p className="device-fault" role="alert">{state.fault}</p>}
    <dl>{Object.entries(state?.readings ?? {}).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{formatReading(key, value)}</dd></div>)}</dl>
    {wireless && <>
      <h4>{component.type === "rfm95w" ? "LoRa" : "Zigbee"} virtual peer</h4>
      <p>Peer settings above must match the module. Packet delivery follows its wiring and receive state.</p>
      <label className="field-label">Incoming packet<textarea value={payload} onChange={event => setPayload(event.target.value)} maxLength={255} rows={3} /></label>
      <button type="button" disabled={status !== "running" || !payload.length} onClick={() => setResult(inject(component.id, payload) ? "Packet received by the module." : "Packet was not delivered. Check the packet log and module state.")}>Send from virtual peer</button>
      {result && <p role="status">{result}</p>}
      <ol className="device-packets" aria-label="Packet log">{state?.packets?.slice(-20).map((packet, index) => <li key={`${packet.timeMs}-${index}`}><strong>{packet.direction === "tx" ? "Sent" : "Incoming"} · {(packet.timeMs / 1000).toFixed(3)} s</strong><code>{packet.payload}</code><small>{packet.status}</small></li>)}</ol>
      {!state?.packets?.length && <p>No packets yet.</p>}
    </>}
  </section>;
}
