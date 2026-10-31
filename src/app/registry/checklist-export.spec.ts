import {
  ChecklistExport,
  buildPdf,
  buildWorkbook,
  fileBaseName,
  summarize,
} from './checklist-export';
import { TestCase } from './checklist-generator';

const tc = (id: string, d: Partial<TestCase> = {}): TestCase => ({
  id,
  category: 'Buttons',
  component: 'PageComponent',
  title: `Case ${id}`,
  steps: ['Open the page.', 'Click Save.'],
  expected: 'Saved.',
  priority: 'Medium',
  source: 'page.html:1',
  verification: 'Needs verification',
  ...d,
});

const DATA: ChecklistExport = {
  title: 'Tumor Tracking',
  subtitle: 'Staff › Patient Management',
  exportedAt: new Date('2026-10-31T10:00:00Z'),
  total: 4,
  cases: [
    { ...tc('TC-001'), status: 'Pass', comment: '' },
    { ...tc('TC-002'), status: 'Fail', comment: 'No message shown' },
    { ...tc('TC-003', { category: 'Field validation' }), status: 'Not tested', comment: '' },
  ],
};

describe('checklist export', () => {
  it('summarises by status and category', () => {
    const s = summarize(DATA.cases);
    expect(s.counts).toEqual({ 'Not tested': 1, Pass: 1, Fail: 1, Blocked: 0 });
    expect(s.percent).toBe(67);
    expect(s.byCategory.map(([c]) => c)).toEqual(['Buttons', 'Field validation']);
  });

  it('names files after the tab and date', () => {
    expect(fileBaseName(DATA)).toBe('checklist-tumor-tracking-2026-10-31');
  });

  it('builds a Test Cases sheet and a Summary sheet', () => {
    const [cases, summary] = buildWorkbook(DATA);
    expect(cases.sheet).toBe('Test Cases');
    expect(cases.data).toHaveLength(4);
    const fail = cases.data[2] as Array<{ value: string }>;
    expect(fail.map((c) => c.value)).toEqual([
      'TC-002',
      'Buttons',
      'PageComponent',
      'Case TC-002',
      '1. Open the page.\n2. Click Save.',
      'Saved.',
      'Medium',
      'Needs verification',
      'Fail',
      'No message shown',
      'page.html:1',
    ]);

    expect(summary.sheet).toBe('Summary');
    const values = summary.data.map((row) =>
      (row as Array<{ value: unknown }>).map((c) => c.value),
    );
    expect(values).toContainEqual(['Cases', '3 of 4 (filtered)']);
    expect(values.at(-1)).toEqual(['All', 1, 1, 1, 0, 3]);
  });

  it('builds a PDF with a summary page and one page per category', async () => {
    const doc = await buildPdf(DATA);
    expect(doc.getNumberOfPages()).toBe(3);
    const text = doc.output();
    expect(text).toContain('Checklist: Tumor Tracking');
    expect(text).toContain('No message shown');
    expect(text).toContain('Page 3 of 3');
  });
});
