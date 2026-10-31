/** Shape of public/registry-nav.json, written by scripts/scan-registry.mjs. */
export interface RegistryNav {
  generatedAt: string;
  source: { appPath: string; rootFile?: string; navSql?: string };
  warnings: string[];
  routes: RegistryRoute[];
  /** Keyed by `<file>#<ClassName>`, e.g. `src/app/.../tumor-tracking.component.ts#TumorTrackingComponent`. */
  components: Record<string, RegistryComponent>;
  menus: NavMenu[];
}

export interface RegistryComponent {
  name: string;
  file: string;
  selector?: string;
  /** Components used in the template. */
  children: string[];
  /** Components opened with `.open(X)` (MatDialog, bottom sheet, …). */
  dialogs: string[];
}

export interface RegistryRoute {
  id: string;
  path: string;
  component?: string;
  componentFile?: string;
  parents: string[];
  redirectTo?: string;
  definedIn: { file: string; line: number };
}

export interface NavMenu {
  id: string;
  label: string;
  audience: string;
  /** True when the menu comes from the navigation seed SQL, false for route-only groups. */
  confirmed: boolean;
  tabs: NavTab[];
}

export interface NavTab {
  id: string;
  title: string;
  section?: string;
  link?: string;
  description?: string;
  /** Ids of the matching entries in RegistryNav.routes. */
  routes: string[];
  note: string;
  navLine?: number;
}

/** `null` means Auto: follow every child component. */
export type ChildDepth = number | null;

export interface TabSelection {
  menu: NavMenu;
  tab: NavTab;
  childDepth: ChildDepth;
}
