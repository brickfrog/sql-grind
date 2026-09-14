import { validateKata, type KataPattern } from "./challenges";

/**
 * Authored katas ship inside the application bundle, not the verified content
 * bundle: they hold no published expectation to hash, and adding a drill must
 * not change bundleVersion and invalidate a learner's completions.
 *
 * Kept apart from ./katas so the scheduler stays importable outside a bundler.
 *
 * A malformed drill asset is reported, never thrown: this module is evaluated
 * when the application loads, and a broken practice drill must not cost the
 * learner the workbench. The Katas surface shows what was rejected.
 */
const modules = import.meta.glob<{ default: unknown }>("../katas/*.json", {
  eager: true,
});
const patterns: KataPattern[] = [];
const errors: string[] = [];
const seen = new Set<string>();
for (const path of Object.keys(modules).sort()) {
  const name = path.split("/").at(-1) ?? path;
  try {
    const pattern = validateKata(modules[path].default);
    if (seen.has(pattern.patternId)) {
      errors.push(`${name}: duplicate kata pattern id ${pattern.patternId}.`);
      continue;
    }
    seen.add(pattern.patternId);
    patterns.push(pattern);
  } catch (error) {
    errors.push(`${name}: ${(error as Error).message}`);
  }
}
export const kataPatterns: readonly KataPattern[] = patterns;
export const kataContentErrors: readonly string[] = errors;
