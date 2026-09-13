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

export const icons: Record<string, string> = {
  folder: "/icons/folder.png",
  document: "/icons/document.png",
  database: "/icons/database.png",
  table: "/icons/table.png",
  view: "/icons/view.png",
  macro: "/icons/macro.png",
  index: "/icons/index.png",
  play: "/icons/play.png",
  check: "/icons/check.png",
  stop: "/icons/stop.png",
  plan: "/icons/plan.png",
  lock: "/icons/lock.png",
  trophy: "/icons/trophy.png",
  globe: "/icons/globe.png",
  bin: "/icons/bin.png",
  map: "/icons/map.png",
  save: "/icons/save.png",
  refresh: "/icons/refresh.png",
  filter: "/icons/filter.png",
  tree: "/icons/tree.png",
  folderDesktop: "/icons/folderDesktop.png",
  documentDesktop: "/icons/documentDesktop.png",
  globeDesktop: "/icons/globeDesktop.png",
};
