import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { safeParseCircuitProject } from "../../lib/circuit";
import { isAccountAccessConfigured } from "../../lib/auth/setup";
import { getFirebaseSession } from "../../lib/firebase/session";
import { createAdminClient } from "../../lib/supabase/admin";
import { CircuitStudio } from "../studio";

export const metadata: Metadata = {
  title: "Circuit Workbench",
  description: "Build, edit, and simulate circuits for supported microcontroller boards with Cirkitra.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/studio" },
};

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  if (!isAccountAccessConfigured()) redirect("/auth?setup=1");
  const params = await searchParams;
  if (!params.project) redirect("/projects");

  const user = await getFirebaseSession();
  if (!user) redirect(`/auth?next=${encodeURIComponent(`/studio?project=${params.project}`)}`);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id,project,updated_at")
    .eq("owner_id", user.uid)
    .eq("id", params.project)
    .maybeSingle();
  if (error || !data) redirect("/projects");

  const parsed = safeParseCircuitProject(data.project);
  if (!parsed.success) redirect("/projects");
  const project = { ...parsed.data, id: data.id };

  return <CircuitStudio key={project.id} initialProject={project} projectUpdatedAt={data.updated_at} userId={user.uid} />;
}
