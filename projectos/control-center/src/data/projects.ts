/**
 * Seed data: the projects ProjectOS governs. In the Tauri desktop build this is replaced
 * by live data read from each repo's `.projectops/project-config.json` via the CLI; in the
 * browser preview it is a static snapshot so the UI is fully renderable without a backend.
 */
import type { InstallStatus } from '@projectos/core';

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly installStatus: InstallStatus;
  readonly productionFreeze: boolean;
  readonly openPhases: number;
}

export const PROJECTS: readonly ProjectRow[] = [
  { id: 'brik', name: 'Brik', repo: 'universalbizcomply/brik', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'bizcomply-v2', name: 'BizComply V2', repo: 'universalbizcomply/opsoft-ios-lab', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'coverdrive', name: 'Coverdrive', repo: 'coverdrivemanchester-art/Coverdrive', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'criclocal', name: 'CricLocal', repo: 'muraddevbuild-maker/criclocal', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'jd-testing', name: 'JD Testing', repo: 'jdonlinetesting/JDtesting', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'polygo', name: 'PolyGo', repo: 'polygonia-apres/polygo', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'boithok-khana', name: 'Boithok Khana', repo: 'none', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'erp-system', name: 'ERP System', repo: 'none', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'firm-flow', name: 'Firm Flow', repo: 'none', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'tkn', name: 'TKN', repo: 'none', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'trading-bot', name: 'Trading Bot', repo: 'none', installStatus: 'installed', productionFreeze: true, openPhases: 0 },
  { id: 'projectos', name: 'ProjectOS (self)', repo: 'universalbizcomply/ProjectOS', installStatus: 'installed', productionFreeze: false, openPhases: 12 },
];
