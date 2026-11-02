import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';

import { Select, SelectGroup } from '../../ui/select/select';
import { Status, TestCase } from '../checklist-generator';
import { ChecklistExport, exportExcel, exportPdf } from '../checklist-export';
import { E2eResult } from '../registry-nav.model';
import { RegistryNavService } from '../registry-nav.service';

interface CaseResult {
  status: Status;
  comment: string;
}

const STORAGE_PREFIX = 'registry-auto-test.checklist.';
const LIVE_FRAME_MS = 400;
const ALL = '';

/** Results are stored by component + title, so they survive regeneration (ids shift when the ticked components change). */
const fingerprint = (c: TestCase) => `${c.component}|${c.title}`;

const E2E_STATUS: Record<E2eResult['status'], Status> = {
  passed: 'Pass',
  failed: 'Fail',
  timedOut: 'Fail',
  interrupted: 'Fail',
  skipped: 'Not tested',
};

@Component({
  selector: 'app-checklist-view',
  imports: [Select, DatePipe],
  templateUrl: './checklist-view.html',
  styleUrl: './checklist-view.scss',
})
export class ChecklistView {
  protected readonly registry = inject(RegistryNavService);
  readonly cases = input.required<TestCase[]>();
  /** Where this checklist's results are saved, e.g. the menu + tab id. */
  readonly storageKey = input.required<string>();
  /** Used in exported file names and headings. */
  readonly title = input('');
  readonly subtitle = input('');

  protected readonly statuses: Status[] = ['Pass', 'Fail', 'Blocked'];
  protected readonly exportFilteredOnly = signal(false);
  protected readonly exporting = signal<'excel' | 'pdf' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  protected readonly results = linkedSignal(() => readResults(this.storageKey()));
  /** Playwright results by component + title. Page-open cases match any "Open the … page" test of their component. */
  private readonly e2eByKey = computed(() => {
    const map = new Map<string, E2eResult>();
    for (const r of this.registry.e2e()?.results ?? []) {
      map.set(`${r.component}|${r.title}`, r);
      if (/^Open the .* page$/.test(r.title)) map.set(`${r.component}|@page`, r);
    }
    return map;
  });

  protected readonly e2eMatched = computed(() => this.cases().filter((c) => this.e2eOf(c)).length);

  protected readonly search = signal('');
  protected readonly category = signal(ALL);
  protected readonly statusFilter = signal(ALL);
  protected readonly verification = signal(ALL);

  protected readonly categoryOptions = computed<SelectGroup[]>(() => [
    {
      options: [
        { value: ALL, label: 'All categories' },
        ...[...new Set(this.cases().map((c) => c.category))].map((c) => ({ value: c, label: c })),
      ],
    },
  ]);

  protected readonly statusOptions: SelectGroup[] = [
    {
      options: [
        { value: ALL, label: 'All statuses' },
        ...(['Not tested', 'Pass', 'Fail', 'Blocked'] as const).map((s) => ({
          value: s,
          label: s,
        })),
      ],
    },
  ];

  protected readonly verificationOptions: SelectGroup[] = [
    {
      options: [
        { value: ALL, label: 'Any verification' },
        { value: 'Verified from source', label: 'Verified from source' },
        { value: 'Needs verification', label: 'Needs verification' },
      ],
    },
  ];

  protected readonly counts = computed(() => {
    const counts: Record<Status, number> = { 'Not tested': 0, Pass: 0, Fail: 0, Blocked: 0 };
    for (const c of this.cases()) counts[this.statusOf(c)]++;
    return counts;
  });

