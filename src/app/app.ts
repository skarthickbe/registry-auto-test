import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';

import { NavPanel } from './registry/nav-panel/nav-panel';
import { NavMenu, TabSelection } from './registry/registry-nav.model';
import { RegistryNavService } from './registry/registry-nav.service';

type Theme = 'light' | 'dark';

const THEME_KEY = 'registry-auto-test.theme';

@Component({
  selector: 'app-root',
  imports: [NavPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly registry = inject(RegistryNavService);
  protected readonly selection = signal<TabSelection | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly theme = signal<Theme>(initialTheme());

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
    const count = this.checkedComponents().length;
    this.notice.set(
      count
        ? `Checklist for "${selection.tab.title}": ${count} component${count === 1 ? '' : 's'} selected. Generation is not built yet.`
        : 'Select at least one component to generate a checklist.',
    );
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
