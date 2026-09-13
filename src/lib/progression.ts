import {
  sameIdentity,
  type ContentIdentity,
  type Curriculum,
} from "./challenges";
import type { Attempt } from "./types";

export type ProgressState =
  | "locked"
  | "available"
  | "in-progress"
  | "completed"
  | "needs-review";
export interface ChallengeProgress {
  id: string;
  state: ProgressState;
  completed: boolean;
  historical: boolean;
}
export interface SkillProgress {
  id: string;
  state: ProgressState;
  completed: boolean;
  available: boolean;
  accessible: boolean;
  objectives: ChallengeProgress[];
  nextChallengeId: string | null;
}
export interface Progression {
  skills: Record<string, SkillProgress>;
  challenges: Record<string, ChallengeProgress>;
}

/** Completion is an accepted immutable outcome for the entire current content identity. */
export function challengeCompleted(
  identity: ContentIdentity,
  attempts: readonly Attempt[],
): boolean {
  return attempts.some(
    (attempt) =>
      !attempt.deletedAt &&
      attempt.outcome === "complete" &&
      attempt.correctness === "correct" &&
      sameIdentity(attempt.challenge, identity),
  );
}

/** Opened skills retain review access; they do not bypass completion prerequisites for later skills. */
export function deriveProgression(
  curriculum: Curriculum,
  identities: Readonly<Record<string, ContentIdentity>>,
  attempts: readonly Attempt[],
  openedSkillIds: readonly string[],
): Progression {
  const skills: Record<string, SkillProgress> = {};
  const challenges: Record<string, ChallengeProgress> = {};
  const live = attempts.filter((attempt) => !attempt.deletedAt);
  const byChallenge = new Map<string, Attempt[]>();
  for (const attempt of live) {
    const id = attempt.challenge.challengeId;
    const list = byChallenge.get(id);
    if (list) list.push(attempt);
    else byChallenge.set(id, [attempt]);
  }
  for (const skill of curriculum.skills) {
    for (const id of skill.requiredChallengeIds) {
      const identity = identities[id];
      if (!identity)
        throw new Error(`Content error: Missing current identity for ${id}.`);
      const history = byChallenge.get(id) ?? [];
      const completed = challengeCompleted(identity, history);
      const historical = history.some(
        (attempt) =>
          attempt.outcome === "complete" &&
          attempt.correctness === "correct" &&
          !sameIdentity(attempt.challenge, identity),
      );
      challenges[id] = {
        id,
        completed,
        historical,
        state: completed
          ? "completed"
          : historical
            ? "needs-review"
            : history.some((attempt) =>
                  sameIdentity(attempt.challenge, identity),
                )
              ? "in-progress"
              : "available",
      };
    }
  }
  const opened = new Set(openedSkillIds);
  for (const skill of curriculum.skills) {
    const objectives = skill.requiredChallengeIds.map((id) => challenges[id]);
    const completed = objectives.every((objective) => objective.completed);
    const available = skill.requires.every((id) => {
      const prerequisite = curriculum.skills.find((skill) => skill.id === id);
      return (
        !!prerequisite &&
        prerequisite.requiredChallengeIds.every(
          (id) => challenges[id].completed,
        )
      );
    });
    const accessible = available || opened.has(skill.id);
    const review =
      objectives.some(
        (objective) => objective.historical && !objective.completed,
      ) ||
      (!available && opened.has(skill.id));
    const state: ProgressState = completed
      ? "completed"
      : review
        ? "needs-review"
        : !accessible
          ? "locked"
          : opened.has(skill.id) ||
              objectives.some(
                (objective) =>
                  objective.state === "in-progress" || objective.completed,
              )
            ? "in-progress"
            : "available";
    if (!accessible)
      for (const objective of objectives)
        if (!objective.completed && !objective.historical)
          objective.state = "locked";
    skills[skill.id] = {
      id: skill.id,
      state,
      completed,
      available,
      accessible,
      objectives,
      nextChallengeId: accessible
        ? (objectives.find((objective) => !objective.completed)?.id ?? null)
        : null,
    };
  }
  return { skills, challenges };
}
