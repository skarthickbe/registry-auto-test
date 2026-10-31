import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, output, signal } from '@angular/core';

import { ChildDepth, NavMenu, NavTab, TabSelection } from '../registry-nav.model';
import { RegistryNavService } from '../registry-nav.service';

const STORAGE_KEY = 'registry-auto-test.nav-panel';

interface SavedState {
  menuId?: string;
  tabId?: string;
  showOther?: boolean;
  childDepth?: ChildDepth;
}

interface TabGroup {
  section?: string;
  tabs: NavTab[];
}

@Component({
  selector: 'app-nav-panel',
  imports: [DatePipe],
  templateUrl: './nav-panel.html',
  styleUrl: './nav-panel.scss',
})
export class NavPanel {
  protected readonly registry = inject(RegistryNavService);

  readonly selectionChange = output<TabSelection | null>();
  readonly generateChecklist = output<TabSelection>();
  readonly unusedCodeReport = output<NavMenu | null>();

  protected readonly depthOptions: Array<{ value: ChildDepth; label: string }> = [
    { value: null, label: 'Auto (all child components)' },
    { value: 0, label: '0 (route component only)' },
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
  ];

  private readonly saved = readState();
  protected readonly showOther = signal(this.saved.showOther ?? false);
  protected readonly childDepth = signal<ChildDepth>(this.saved.childDepth ?? null);
  protected readonly menuId = signal(this.saved.menuId ?? '');
  protected readonly tabId = signal(this.saved.tabId ?? '');

  /** Menus for the dropdown, grouped by audience; route-only menus only when "Show other menus" is ticked. */
  protected readonly menuGroups = computed(() => {
    const menus = (this.registry.nav()?.menus ?? []).filter((m) => m.confirmed || this.showOther());
    const groups = new Map<string, NavMenu[]>();
    for (const menu of menus) {
      const key = menu.confirmed ? menu.audience : 'Other routes';
      groups.set(key, [...(groups.get(key) ?? []), menu]);
    }
    return [...groups.entries()].map(([label, items]) => ({ label, menus: items }));
  });

  protected readonly selectedMenu = computed(() =>
    this.menuGroups()
      .flatMap((g) => g.menus)
      .find((m) => m.id === this.menuId()),
  );

  /** Tabs of the selected menu, grouped under their section (group_key) heading. */
  protected readonly tabGroups = computed<TabGroup[]>(() => {
    const groups: TabGroup[] = [];
    for (const tab of this.selectedMenu()?.tabs ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.section === tab.section) last.tabs.push(tab);
      else groups.push({ section: tab.section, tabs: [tab] });
    }
    return groups;
  });

  protected readonly selectedTab = computed(() =>
    this.selectedMenu()?.tabs.find((t) => t.id === this.tabId()),
  );

  private readonly selection = computed<TabSelection | null>(() => {
    const menu = this.selectedMenu();
    const tab = this.selectedTab();
    return menu && tab ? { menu, tab, childDepth: this.childDepth() } : null;
  });

  constructor() {
    void this.registry.load();
    effect(() => this.selectionChange.emit(this.selection()));
    effect(() =>
      writeState({
        menuId: this.menuId(),
        tabId: this.tabId(),
        showOther: this.showOther(),
        childDepth: this.childDepth(),
      }),
    );
  }

  protected selectMenu(id: string): void {
    this.menuId.set(id);
    this.tabId.set('');
  }

  protected depthKey(value: ChildDepth): string {
    return value === null ? 'auto' : String(value);
  }

  protected selectDepth(key: string): void {
    this.childDepth.set(key === 'auto' ? null : Number(key));
  }

  protected generate(): void {
    const selection = this.selection();
    if (selection) this.generateChecklist.emit(selection);
  }
}

function readState(): SavedState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedState;
  } catch {
    return {};
  }
}

function writeState(state: SavedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private window); the panel works without it.
  }
}
