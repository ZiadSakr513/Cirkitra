import { ImageResponse } from "next/og";

export const alt = "Cirkitra — AI Arduino circuit design and simulation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#070b10", color: "#eef4f8", fontFamily: "Arial, sans-serif", padding: "76px" }}>
      <div style={{ position: "absolute", inset: 0, opacity: .22, backgroundImage: "linear-gradient(#253140 1px,transparent 1px),linear-gradient(90deg,#253140 1px,transparent 1px)", backgroundSize: "36px 36px" }} />
      <div style={{ display: "flex", flexDirection: "column", width: "720px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "30px", fontWeight: 700 }}><span style={{ width: 48, height: 48, display: "flex", border: "2px solid #42d7bd", borderRadius: 13, background: "#12312e" }} />Cirkitra</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "76px", fontSize: "64px", fontWeight: 760, lineHeight: 1.05, letterSpacing: "-2px" }}><span>Describe the circuit.</span><span style={{ color: "#42d7bd" }}>Watch it come alive.</span></div>
        <div style={{ marginTop: "30px", color: "#9cabb8", fontSize: "25px", lineHeight: 1.4 }}>AI-generated Arduino schematics, wiring, code, and browser simulation in one workbench.</div>
      </div>
      <div style={{ position: "absolute", right: "72px", top: "88px", width: "320px", height: "450px", display: "flex", border: "2px solid #253140", borderRadius: "24px", background: "#0c1118", boxShadow: "0 24px 80px #000" }}>
        <span style={{ position: "absolute", left: "54px", top: "78px", width: "188px", height: "196px", display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #42d7bd", borderRadius: "20px", background: "#126e6d", fontSize: "52px", fontWeight: 800 }}>UNO</span>
        <span style={{ position: "absolute", left: "136px", top: "274px", width: "4px", height: "94px", display: "flex", background: "#f59e0b" }} />
        <span style={{ position: "absolute", left: "132px", top: "356px", width: "72px", height: "26px", display: "flex", borderRadius: "12px", background: "#c08457" }} />
        <span style={{ position: "absolute", left: "200px", top: "368px", width: "55px", height: "4px", display: "flex", background: "#ef4444" }} />
        <span style={{ position: "absolute", left: "246px", top: "342px", width: "28px", height: "50px", display: "flex", borderRadius: "50% 50% 10px 10px", background: "#ef4444", boxShadow: "0 0 24px #ef4444" }} />
      </div>
    </div>,
    size,
  );
}
