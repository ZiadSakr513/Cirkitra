import Link from "next/link";
import Image from "next/image";

const features = [
  ["Prompt to schematic", "Describe a circuit and Cirkitra generates compatible components, wiring, and board-ready code together."],
  ["Interactive simulation", "Run supported microcontroller sketches in the browser and adjust buttons, sensors, potentiometers, motors, displays, and gates live."],
  ["A real workbench", "Move components, inspect pins, edit code, route wires, diagnose problems, and export the complete project."],
];

const steps = [
  ["01", "Describe", "Ask for the circuit you need in plain language."],
  ["02", "Inspect", "Review the schematic, wiring, properties, and generated sketch."],
  ["03", "Simulate", "Run it, change inputs, and watch the circuit respond."],
];

const faqs = [
  ["What is Cirkitra?", "Cirkitra is an AI-assisted circuit design and browser simulation workbench for microcontroller projects."],
  ["Do I need to install anything?", "No. Cirkitra runs in a modern web browser and stores project preferences on your device."],
  ["What can I simulate?", "Cirkitra supports boards including Arduino Uno, Mega and Nano, ESP32, ESP8266, and Raspberry Pi Pico, along with a growing catalog of connected components."],
  ["Does Cirkitra generate code for different boards?", "Yes. Circuit generation creates a board-compatible sketch with pin assignments matched to the schematic for supported boards."],
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Cirkitra",
      url: "https://cirkitra-green.vercel.app",
      applicationCategory: "DesignApplication",
      operatingSystem: "Web browser",
      description: "AI-assisted circuit design, board-compatible code generation, and browser simulation.",
      creator: { "@type": "Person", name: "Ziad Sakr" },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

export default function Home() {
  return (
    <main className="landing-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="landing-brand" href="/" aria-label="Cirkitra home"><Image className="cirkitra-logo" src="/cirkitra-logo.png" alt="" width={38} height={38} priority /><span>Cirkitra<small>Founded by Ziad Sakr</small></span></Link>
        <div><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#faq">FAQ</a></div>
        <Link className="landing-button landing-button-small" href="/studio">Open Cirkitra <span aria-hidden="true">→</span></Link>
      </nav>

      <section className="landing-hero">
        <div className="landing-eyebrow"><i /> AI circuit design meets browser simulation</div>
        <h1>Describe the circuit.<br /><span>Watch it come alive.</span></h1>
        <p>Generate circuit schematics, wiring, and board-compatible code from a prompt. Then edit and simulate the complete design in one browser workbench.</p>
        <div className="landing-actions"><Link className="landing-button" href="/studio">Start building <span aria-hidden="true">→</span></Link><a className="landing-text-link" href="#how-it-works">See how it works</a></div>
        <div className="landing-preview" aria-label="Preview of the Cirkitra circuit workbench">
          <div className="preview-top"><span><i /> CIRKITRA WORKBENCH</span><b>Simulation ready</b></div>
          <div className="preview-grid">
            <aside><small>COMPONENTS</small>{["Arduino Uno", "LED", "Resistor", "Logic Gate"].map((item, index) => <span key={item}><i>{["UNO", "LED", "R", "&"][index]}</i>{item}</span>)}</aside>
            <div className="preview-canvas"><div className="preview-uno">UNO<small>ARDUINO</small></div><div className="preview-resistor" /><div className="preview-led" /><i className="preview-wire wire-one" /><i className="preview-wire wire-two" /><i className="preview-wire wire-three" /></div>
            <aside className="preview-ai"><small>AI ASSISTANT</small><p>Build a motion-activated warning light</p><span>Creating schematic, wiring, and board-ready code…</span></aside>
          </div>
        </div>
      </section>

      <section className="landing-section" id="features"><div className="section-heading"><small>BUILT FOR MAKING</small><h2>From idea to working circuit</h2><p>Everything stays connected: the design, the code, and the simulation.</p></div><div className="feature-grid">{features.map(([name, copy], index) => <article key={name}><span>0{index + 1}</span><h3>{name}</h3><p>{copy}</p></article>)}</div></section>
      <section className="landing-section landing-process" id="how-it-works"><div className="section-heading"><small>HOW IT WORKS</small><h2>One continuous workflow</h2></div><div className="process-grid">{steps.map(([number, name, copy]) => <article key={number}><b>{number}</b><div><h3>{name}</h3><p>{copy}</p></div></article>)}</div></section>
      <section className="landing-section landing-components"><div className="section-heading"><small>SIMULATION LIBRARY</small><h2>Components that actually respond</h2><p>Build with boards such as Arduino, ESP32, ESP8266, and Raspberry Pi Pico, plus sensors, displays, motors, wireless modules, power components, and more.</p></div><div className="component-chips">{["Arduino Uno", "ESP32", "Raspberry Pi Pico", "Sensors", "Displays", "Motors", "Wireless", "Power", "Logic"].map((item) => <span key={item}>{item}</span>)}</div></section>
      <section className="landing-section landing-faq" id="faq"><div className="section-heading"><small>QUESTIONS</small><h2>Frequently asked</h2></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="landing-cta"><small>READY TO BUILD?</small><h2>Turn your next circuit idea into a simulation.</h2><Link className="landing-button" href="/studio">Open the workbench <span aria-hidden="true">→</span></Link></section>
      <footer><Link className="landing-brand" href="/"><Image className="cirkitra-logo" src="/cirkitra-logo.png" alt="" width={38} height={38} /><span>Cirkitra<small>Founded by Ziad Sakr</small></span></Link><p>AI-assisted circuit design and simulation for supported boards and components.</p><a className="landing-social-link" href="https://www.linkedin.com/company/139013905/" aria-label="Cirkitra on LinkedIn" title="Cirkitra on LinkedIn" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.602 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.119 20.452H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z" /></svg></a><Link href="/studio">Open Cirkitra →</Link></footer>
    </main>
  );
}
