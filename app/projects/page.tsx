import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isAccountAccessConfigured } from "../../lib/auth/setup";
import { getFirebaseAdminAuth } from "../../lib/firebase/admin";
import { getFirebaseSession } from "../../lib/firebase/session";
import { ProjectsDashboard } from "./projects-dashboard";

export const metadata: Metadata = { title: "Your projects", robots: { index: false, follow: false } };

export default async function ProjectsPage() {
  if (!isAccountAccessConfigured()) redirect("/auth?setup=1");
  const user = await getFirebaseSession();
  if (!user) redirect("/auth?next=%2Fprojects");

  let displayName = typeof user.name === "string" ? user.name.trim() : "";
  if (!displayName) {
    try {
      displayName = (await getFirebaseAdminAuth().getUser(user.uid)).displayName?.trim() ?? "";
    } catch {
      // The verified session remains usable if the profile lookup is temporarily unavailable.
    }
  }
  return <ProjectsDashboard userId={user.uid} email={user.email ?? ""} displayName={displayName} />;
}
