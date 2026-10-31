import type { jsPDF } from 'jspdf';
import type { Sheet } from 'write-excel-file/browser';

import { Status, TestCase } from './checklist-generator';

export interface ExportCase extends TestCase {
  status: Status;
  comment: string;
}

export interface ChecklistExport {
  /** Tab title, e.g. "Tumor Tracking". */
  title: string;
  /** Menu label, e.g. "Staff › Patient Management". */
  subtitle: string;
  exportedAt: Date;
  cases: ExportCase[];
  /** Size of the full checklist; differs from cases.length when only filtered cases are exported. */
  total: number;
}

const STATUSES: Status[] = ['Not tested', 'Pass', 'Fail', 'Blocked'];
const STATUS_COLORS: Record<Status, string> = {
  'Not tested': '#5d6677',
  Pass: '#2e9d5b',
  Fail: '#d14343',
  Blocked: '#d08a1e',
};

export function summarize(cases: ExportCase[]) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  const byCategory = new Map<string, Record<Status, number>>();
  for (const c of cases) {
    counts[c.status]++;
    const row =
      byCategory.get(c.category) ??
      (Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>);
    row[c.status]++;
    byCategory.set(c.category, row);
  }
  const tested = cases.length - counts['Not tested'];
  return {
    counts,
    byCategory: [...byCategory.entries()],
    percent: cases.length ? Math.round((tested / cases.length) * 100) : 0,
  };
}

export function fileBaseName(data: ChecklistExport): string {
  const slug = data.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `checklist-${slug || 'tab'}-${data.exportedAt.toISOString().slice(0, 10)}`;
}

const numberedSteps = (c: TestCase) => c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

/** The two Excel sheets: every case, then a summary by status and category. */
export function buildWorkbook(data: ChecklistExport): Sheet<never>[] {
  const bold = (value: string) => ({
    value,
    fontWeight: 'bold' as const,
    backgroundColor: '#e3e8f2',
  });
  const text = (value: string) => ({ value, wrap: true, alignVertical: 'top' as const });
  const headers = [
    'ID',
    'Category',
    'Component',
    'Test case',
    'Steps',
    'Expected result',
    'Priority',
    'Verification',
    'Status',
    'Actual result / comment',
    'Source',
  ];
  const caseRows = data.cases.map((c) => [
    text(c.id),
    text(c.category),
    text(c.component),
    text(c.title),
    text(numberedSteps(c)),
    text(c.expected),
    text(c.priority),
    text(c.verification),
    { ...text(c.status), fontWeight: 'bold' as const, textColor: STATUS_COLORS[c.status] },
    text(c.comment),
    text(c.source),
  ]);

  const { counts, byCategory, percent } = summarize(data.cases);
  const summary = [
    [bold('Checklist'), text(data.title)],
    [bold('Menu'), text(data.subtitle)],
    [bold('Exported'), text(data.exportedAt.toLocaleString())],
    [
      bold('Cases'),
      text(
        data.cases.length === data.total
          ? `${data.total}`
          : `${data.cases.length} of ${data.total} (filtered)`,
      ),
    ],
    [bold('Tested'), text(`${percent}%`)],
    [],
    [bold('Category'), ...STATUSES.map(bold), bold('Total')],
    ...byCategory.map(([category, row]) => [
      text(category),
      ...STATUSES.map((s) => ({ value: row[s] })),
      { value: STATUSES.reduce((n, s) => n + row[s], 0) },
    ]),
    [
      bold('All'),
      ...STATUSES.map((s) => ({ value: counts[s], fontWeight: 'bold' as const })),
      { value: data.cases.length, fontWeight: 'bold' as const },
    ],
  ];

  return [
    {
      sheet: 'Test Cases',
      data: [headers.map(bold), ...caseRows],
      columns: [9, 16, 28, 40, 50, 45, 9, 20, 11, 35, 45].map((width) => ({ width })),
      stickyRowsCount: 1,
    },
    {
      sheet: 'Summary',
      data: summary,
      columns: [18, 34, 10, 10, 10, 10].map((width) => ({ width })),
    },
  ];
}

export async function exportExcel(data: ChecklistExport): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(buildWorkbook(data)).toFile(`${fileBaseName(data)}.xlsx`);
}

/** A landscape A4 PDF: summary first, then one table per category. */
export async function buildPdf(data: ChecklistExport): Promise<jsPDF> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const margin = 40;
  const head = { fillColor: [61, 90, 153] as [number, number, number], textColor: 255 };

  const { counts, byCategory, percent } = summarize(data.cases);
  doc.setFontSize(18).text(`Checklist: ${data.title}`, margin, 50);
  doc
    .setFontSize(10)
    .setTextColor(93, 102, 119)
    .text(
      [
        data.subtitle,
        `Exported ${data.exportedAt.toLocaleString()}`,
        data.cases.length === data.total
          ? `${data.total} cases · ${percent}% tested`
          : `${data.cases.length} of ${data.total} cases (filtered) · ${percent}% tested`,
      ],
      margin,
      70,
    )
    .setTextColor(0);

  autoTable(doc, {
    startY: 115,
    margin: { left: margin, right: margin },
    head: [['Category', ...STATUSES, 'Total']],
    body: [
      ...byCategory.map(([category, row]) => [
        category,
        ...STATUSES.map((s) => row[s]),
        STATUSES.reduce((n, s) => n + row[s], 0),
      ]),
      ['All', ...STATUSES.map((s) => counts[s]), data.cases.length],
    ],
    headStyles: head,
    styles: { fontSize: 9 },
  });

  for (const [category] of byCategory) {
    doc.addPage();
    doc.setFontSize(14).text(category, margin, 50);
    autoTable(doc, {
      startY: 65,
      margin: { left: margin, right: margin },
      head: [['ID', 'Test case', 'Expected result', 'Priority', 'Status', 'Comment']],
      body: data.cases
        .filter((c) => c.category === category)
        .map((c) => [
          c.id,
          `${c.title}\n${c.component}\n\n${numberedSteps(c)}\n\nSource: ${c.source}`,
          c.expected,
          c.priority,
          c.status,
          c.comment,
        ]),
      headStyles: head,
      styles: { fontSize: 8, valign: 'top', overflow: 'linebreak' },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 300 },
        2: { cellWidth: 190 },
        3: { cellWidth: 50 },
        4: { cellWidth: 60, fontStyle: 'bold' },
      },
      didParseCell: (hook) => {
        if (hook.section === 'body' && hook.column.index === 4) {
          hook.cell.styles.textColor = STATUS_COLORS[hook.cell.raw as Status];
        }
      },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFontSize(8).setTextColor(93, 102, 119);
    doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.getWidth() - margin, 570, {
      align: 'right',
    });
  }
  return doc;
}

export async function exportPdf(data: ChecklistExport): Promise<void> {
  (await buildPdf(data)).save(`${fileBaseName(data)}.pdf`);
}
