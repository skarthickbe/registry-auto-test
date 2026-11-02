import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';

import { TestCase, generateChecklist } from './registry/checklist-generator';
import { ChecklistView } from './registry/checklist-view/checklist-view';
import { NavPanel } from './registry/nav-panel/nav-panel';
import { NavMenu, TabSelection } from './registry/registry-nav.model';
import { RegistryNavService } from './registry/registry-nav.service';

type Theme = 'light' | 'dark';
type View = 'components' | 'checklist';

const THEME_KEY = 'registry-auto-test.theme';
const SIGN_IN_PATH = '/sign-in';

@Component({
  selector: 'app-root',
  imports: [NavPanel, ChecklistView],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly registry = inject(RegistryNavService);
  protected readonly selection = signal<TabSelection | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly theme = signal<Theme>(initialTheme());

  /** Identifies the selected tab; a new tab starts on the Components view with no checklist. */
  protected readonly selectionKey = computed(() => {
    const sel = this.selection();
    return sel ? `${sel.menu.id}|${sel.tab.id}` : '';
  });
  protected readonly view = linkedSignal<string, View>({
    source: this.selectionKey,
    computation: () => 'components',
  });
  protected readonly checklist = linkedSignal<string, TestCase[] | null>({
    source: this.selectionKey,
    computation: () => null,
  });

  protected readonly componentTree = computed(() => {
    const sel = this.selection();
    return sel ? this.registry.componentTree(sel.tab.routes) : null;
  });

  /** Tree rows down to the chosen Child depth (all rows for Auto). */
  protected readonly visibleComponents = computed(() => {
    const rows = this.componentTree()?.rows ?? [];
    const depth = this.selection()?.childDepth ?? null;
    return depth === null ? rows : rows.filter((r) => r.level <= depth);
  });

  /** Components ticked for the checklist; every component is ticked again when the tab changes. */
  protected readonly checkedKeys = linkedSignal(
    () => new Set(this.componentTree()?.rows.map((r) => r.key) ?? []),
  );

  /** The visible, ticked components: what Generate Checklist works on. */
  protected readonly checkedComponents = computed(() =>
    this.visibleComponents().filter((r) => this.checkedKeys().has(r.key)),
  );

  constructor() {
    const root = inject(DOCUMENT).documentElement;
    effect(() => {
      root.dataset['theme'] = this.theme();
      try {
        localStorage.setItem(THEME_KEY, this.theme());
      } catch {
        // Storage unavailable (private window); the theme just won't be remembered.
      }
    });
  }

  protected toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  protected onSelectionChange(selection: TabSelection | null): void {
    this.selection.set(selection);
    this.notice.set(null);
  }

  protected toggleComponent(key: string, checked: boolean): void {
    this.checkedKeys.update((keys) => {
      const next = new Set(keys);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  protected toggleAllComponents(checked: boolean): void {
    const visible = this.visibleComponents().map((r) => r.key);
    this.checkedKeys.update((keys) => {
      const next = new Set(keys);
      for (const key of visible) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  protected onGenerate(selection: TabSelection): void {
    const rows = this.checkedComponents();
    if (!rows.length) {
      this.notice.set('Select at least one component to generate a checklist.');
      return;
    }
    this.notice.set(null);
    const components = this.registry.nav()?.components ?? {};
    const routes = this.registry.routes(selection.tab.routes);
    const tabCases = generateChecklist(rows, {
      tabTitle: selection.tab.title,
      routePath: routes[0]?.path,
      components,
      section: selection.tab.title,
    });
    // Every checklist starts with the sign-in page, which Playwright runs first.
    const signIn = this.registry.nav()?.routes.find((r) => r.path === SIGN_IN_PATH && r.component);
    const isSignInTab = routes.some((r) => r.path === SIGN_IN_PATH);
    const loginCases =
      signIn && !isSignInTab
        ? generateChecklist(this.registry.componentTree([signIn.id]).rows.slice(0, 1), {
            tabTitle: 'Sign in',
            routePath: SIGN_IN_PATH,
            components,
            section: 'Login',
          })
        : [];
    this.checklist.set(
      [...loginCases, ...tabCases].map((c, i) => ({
        ...c,
        id: `TC-${String(i + 1).padStart(3, '0')}`,
      })),
    );
    this.view.set('checklist');
    void this.registry.runE2e({ headed: selection.showBrowser });
  }

  protected onUnusedCode(menu: NavMenu | null): void {
    this.notice.set(`Unused code report${menu ? ` for "${menu.label}"` : ''} is not built yet.`);
  }
}

/** The saved choice, otherwise the OS appearance. */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Fall through to the OS preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
