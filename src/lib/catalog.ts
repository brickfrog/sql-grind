import { assetUrl } from "./challenges";

export interface Objective {
  id: string;
  title: string;
  description: string;
  challengeId?: string;
}
export interface Skill {
  id: string;
  label: string;
  description: string;
  requires: string[];
  x: number;
  y: number;
  objectives: Objective[];
}

// Icon URLs carry the deployment base so a subpath deployment resolves them.
const ICON_NAMES = [
  "folder",
  "document",
  "database",
  "table",
  "view",
  "macro",
  "index",
  "play",
  "check",
  "stop",
  "plan",
  "lock",
  "trophy",
  "globe",
  "bin",
  "map",
  "save",
  "refresh",
  "filter",
  "tree",
  "folderDesktop",
  "documentDesktop",
  "globeDesktop",
] as const;
export const icons: Record<string, string> = Object.fromEntries(
  ICON_NAMES.map((name) => [name, assetUrl(`/icons/${name}.png`)]),
);
