/** Give a useful next action for a failed generation without implying that
 * the rejected candidate changed the current circuit. */
export function generationFailureNextStep(code: string | undefined, details: readonly string[]): string {
  const diagnostic = `${code ?? ""} ${details.join(" ")}`.toLowerCase();
  if (/ai_unavailable|ai_timeout|provider|network|rate.?limit|\b429\b|\b503\b|deadline/.test(diagnostic)) {
    return "Next: wait briefly, then retry. Your current circuit was left unchanged.";
  }
  if (/pin|wire|connection|net|ground|short|supply|voltage|electrical|componentid/.test(diagnostic)) {
    return "Next: use the diagnostics to check exact component IDs, pin names, and power/ground connections, then refine the prompt and try again.";
  }
  if (/project\.code|sketch|simulator|unsupported|behavior|threshold/.test(diagnostic)) {
    return "Next: simplify the sketch to one behavior and state which wired input should control which output.";
  }
  if (/component|coverage|requested|requires|unsupported_type/.test(diagnostic)) {
    return "Next: name the missing supported component explicitly and reduce the number of requested parts.";
  }
  return "Next: open the diagnostics, then revise the prompt to use exact supported parts and one clear behavior.";
}
