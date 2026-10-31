import { ComponentRow } from './component-tree';
import { FormField, RegistryComponent, UiButton } from './registry-nav.model';

export type Priority = 'High' | 'Medium' | 'Low';
export type Verification = 'Verified from source' | 'Needs verification';
export type Status = 'Not tested' | 'Pass' | 'Fail' | 'Blocked';
export type Category =
  'Navigation' | 'Field validation' | 'Field input' | 'Buttons' | 'Dialogs' | 'Lists';

export interface TestCase {
  id: string;
  /** Checklist section, e.g. "Login" or the tab title. */
  section?: string;
  category: Category;
  /** Component class the case belongs to. */
  component: string;
  title: string;
  steps: string[];
  expected: string;
  priority: Priority;
  /** `file:line` the case was derived from. */
  source: string;
  /** Verified: the trigger and outcome are both in the code. Needs verification: inferred or conditional. */
  verification: Verification;
}

export interface ChecklistContext {
  tabTitle: string;
  /** First route of the tab, e.g. /staff/patient/details/:id/104. */
  routePath?: string;
  components: Record<string, RegistryComponent>;
  /** Section every generated case belongs to. */
  section?: string;
}

type Draft = Omit<TestCase, 'id'>;

const DESTRUCTIVE = /\b(save|submit|delete|remove|update|confirm)\b/i;
const CLOSING = /\b(close|cancel|dismiss)\b/i;

/** Test cases for the given (ticked) component rows, in tree order. */
export function generateChecklist(rows: ComponentRow[], ctx: ChecklistContext): TestCase[] {
  const drafts: Draft[] = [];
  for (const row of rows) {
    const c = row.component;
    const where = (line?: number) => (line && c.template ? `${c.template}:${line}` : c.file);
    if (row.level === 0) drafts.push(...pageCases(c, ctx));
    if (row.viaDialog) drafts.push(...dialogCases(row, ctx));
    for (const f of c.details.fields) drafts.push(...fieldCases(c.name, f, where(f.line)));
    for (const b of uniqueButtons(c.details.buttons))
      drafts.push(...buttonCases(c.name, b, where(b.line)));
    drafts.push(...listCases(c, where()));
  }
  return drafts.map((d, i) => ({
    id: `TC-${String(i + 1).padStart(3, '0')}`,
    section: ctx.section,
    ...d,
  }));
}

function pageCases(c: RegistryComponent, ctx: ChecklistContext): Draft[] {
  const path = ctx.routePath ?? '(route)';
  return [
    {
      category: 'Navigation',
      component: c.name,
      title: `Open the ${ctx.tabTitle} page`,
      steps: [
        `Sign in with a role that can see "${ctx.tabTitle}".`,
        path.includes(':')
          ? `Open ${path} with valid values for ${paramList(path)}.`
          : `Open ${path}.`,
      ],
      expected: `The ${ctx.tabTitle} page loads (${c.name}) without errors.`,
      priority: 'High',
      source: c.file,
      verification: 'Verified from source',
    },
  ];
}

function dialogCases(row: ComponentRow, ctx: ChecklistContext): Draft[] {
  const c = row.component;
  const opener = row.parent ? ctx.components[row.parent]?.name : undefined;
  const closer = uniqueButtons(c.details.buttons).find((b) =>
    CLOSING.test(`${b.text} ${b.click ?? ''}`),
  );
  const cases: Draft[] = [
    {
      category: 'Dialogs',
      component: c.name,
      title: `Open the ${c.name} dialog`,
      steps: [`On ${opener ?? 'the parent component'}, use the action that opens ${c.name}.`],
      expected: `The ${c.name} dialog opens with its content and buttons.`,
      priority: 'Medium',
      source: c.file,
      verification: 'Verified from source',
    },
  ];
  if (closer) {
    cases.push({
      category: 'Dialogs',
      component: c.name,
      title: `Close the ${c.name} dialog with "${closer.text}"`,
      steps: [`Open the ${c.name} dialog.`, `Click "${closer.text}".`],
      expected: `The dialog closes and ${opener ?? 'the parent page'} is unchanged.`,
      priority: 'Medium',
      source: c.template ? `${c.template}:${closer.line}` : c.file,
      verification: 'Needs verification',
    });
  }
  return cases;
}