  protected readonly done = computed(() => {
    const total = this.cases().length;
    return total ? Math.round(((total - this.counts()['Not tested']) / total) * 100) : 0;
  });

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.cases().filter(
      (c) =>
        (!this.category() || c.category === this.category()) &&
        (!this.statusFilter() || this.statusOf(c) === this.statusFilter()) &&
        (!this.verification() || c.verification === this.verification()) &&
        (!q ||
          [c.id, c.title, c.component, c.expected, ...c.steps].some((t) =>
            t.toLowerCase().includes(q),
          )),
    );
  });

  /** Bumped while a run is in progress so the live frame reloads. */
  protected readonly frameTick = signal(0);
  protected readonly liveFrame = computed(() => `e2e-api/live/frame.jpg?t=${this.frameTick()}`);
  /** False until the first frame of a run has loaded. */
  protected readonly frameReady = signal(false);
  /** Frame requests that failed in a row; many means the runner has no live view. */
  protected readonly frameErrors = signal(0);
  protected readonly running = computed(() => this.registry.e2eRun()?.state === 'running');

  constructor() {
    effect(() => writeResults(this.storageKey(), this.results()));
    effect((onCleanup) => {
      if (!this.running()) return;
      const timer = setInterval(() => this.frameTick.update((n) => n + 1), LIVE_FRAME_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected runLive(): void {
    this.frameReady.set(false);
    this.frameErrors.set(0);
    void this.registry.runE2e();
  }

  protected e2eOf(c: TestCase): E2eResult | undefined {
    const map = this.e2eByKey();
    return (
      map.get(fingerprint(c)) ??
      (c.category === 'Navigation' ? map.get(`${c.component}|@page`) : undefined)
    );
  }

  /** A status set by hand wins; otherwise the Playwright result, if there is one. */
  protected statusOf(c: TestCase): Status {
    const e2e = this.e2eOf(c);
    return this.manualStatusOf(c) ?? (e2e ? E2E_STATUS[e2e.status] : 'Not tested');
  }

  protected isAutoStatus(c: TestCase): boolean {
    return !this.manualStatusOf(c) && !!this.e2eOf(c);
  }

  private manualStatusOf(c: TestCase): Status | undefined {
    const status = this.results()[fingerprint(c)]?.status;
    return status && status !== 'Not tested' ? status : undefined;
  }

  protected commentOf(c: TestCase): string {
    return this.results()[fingerprint(c)]?.comment ?? '';
  }

  /** Clicking the active status again sets the case back to Not tested. */
  protected setStatus(c: TestCase, status: Status): void {
    this.update(c, { status: this.manualStatusOf(c) === status ? 'Not tested' : status });
  }

  protected setComment(c: TestCase, comment: string): void {
    this.update(c, { comment });
  }

  protected async export(format: 'excel' | 'pdf'): Promise<void> {
    const source = this.exportFilteredOnly() ? this.filtered() : this.cases();
    const data: ChecklistExport = {
      title: this.title(),
      subtitle: this.subtitle(),
      exportedAt: new Date(),
      total: this.cases().length,
      cases: source.map((c) => ({ ...c, status: this.statusOf(c), comment: this.commentOf(c) })),
    };
    this.exporting.set(format);
    this.exportError.set(null);
    try {
      await (format === 'excel' ? exportExcel(data) : exportPdf(data));
    } catch {
      this.exportError.set(`Could not create the ${format === 'excel' ? 'Excel' : 'PDF'} file.`);
    } finally {
      this.exporting.set(null);
    }
  }

  protected clearFilters(): void {
    this.search.set('');
    this.category.set(ALL);
    this.statusFilter.set(ALL);
    this.verification.set(ALL);
  }

  private update(c: TestCase, change: Partial<CaseResult>): void {
    const key = fingerprint(c);
    this.results.update((all) => {
      const next = {
        status: this.manualStatusOf(c) ?? 'Not tested',
        comment: this.commentOf(c),
        ...change,
      };
      const copy = { ...all };
      if (next.status === 'Not tested' && !next.comment) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }
}

function readResults(key: string): Record<string, CaseResult> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) ?? '{}') as Record<
      string,
      CaseResult
    >;
  } catch {
    return {};
  }
}

function writeResults(key: string, results: Record<string, CaseResult>): void {
  try {
    if (Object.keys(results).length)
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(results));
    else localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage unavailable (private window); results last until the page is closed.
  }
}
