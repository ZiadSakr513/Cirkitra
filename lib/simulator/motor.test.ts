import assert from "node:assert/strict";
import test from "node:test";
import { ArduinoSimulator, solveCircuit } from "./index.ts";
import { connectFloatingMotorDriverEnables, createDefaultBlinkProject, type CircuitProject } from "../circuit/index.ts";
import { motorDisplay } from "../schematic/motor-display.ts";

function fixture() {
  const project: CircuitProject = { ...createDefaultBlinkProject(), components: [
    { id: "uno", type: "arduino-uno", label: "Uno", x: 0, y: 0 },
    { id: "driver", type: "l293d", label: "Driver", x: 400, y: 0 },
    { id: "left", type: "dc-motor", label: "Left", x: 650, y: 0 },
    { id: "right", type: "dc-motor", label: "Right", x: 650, y: 200 },
  ], connections: [] };
  const wire = (a: string, pin: string, b: string, target: string) => project.connections.push({ id: `w${project.connections.length}`, from: { componentId:a, pin }, to: { componentId:b, pin:target } });
  for (const pin of ["VSS", "VS"]) wire("uno", "5V", "driver", pin);
  for (const pin of ["GND1", "GND2", "GND3", "GND4"]) wire("uno", "GND", "driver", pin);
  for (const [pin, target] of [["D5", "EN1"], ["D6", "EN2"], ["D2", "IN1"], ["D3", "IN2"], ["D4", "IN3"], ["D7", "IN4"]]) wire("uno", pin, "driver", target);
  wire("driver", "OUT1", "left", "+"); wire("driver", "OUT2", "left", "-");
  wire("driver", "OUT3", "right", "+"); wire("driver", "OUT4", "right", "-");
  const simulator = new ArduinoSimulator(`void setup(){
    pinMode(2,OUTPUT);pinMode(3,OUTPUT);pinMode(4,OUTPUT);pinMode(7,OUTPUT);pinMode(5,OUTPUT);pinMode(6,OUTPUT);
    digitalWrite(2,HIGH);digitalWrite(3,LOW);digitalWrite(4,LOW);digitalWrite(7,HIGH);analogWrite(5,191);analogWrite(6,128);
  } void loop(){delay(100);}`);
  simulator.run(); simulator.advance(0);
  return { project, simulator };
}

test("two motors independently report opposite direction and PWM drive", () => {
  const {project, simulator} = fixture();
  const states = solveCircuit(project,simulator.getSnapshot()).componentStates;
  assert.equal(states.left.direction,"forward"); assert.equal(states.right.direction,"reverse");
  assert.ok(Math.abs(states.left.speed! - 191/255) < 0.001);
  assert.ok(Math.abs(states.right.speed! - 128/255) < 0.001);
  assert.equal(motorDisplay({...states.left, powered:!!states.left.powered,status:"running",playbackSpeed:1}).label,"Forward · 75%");
  assert.equal(motorDisplay({...states.right, powered:!!states.right.powered,status:"running",playbackSpeed:1}).label,"Reverse · 50%");
});

test("disabled, unpowered and disconnected motors coast instead of falsely running", () => {
  for (const terminal of ["VS","VSS","all-grounds","EN1","motor-negative","motor-positive"]) {
    const {project,simulator}=fixture();
    project.connections=project.connections.filter(w=>terminal.startsWith("motor-")
      ? !(w.to.componentId==="left" && w.to.pin===(terminal==="motor-negative"?"-":"+"))
      : terminal === "all-grounds" ? !(w.to.componentId==="driver" && /^GND[1-4]$/.test(w.to.pin))
      : !(w.to.componentId==="driver" && w.to.pin===terminal));
    const state=solveCircuit(project,simulator.getSnapshot()).componentStates.left;
    assert.equal(state.powered,false,terminal); assert.equal(state.speed,0,terminal); assert.equal(state.direction,"coast",terminal);
  }
});

test("one grounded L293D leg powers both motor channels but warns about physical wiring", () => {
  const {project, simulator} = fixture();
  project.connections = project.connections.filter(w =>
    w.to.componentId !== "driver" || !["GND2", "GND3", "GND4"].includes(w.to.pin));
  const solution = solveCircuit(project, simulator.getSnapshot());
  assert.equal(solution.componentStates.left.direction, "forward");
  assert.equal(solution.componentStates.right.direction, "reverse");
  assert.ok(solution.diagnostics.some(item => item.code === "motor-driver-ground-wiring"));
  assert.ok(!solution.diagnostics.some(item => item.code === "component-unpowered"));
});

test("disconnected enable pins keep motors stopped until repaired", () => {
  const { project, simulator } = fixture();
  project.connections = project.connections.filter(w =>
    w.to.componentId !== "driver" || !["EN1", "EN2"].includes(w.to.pin));
  const stopped = solveCircuit(project, simulator.getSnapshot());
  assert.equal(stopped.componentStates.left.speed, 0);
  assert.equal(stopped.componentStates.right.speed, 0);
  assert.equal(stopped.diagnostics.filter(item => item.code === "motor-driver-enable-floating").length, 2);
  const repaired = connectFloatingMotorDriverEnables(project);
  assert.equal(repaired.connections.length, project.connections.length + 2);
  assert.equal(connectFloatingMotorDriverEnables(repaired), repaired, "repair should be idempotent");
  const running = solveCircuit(repaired, simulator.getSnapshot());
  assert.equal(running.componentStates.left.direction, "forward");
  assert.equal(running.componentStates.right.direction, "reverse");
});

test("equal driven terminals brake", () => {
  const {project,simulator}=fixture();
  simulator.setDigitalInput(3,1);
  const state=solveCircuit(project,simulator.getSnapshot()).componentStates.left;
  assert.equal(state.direction,"brake"); assert.equal(state.powered,false);
  assert.equal(motorDisplay({...state,powered:false,status:"running",playbackSpeed:1}).label,"Stopped · Brake");
});

test("pause, resume, step, reset and speed control motor presentation", () => {
  const {project,simulator}=fixture();
  const display=()=>{const snapshot=simulator.getSnapshot(); const state=solveCircuit(project,snapshot).componentStates.left;
    return motorDisplay({...state,powered:!!state.powered,status:snapshot.status,playbackSpeed:snapshot.speed});};
  const running=display(); assert.equal(running.moving,true);
  simulator.pause(); assert.equal(display().moving,false); assert.equal(display().label,running.label);
  simulator.step(); assert.equal(display().moving,false);
  simulator.run(); assert.equal(display().moving,true);
  simulator.setSpeed(2); assert.equal(display().duration,running.duration/2);
  simulator.reset(); assert.equal(display().active,false); assert.equal(display().moving,false); assert.equal(display().label,"Stopped · Coast");
});
