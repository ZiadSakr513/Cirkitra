import Link from "next/link";
import Image from "next/image";

const features = [
  ["Prompt to schematic", "Describe a circuit and Cirkitra generates compatible components, wiring, and Arduino code together."],
  ["Interactive simulation", "Run Arduino logic in the browser and adjust buttons, sensors, potentiometers, motors, displays, and gates live."],
  ["A real workbench", "Move components, inspect pins, edit code, route wires, diagnose problems, and export the complete project."],
];

const steps = [
  ["01", "Describe", "Ask for the circuit you need in plain language."],
  ["02", "Inspect", "Review the schematic, wiring, properties, and generated sketch."],
  ["03", "Simulate", "Run it, change inputs, and watch the circuit respond."],
];

const faqs = [
  ["What is Cirkitra?", "Cirkitra is an AI-assisted Arduino circuit design and browser simulation workbench."],
  ["Do I need to install anything?", "No. Cirkitra runs in a modern web browser and stores project preferences on your device."],
  ["What can I simulate?", "Cirkitra supports Arduino Uno circuits with LEDs, sensors, displays, motors, switches, logic gates, buzzers, servos, and other catalog components."],
  ["Does Cirkitra generate Arduino code?", "Yes. Circuit generation includes an Arduino sketch with pin assignments matched to the schematic."],
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
      description: "AI-assisted Arduino circuit design, code generation, and browser simulation.",
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
        <p>Generate Arduino schematics, wiring, and code from a prompt. Then edit and simulate the complete design in one browser workbench.</p>
        <div className="landing-actions"><Link className="landing-button" href="/studio">Start building <span aria-hidden="true">→</span></Link><a className="landing-text-link" href="#how-it-works">See how it works</a></div>
        <div className="landing-preview" aria-label="Preview of the Cirkitra circuit workbench">
          <div className="preview-top"><span><i /> CIRKITRA WORKBENCH</span><b>Simulation ready</b></div>
          <div className="preview-grid">
            <aside><small>COMPONENTS</small>{["Arduino Uno", "LED", "Resistor", "Logic Gate"].map((item, index) => <span key={item}><i>{["UNO", "LED", "R", "&"][index]}</i>{item}</span>)}</aside>
            <div className="preview-canvas"><div className="preview-uno">UNO<small>ARDUINO</small></div><div className="preview-resistor" /><div className="preview-led" /><i className="preview-wire wire-one" /><i className="preview-wire wire-two" /><i className="preview-wire wire-three" /></div>
            <aside className="preview-ai"><small>AI ASSISTANT</small><p>Build a motion-activated warning light</p><span>Creating schematic, wiring, and Arduino code…</span></aside>
          </div>
        </div>
      </section>

      <section className="landing-section" id="features"><div className="section-heading"><small>BUILT FOR MAKING</small><h2>From idea to working circuit</h2><p>Everything stays connected: the design, the code, and the simulation.</p></div><div className="feature-grid">{features.map(([name, copy], index) => <article key={name}><span>0{index + 1}</span><h3>{name}</h3><p>{copy}</p></article>)}</div></section>
      <section className="landing-section landing-process" id="how-it-works"><div className="section-heading"><small>HOW IT WORKS</small><h2>One continuous workflow</h2></div><div className="process-grid">{steps.map(([number, name, copy]) => <article key={number}><b>{number}</b><div><h3>{name}</h3><p>{copy}</p></div></article>)}</div></section>
      <section className="landing-section landing-components"><div className="section-heading"><small>SIMULATION LIBRARY</small><h2>Components that actually respond</h2><p>Build with Arduino Uno, sensors, LEDs, LCDs, motors, switches, buzzers, servos, logic gates, and more.</p></div><div className="component-chips">{["Arduino Uno", "Sensors", "Displays", "Motors", "Logic gates", "Switches", "LEDs", "Buzzers", "Servos"].map((item) => <span key={item}>{item}</span>)}</div></section>
      <section className="landing-section landing-faq" id="faq"><div className="section-heading"><small>QUESTIONS</small><h2>Frequently asked</h2></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="landing-cta"><small>READY TO BUILD?</small><h2>Turn your next circuit idea into a simulation.</h2><Link className="landing-button" href="/studio">Open the workbench <span aria-hidden="true">→</span></Link></section>
      <footer><Link className="landing-brand" href="/"><Image className="cirkitra-logo" src="/cirkitra-logo.png" alt="" width={38} height={38} /><span>Cirkitra<small>Founded by Ziad Sakr</small></span></Link><p>AI-assisted Arduino circuit design and simulation in your browser.</p><Link href="/studio">Open Cirkitra →</Link></footer>
    </main>
  );
}
