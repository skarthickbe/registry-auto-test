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
  /** Template file (the component file itself for inline templates). */
  template?: string;
  details: ComponentDetails;
}

/** What a component's template and class contain, as read by the scanner. */
export interface ComponentDetails {
  fields: FormField[];
  buttons: UiButton[];
  /** Number of mat-table tables. */
  tables: number;
  /** Number of @for / *ngFor repeats. */
  repeats: number;
  paginator: boolean;
  sort: boolean;
}

export interface FormField {
  /** formControlName (or formControl / ngModel binding). */
  name: string;
  label: string;
  kind: 'text' | 'date' | 'select' | 'textarea' | 'checkbox' | 'toggle' | 'radio' | (string & {});
  maxLength?: string;
  required: boolean;
  /** The component condition under which setValidators() makes the field required. */
  requiredWhen?: string;
  /** e.g. ['required', 'maxLength(50)', 'pattern(...)']. */
  validators?: string[];
  conditionalValidators?: string[];
  /** <mat-error> texts, in English. */
  errors: string[];
  /** Radio button labels. */
  options?: string[];
  /** Line in the template file. */
  line: number;
}

export interface UiButton {
  /** Button text, or its tooltip / aria-label / icon when it has no text. */
  text: string;
  /** The (click) handler expression. */
  click?: string;
  /** The [disabled] condition. */
  disabledWhen?: string;
  submit: boolean;
  line: number;
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
  /** Show the Playwright browser while it runs (slowed down to follow). */
  showBrowser: boolean;
}

/** Results written by e2e/checklist-reporter.ts and served by scripts/e2e-runner.mjs at /e2e-api/results. */
export interface E2eResults {
  runAt: string;
  status: string;
  results: E2eResult[];
}

export interface E2eResult {
  /** Component class from the test's describe title. */
  component?: string;
  /** Matches the checklist case title. */
  title: string;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  /** Milliseconds. */
  duration: number;
  error?: string;
  /** Annotations such as "Error shown: Invalid email or password." */
  notes: string[];
  /** Screenshot URLs, e.g. e2e-api/shots/x.png. */
  screenshots: string[];
}

/** State of the local Playwright runner (scripts/e2e-runner.mjs). */
export interface E2eRunStatus {
  /** `unavailable`: the runner is not running (start the app with `npm start`). */
  state: 'idle' | 'running' | 'finished' | 'error' | 'unavailable';
  startedAt?: string;
  finishedAt?: string;
  headed?: boolean;
  exitCode?: number;
  error?: string;
  log?: string[];
}
