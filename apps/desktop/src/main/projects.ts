import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { RecentProject } from '../shared/types.js';

export type { RecentProject };

const MAX_RECENTS = 10;

function getProjectsFilePath(): string {
  return path.join(app.getPath('userData'), 'citadel-projects.json');
}

function readProjectsFile(): RecentProject[] {
  const filePath = getProjectsFilePath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentProject[];
  } catch {
    return [];
  }
}

function writeProjectsFile(projects: RecentProject[]): void {
  const filePath = getProjectsFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(projects, null, 2), 'utf-8');
  } catch {
    // Non-fatal — userData write failure should not crash the app
  }
}

export function getRecentProjects(): RecentProject[] {
  const projects = readProjectsFile();
  return projects.sort(
    (a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime()
  );
}

export function addRecentProject(projectPath: string): void {
  const projects = readProjectsFile();
  const existing = projects.findIndex((p) => p.path === projectPath);
  const entry: RecentProject = {
    path: projectPath,
    name: path.basename(projectPath),
    lastOpened: new Date().toISOString(),
  };

  if (existing !== -1) {
    projects[existing] = entry;
  } else {
    projects.push(entry);
  }

  const sorted = projects
    .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
    .slice(0, MAX_RECENTS);

  writeProjectsFile(sorted);
}

export function isCitadelProject(dirPath: string): boolean {
  const planningDir = path.join(dirPath, '.planning');
  const harnessConfig = path.join(dirPath, '.claude', 'harness.json');
  return fs.existsSync(planningDir) || fs.existsSync(harnessConfig);
}
