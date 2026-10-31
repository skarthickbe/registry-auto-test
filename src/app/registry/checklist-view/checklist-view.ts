import { Component, computed, effect, input, linkedSignal, signal } from '@angular/core';

import { Select, SelectGroup } from '../../ui/select/select';
import { Status, TestCase } from '../checklist-generator';
import { ChecklistExport, exportExcel, exportPdf } from '../checklist-export';

interface CaseResult {
  status: Status;
  comment: string;
}

const STORAGE_PREFIX = 'registry-auto-test.checklist.';
const ALL = '';

/** Results are stored by component + title, so they survive regeneration (ids shift when the ticked components change). */
const fingerprint = (c: TestCase) => `${c.component}|${c.title}`;

@Component({
  selector: 'app-checklist-view',
  imports: [Select],
  templateUrl: './checklist-view.html',
  styleUrl: './checklist-view.scss',
})
export class ChecklistView {
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

  constructor() {
    effect(() => writeResults(this.storageKey(), this.results()));
  }

  protected statusOf(c: TestCase): Status {
    return this.results()[fingerprint(c)]?.status ?? 'Not tested';
  }

  protected commentOf(c: TestCase): string {
    return this.results()[fingerprint(c)]?.comment ?? '';
  }

  /** Clicking the active status again sets the case back to Not tested. */
  protected setStatus(c: TestCase, status: Status): void {
    this.update(c, { status: this.statusOf(c) === status ? 'Not tested' : status });
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
      const next = { status: this.statusOf(c), comment: this.commentOf(c), ...change };
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
