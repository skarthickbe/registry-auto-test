import { generateChecklist } from './checklist-generator';
import { ComponentRow } from './component-tree';
import { ComponentDetails, RegistryComponent } from './registry-nav.model';

const details = (d: Partial<ComponentDetails>): ComponentDetails => ({
  fields: [],
  buttons: [],
  tables: 0,
  repeats: 0,
  paginator: false,
  sort: false,
  ...d,
});

const PAGE: RegistryComponent = {
  name: 'GeneralInfoComponent',
  file: 'general-info.component.ts',
  template: 'general-info.component.html',
  children: [],
  dialogs: ['edit.ts#EditDialogComponent'],
  details: details({
    fields: [
      {
        name: 'first_name',
        label: 'First Name',
        kind: 'text',
        maxLength: '255',
        required: true,
        validators: ['required'],
        errors: ['First Name is required'],
        line: 10,
      },
      {
        name: 'email',
        label: 'Email',
        kind: 'text',
        required: false,
        validators: ['pattern("^.+@.+$")'],
        errors: ['Enter a valid email'],
        line: 20,
      },
      {
        name: 'race_other',
        label: 'Race (other)',
        kind: 'text',
        required: false,
        requiredWhen: 'this.showRaceOther',
        errors: [],
        line: 30,
      },
      { name: 'gender', label: 'Sex', kind: 'select', required: false, errors: [], line: 40 },
    ],
    buttons: [
      { text: 'Save', click: 'save()', disabledWhen: 'form.invalid', submit: false, line: 50 },
      // the same button again in the mobile layout
      { text: 'Save', click: 'save()', disabledWhen: 'form.invalid', submit: false, line: 90 },
    ],
    tables: 1,
    paginator: true,
  }),
};

const DIALOG: RegistryComponent = {
  name: 'EditDialogComponent',
  file: 'edit.ts',
  template: 'edit.html',
  children: [],
  dialogs: [],
  details: details({
    buttons: [{ text: 'Cancel', click: 'dialogRef.close()', submit: false, line: 5 }],
  }),
};

const COMPONENTS = { 'page.ts#GeneralInfoComponent': PAGE, 'edit.ts#EditDialogComponent': DIALOG };

const ROWS: ComponentRow[] = [
  { key: 'page.ts#GeneralInfoComponent', component: PAGE, level: 0, viaDialog: false },
  {
    key: 'edit.ts#EditDialogComponent',
    component: DIALOG,
    level: 1,
    viaDialog: true,
    parent: 'page.ts#GeneralInfoComponent',
  },
];

describe('generateChecklist', () => {
  const cases = generateChecklist(ROWS, {
    tabTitle: 'General Information',
    routePath: '/staff/patient/details/:id/101',
    components: COMPONENTS,
  });
  const byTitle = (title: string) => cases.find((c) => c.title === title)!;

  it('numbers cases and starts with opening the page', () => {
    expect(cases[0].id).toBe('TC-001');
    expect(cases[0].title).toBe('Open the General Information page');
    expect(cases[0].steps[1]).toContain('valid values for :id');
  });

  it('builds field validation cases from rules and error messages', () => {
    const required = byTitle('First Name is required');
    expect(required.expected).toContain('"First Name is required" is shown');
    expect(required).toMatchObject({ priority: 'High', verification: 'Verified from source' });
    expect(required.source).toBe('general-info.component.html:10');

    expect(byTitle('First Name accepts at most 255 characters').steps[0]).toContain('256');
    expect(byTitle('Email rejects invalid values (pattern)').expected).toContain(
      'Enter a valid email',
    );
    expect(byTitle('Race (other) is required only in some cases').verification).toBe(
      'Needs verification',
    );
    expect(byTitle('Sex: choose each option').category).toBe('Field input');
  });

  it('merges repeated buttons and covers their disabled condition', () => {
    expect(cases.filter((c) => c.title === 'Click "Save"')).toHaveLength(1);
    expect(byTitle('Click "Save"').priority).toBe('High');
    expect(byTitle('"Save" is disabled until allowed').steps[0]).toContain('form.invalid');
  });

  it('covers dialogs with their opener and close button', () => {
    expect(byTitle('Open the EditDialogComponent dialog').steps[0]).toContain(
      'GeneralInfoComponent',
    );
    expect(byTitle('Close the EditDialogComponent dialog with "Cancel"').expected).toContain(
      'closes',
    );
  });

  it('adds list cases for tables and paging', () => {
    expect(cases.filter((c) => c.category === 'Lists').map((c) => c.title)).toEqual([
      'Table shows records',
      'Table with no records',
      'Paging',
    ]);
  });
});