function fieldCases(component: string, f: FormField, source: string): Draft[] {
  const cases: Draft[] = [];
  const base = { component, source };
  const used = new Set<string>();
  const error = (pattern: RegExp) => {
    const hit = f.errors.find((e) => pattern.test(e) && !used.has(e));
    if (hit) used.add(hit);
    return hit;
  };

  if (f.required) {
    const msg = error(/required|must|enter|select/i);
    cases.push({
      ...base,
      category: 'Field validation',
      title: `${f.label} is required`,
      steps: [`Leave "${f.label}" empty.`, 'Move to the next field, then try to save.'],
      expected: msg
        ? `"${msg}" is shown and the form is not saved.`
        : `"${f.label}" is marked invalid and the form is not saved.`,
      priority: 'High',
      verification: msg ? 'Verified from source' : 'Needs verification',
    });
  }
  if (f.requiredWhen) {
    cases.push({
      ...base,
      category: 'Field validation',
      title: `${f.label} is required only in some cases`,
      steps: [
        `Make the condition true: ${f.requiredWhen}.`,
        `Leave "${f.label}" empty and try to save.`,
        'Repeat with the condition false.',
      ],
      expected: `"${f.label}" is required only while the condition holds.`,
      priority: 'Medium',
      verification: 'Needs verification',
    });
  }
  if (f.maxLength && /^\d+$/.test(f.maxLength)) {
    const max = Number(f.maxLength);
    cases.push({
      ...base,
      category: 'Field validation',
      title: `${f.label} accepts at most ${max} characters`,
      steps: [`Type or paste ${max + 1} characters into "${f.label}".`],
      expected: `Only ${max} characters are kept.`,
      priority: 'Medium',
      verification: 'Verified from source',
    });
  }
  for (const v of f.validators ?? []) {
    if (!/^(pattern|email|min|max|minLength)/.test(v)) continue;
    const msg = error(/invalid|valid|format|must|least|greater|less/i);
    cases.push({
      ...base,
      category: 'Field validation',
      title: `${f.label} rejects invalid values (${v.replace(/\(.*\)$/, '')})`,
      steps: [`Enter a value in "${f.label}" that breaks ${v}.`],
      expected: msg ? `"${msg}" is shown.` : `"${f.label}" is marked invalid.`,
      priority: 'Medium',
      verification: msg ? 'Verified from source' : 'Needs verification',
    });
  }
  // Any error message not covered above still deserves a case.
  for (const msg of f.errors.filter((e) => !used.has(e))) {
    cases.push({
      ...base,
      category: 'Field validation',
      title: `${f.label}: "${msg}"`,
      steps: [`Enter a value in "${f.label}" that should trigger this message.`],
      expected: `"${msg}" is shown under "${f.label}".`,
      priority: 'Medium',
      verification: 'Needs verification',
    });
  }
  if (['select', 'radio', 'checkbox', 'toggle', 'date'].includes(f.kind)) {
    const action =
      f.kind === 'date'
        ? 'Pick a valid date'
        : f.kind === 'checkbox' || f.kind === 'toggle'
          ? 'Switch it on, then off'
          : `Choose ${f.options?.length ? `each option (${f.options.join(', ')})` : 'each option'}`;
    cases.push({
      ...base,
      category: 'Field input',
      title: `${f.label}: ${action.toLowerCase()}`,
      steps: [`In "${f.label}": ${action.toLowerCase()}.`, 'Save and reopen the page.'],
      expected: 'The chosen value is shown and kept after saving.',
      priority: 'Low',
      verification: 'Needs verification',
    });
  }
  return cases;
}

/** Desktop and mobile layouts often repeat a button; keep one per text + handler. */
function uniqueButtons(buttons: UiButton[]): UiButton[] {
  const seen = new Set<string>();
  return buttons.filter((b) => {
    const key = `${b.text}|${b.click ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buttonCases(component: string, b: UiButton, source: string): Draft[] {
  const cases: Draft[] = [];
  const label = `"${b.text}"`;
  if (b.click || b.submit) {
    cases.push({
      component,
      source,
      category: 'Buttons',
      title: `Click ${label}`,
      steps: [`Click ${label}.`],
      expected: CLOSING.test(`${b.text} ${b.click ?? ''}`)
        ? 'The dialog or form closes without saving.'
        : `${b.click ? `\`${b.click}\` runs` : 'The form is submitted'}: confirm the visible result (saved, navigated, dialog opened, list refreshed).`,
      priority: DESTRUCTIVE.test(b.text) ? 'High' : 'Medium',
      verification: 'Needs verification',
    });
  }
  if (b.disabledWhen) {
    cases.push({
      component,
      source,
      category: 'Buttons',
      title: `${label} is disabled until allowed`,
      steps: [
        `Make this true: ${b.disabledWhen}.`,
        `Check ${label}, then make it false and check again.`,
      ],
      expected: `${label} is disabled only while the condition is true.`,
      priority: 'Medium',
      verification: 'Verified from source',
    });
  }
  return cases;
}

function listCases(c: RegistryComponent, source: string): Draft[] {
  const d = c.details;
  const cases: Draft[] = [];
  const base = { component: c.name, source, category: 'Lists' as const };
  if (d.tables) {
    cases.push(
      {
        ...base,
        title: 'Table shows records',
        steps: ['Open the page with existing records.'],
        expected: 'Every record appears with correct values in each column.',
        priority: 'Medium',
        verification: 'Verified from source',
      },
      {
        ...base,
        title: 'Table with no records',
        steps: ['Open the page for a case with no records.'],
        expected: 'An empty state is shown instead of a blank table.',
        priority: 'Low',
        verification: 'Needs verification',
      },
    );
  }
  if (d.paginator) {
    cases.push({
      ...base,
      title: 'Paging',
      steps: [
        'Open a list with more records than one page.',
        'Go to the next page and change the page size.',
      ],
      expected: 'The right records show on each page and the page size applies.',
      priority: 'Low',
      verification: 'Verified from source',
    });
  }
  if (d.sort) {
    cases.push({
      ...base,
      title: 'Sorting',
      steps: ['Click each sortable column header twice.'],
      expected: 'Rows sort ascending, then descending, by that column.',
      priority: 'Low',
      verification: 'Verified from source',
    });
  }
  return cases;
}

function paramList(path: string): string {
  return path
    .split('/')
    .filter((s) => s.startsWith(':'))
    .join(', ');
}
