import type { Metadata } from "next";
import { CircuitStudio } from "../studio";

export const metadata: Metadata = {
  title: "Circuit Workbench",
  description: "Build, edit, and simulate Arduino circuits with Cirkitra.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/studio" },
};

export default function StudioPage() {
  return <CircuitStudio />;
}
