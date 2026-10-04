import { ImageResponse } from "next/og";

export const alt = "Cirkitra — AI circuit design and simulation for microcontroller boards";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#070b10",
        color: "#eef4f8",
        padding: "76px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: "36px", fontWeight: 700 }}>
        <span style={{ width: "48px", height: "48px", display: "flex", marginRight: "18px", border: "2px solid #42d7bd", borderRadius: "13px", backgroundColor: "#12312e" }} />
        Cirkitra
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "76px", fontSize: "64px", fontWeight: 700, lineHeight: 1.05 }}>
        <span>Describe the circuit.</span>
        <span style={{ color: "#42d7bd" }}>Watch it come alive.</span>
      </div>
      <div style={{ display: "flex", marginTop: "30px", color: "#9cabb8", fontSize: "25px", lineHeight: 1.4 }}>
        AI-generated schematics, wiring, board-compatible code, and browser simulation in one workbench.
      </div>
    </div>,
    size,
  );
}
