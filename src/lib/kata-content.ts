import { validateKata, type KataPattern } from "./challenges";

/**
 * Authored katas ship inside the application bundle, not the verified content
 * bundle: they hold no published expectation to hash, and adding a drill must
 * not change bundleVersion and invalidate a learner's completions.
 *
 * Kept apart from ./katas so the scheduler stays importable outside a bundler.
 */
const modules = import.meta.glob<{ default: unknown }>("../katas/*.json", {
  eager: true,
});
export const kataPatterns: KataPattern[] = Object.keys(modules)
  .sort()
  .map((path) => validateKata(modules[path].default));
const ids = kataPatterns.map((pattern) => pattern.patternId);
if (new Set(ids).size !== ids.length)
  throw new Error("Content error: Duplicate kata pattern id.");
