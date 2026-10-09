"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createDefaultBlinkProject, safeParseCircuitProject, type CircuitProject } from "../../lib/circuit";
import { LEGACY_LOCAL_PROJECT_KEY, legacyMigrationIdKey } from "../../lib/circuit/account-storage";
import { signOutFromCirkitra } from "../../lib/firebase/session-client";
import { createClient } from "../../lib/supabase/client";
import { serializeJson } from "../../lib/supabase/database.types";

type ProjectRow = { id: string; name: string; project: unknown; updated_at: string };

function newProject(): CircuitProject {
  const project = createDefaultBlinkProject();
  return {
    ...project,
    id: crypto.randomUUID(),
    name: "New circuit",
    description: "",
    components: [],
    connections: [],
    code: "",
  };
}

function formatDate(timestamp: string) {
  const value = new Date(timestamp);
  return Number.isNaN(value.getTime()) ? "Recently" : value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ProjectsDashboard({ userId, email, displayName }: { userId: string; email: string; displayName: string }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const initialized = useRef(false);

  const loadProjects = useCallback(async () => {
    const supabase = createClient();
    const { data, error: listError } = await supabase
      .from("projects")
      .select("id,name,project,updated_at")
      .order("updated_at", { ascending: false });
    if (listError) throw listError;
    const rows = (data ?? []) as ProjectRow[];
    const legacyIndoorStarter = rows.find((row) => row.name === "Indoor Plant Shelf Monitor");
    if (legacyIndoorStarter) {
      const parsed = safeParseCircuitProject(legacyIndoorStarter.project);
      if (parsed.success && parsed.data.name === "Indoor Plant Shelf Monitor") {
        const replacement = { ...createDefaultBlinkProject(), id: legacyIndoorStarter.id };
        const updatedAt = new Date().toISOString();
        const { error: updateError } = await supabase.from("projects").update({
          name: replacement.name,
          project: serializeJson(replacement),
          updated_at: updatedAt,
        }).eq("id", legacyIndoorStarter.id);
        if (updateError) throw updateError;
        rows[rows.indexOf(legacyIndoorStarter)] = {
          ...legacyIndoorStarter,
          name: replacement.name,
          project: replacement,
          updated_at: updatedAt,
        };
      }
    }
    setProjects(rows);
  }, []);

  const initializeAccount = useCallback(async () => {
    if (initialized.current) return;
    initialized.current = true;
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: settingsError } = await supabase.from("account_settings").upsert(
        { user_id: userId },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
      if (settingsError) throw settingsError;

      const { data: settings, error: readSettingsError } = await supabase
        .from("account_settings")
        .select("legacy_project_migrated_at")
        .eq("user_id", userId)
        .single();
      if (readSettingsError) throw readSettingsError;

      if (!settings.legacy_project_migrated_at) {
        let legacyProject: CircuitProject | null = null;
        try {
          const saved = window.localStorage.getItem(LEGACY_LOCAL_PROJECT_KEY);
          if (saved) {
            const parsed = safeParseCircuitProject(JSON.parse(saved));
            if (parsed.success) legacyProject = parsed.data;
          }
        } catch {
          // An invalid or unavailable local draft should not prevent account access.
        }

        if (legacyProject) {
          const migrationKey = legacyMigrationIdKey(userId);
          let migratedId = window.localStorage.getItem(migrationKey);
          if (!migratedId) {
            migratedId = crypto.randomUUID();
            try { window.localStorage.setItem(migrationKey, migratedId); } catch { /* best effort */ }
          }

          const { data: existing, error: lookupError } = await supabase
            .from("projects")
            .select("id")
            .eq("id", migratedId)
            .maybeSingle();
          if (lookupError) throw lookupError;
          if (!existing) {
            const project = { ...legacyProject, id: migratedId };
            const { error: insertError } = await supabase.from("projects").insert({
              id: migratedId,
              owner_id: userId,
              name: project.name,
              project: serializeJson(project),
            });
            if (insertError) throw insertError;
          }
        }

        const { error: markError } = await supabase.from("account_settings")
          .update({ legacy_project_migrated_at: new Date().toISOString() })
          .eq("user_id", userId);
        if (markError) throw markError;
      }

      await loadProjects();
      setLoading(false);
    } catch (loadError) {
      initialized.current = false;
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "Could not load your account. Check the Supabase migration and try again.");
    }
  }, [loadProjects, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void initializeAccount(); }, 0);
    return () => window.clearTimeout(timer);
  }, [initializeAccount]);

  async function createProject() {
    setBusy(true);
    setError("");
    const project = newProject();
    const supabase = createClient();
    const { error: insertError } = await supabase.from("projects").insert({
      id: project.id,
      owner_id: userId,
      name: project.name,
      project: serializeJson(project),
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    router.push(`/studio?project=${encodeURIComponent(project.id)}`);
  }

  async function renameProject(project: ProjectRow) {
    const name = renamingValue.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    const { error: updateError } = await createClient().from("projects")
      // Renaming is a project-metadata change; don't parse or rewrite its
      // circuit payload, which may be from an older schema or partially invalid.
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", project.id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setRenamingId(null);
    await loadProjects();
  }

  async function deleteProject(project: ProjectRow) {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    const { error: deleteError } = await createClient().from("projects").delete().eq("id", project.id);
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setProjects((current) => current.filter((item) => item.id !== project.id));
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await signOutFromCirkitra();
    } catch (signoutError) {
      setError(signoutError instanceof Error ? signoutError.message : "Could not sign out. Please try again.");
      setSigningOut(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="projects-shell">
      <header className="projects-header">
        <Link className="auth-brand" href="/"><Image className="brand-logo" src="/cirkitra-logo.png" alt="" width={34} height={34} /><span>Cirkitra<small>Your projects</small></span></Link>
        <div className="projects-account"><span title={displayName ? undefined : email}>{displayName || email}</span><button type="button" onClick={signOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div>
      </header>
      <section className="projects-content">
        <div className="projects-title-row"><div><span className="projects-eyebrow">WORKSPACE</span><h1>Your projects</h1><p>Your circuits are saved to your account.</p></div><button className="projects-create" type="button" onClick={createProject} disabled={busy || loading}>＋ New project</button></div>
        {error && <div className="projects-error" role="alert">{error}<button type="button" onClick={() => void initializeAccount()}>Retry</button></div>}
        {loading ? <div className="projects-loading" role="status">Loading your projects…</div> : projects.length ? (
          <div className="projects-grid">{projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-card-art" aria-hidden="true"><span>⊕</span><i /><i /><i /></div>
              <div className="project-card-body">
                {renamingId === project.id ? <form className="project-rename" onSubmit={(event) => { event.preventDefault(); void renameProject(project); }}><input aria-label="Project name" autoFocus value={renamingValue} maxLength={100} onChange={(event) => setRenamingValue(event.target.value)} /><button type="submit" disabled={busy}>Save</button><button type="button" onClick={() => setRenamingId(null)}>Cancel</button></form> : <><h2 title={project.name}>{project.name}</h2><p>Edited {formatDate(project.updated_at)}</p><div className="project-card-actions"><Link href={`/studio?project=${encodeURIComponent(project.id)}`}>Open project <span aria-hidden="true">→</span></Link><button type="button" onClick={() => { setRenamingId(project.id); setRenamingValue(project.name); }}>Rename</button><button type="button" className="project-delete" onClick={() => void deleteProject(project)} aria-label={`Delete ${project.name}`}>Delete</button></div></>}
              </div>
            </article>
          ))}</div>
        ) : <div className="projects-empty"><span>⌁</span><h2>No circuits yet</h2><p>Create a project to start designing, generating, and simulating a circuit.</p><button className="projects-create" type="button" onClick={createProject} disabled={busy}>＋ Create your first project</button></div>}
        <Link className="projects-back" href="/">← Cirkitra home</Link>
      </section>
    </main>
  );
}
