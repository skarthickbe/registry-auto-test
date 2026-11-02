import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { ComponentDetails, RegistryNav } from './registry/registry-nav.model';

const NO_DETAILS: ComponentDetails = {
  fields: [],
  buttons: [],
  tables: 0,
  repeats: 0,
  paginator: false,
  sort: false,
};

const NAV: RegistryNav = {
  generatedAt: '2026-10-31T00:00:00.000Z',
  source: { appPath: '/registry-app' },
  warnings: [],
  routes: [
    {
      id: 'r1',
      path: '/staff/patient/details/:id/104',
      component: 'TumorTrackingComponent',
      componentFile: 'tumor-tracking.ts',
      parents: [],
      definedIn: { file: 'src/app/patient-panel.routes.ts', line: 66 },
    },
  ],
  components: {
    'tumor-tracking.ts#TumorTrackingComponent': {
      name: 'TumorTrackingComponent',
      file: 'tumor-tracking.ts',
      children: ['viewer.ts#TextInputViewerComponent'],
      dialogs: ['add-tumor.ts#AddTumorComponent'],
      details: NO_DETAILS,
    },
    'viewer.ts#TextInputViewerComponent': {
      name: 'TextInputViewerComponent',
      file: 'viewer.ts',
      children: [],
      dialogs: [],
      details: NO_DETAILS,
    },
    'add-tumor.ts#AddTumorComponent': {
      name: 'AddTumorComponent',
      file: 'add-tumor.ts',
      children: ['upload.ts#UploadWidgetComponent'],
      dialogs: [],
      details: NO_DETAILS,
    },
    'upload.ts#UploadWidgetComponent': {
      name: 'UploadWidgetComponent',
      file: 'upload.ts',
      children: [],
      dialogs: [],
      details: NO_DETAILS,
    },
  },
  menus: [
    {
      id: 'staff-pm',
      label: 'Staff › Patient Management',
      audience: 'Staff',
      confirmed: true,
      tabs: [
        {
          id: 't1',
          title: 'Tumor Tracking',
          section: 'My Diagnosis & Tumor Details',
          routes: ['r1'],
          note: 'Matched by subpage id 104.',
        },
      ],
    },
    { id: 'other-wr', label: 'Other Routes › /wr', audience: 'Other', confirmed: false, tabs: [] },
  ],
};

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne((req) => req.url.startsWith('registry-nav.json'))
      .flush(NAV);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const toggle = async (triggerId: string) => {
      el.querySelector<HTMLButtonElement>(`#${triggerId}`)!.click();
      await settle();
    };
    /** Opens a dropdown, reads its option labels, and closes it again. */
    const optionLabels = async (triggerId: string) => {
      await toggle(triggerId);
      const labels = [...el.querySelectorAll('[role=option]')].map((o) => o.textContent?.trim());
      await toggle(triggerId);
      return labels;
    };
    const choose = async (triggerId: string, label: string) => {
      await toggle(triggerId);
      [...el.querySelectorAll<HTMLElement>('[role=option]')]
        .find((o) => o.textContent?.trim() === label)!
        .click();
      await settle();
    };
    const tick = async (selector: string) => {
      el.querySelector<HTMLInputElement>(selector)!.click();
      await settle();
    };
    const click = async (selector: string) => {
      el.querySelector<HTMLButtonElement>(selector)!.click();
      await settle();
    };
    return { el, optionLabels, choose, tick, click };
  }

  it('lists only confirmed menus until "Show other menus" is ticked', async () => {
    const { optionLabels, tick } = await render();
    expect(await optionLabels('menu')).toEqual(['Patient Management']);

    await tick('input[type=checkbox]');
    expect(await optionLabels('menu')).toContain('/wr');
  });

  it('shows the routes of the selected tab', async () => {
    const { el, choose } = await render();
    await choose('menu', 'Patient Management');
    expect(el.querySelector('#menu')?.textContent).toContain('Staff › Patient Management');
    await choose('tab', 'Tumor Tracking');

    expect(el.querySelector('main h1')?.textContent).toContain('Tumor Tracking');
    expect(el.querySelector('main .crumb')?.textContent).toContain('My Diagnosis & Tumor Details');
    expect(el.querySelector('main table')?.textContent).toContain('/staff/patient/details/:id/104');
  });

  it('generates a checklist, switches to it and keeps results', async () => {
    const { el, choose, click } = await render();
    await choose('menu', 'Patient Management');
    await choose('tab', 'Tumor Tracking');
    expect(el.querySelector<HTMLButtonElement>('.view-tab:nth-child(2)')!.disabled).toBe(true);

    await click('.btn.primary');
    const titles = () => [...el.querySelectorAll('.cases .title')].map((t) => t.textContent);
    expect(el.querySelector('.view-tab.on')?.textContent).toContain('Checklist');
    expect(el.querySelector('.view-tab .badge')?.textContent).toBe('2');
    expect(titles()).toEqual(['Open the Tumor Tracking page', 'Open the AddTumorComponent dialog']);

    await click('.cases .case:first-of-type .status-btn[data-status="Pass"]');
    expect(el.querySelector('.count.pass strong')?.textContent).toBe('1');

    await click('.view-tab:nth-child(1)');
    expect(el.querySelector('.tree')).toBeTruthy();
    await click('.view-tab:nth-child(2)');
    expect(
      el.querySelector('.cases .case:first-of-type .status-btn.on')?.getAttribute('data-status'),
    ).toBe('Pass');
  });

  it('previews the component tree and offers one depth per level', async () => {
    const { el, choose, optionLabels } = await render();
    await choose('menu', 'Patient Management');
    await choose('tab', 'Tumor Tracking');

    const rows = () =>
      [...el.querySelectorAll('.tree li')].map((li) =>
        [...li.querySelectorAll('.tree-line > span')].map((s) => s.textContent!.trim()).join(' '),
      );
    expect(rows()).toEqual([
      'L0 TumorTrackingComponent',
      'L1 TextInputViewerComponent',
      'L1 AddTumorComponent dialog',
      'L2 UploadWidgetComponent',
    ]);
    expect(await optionLabels('depth')).toEqual([
      'Auto · 2 levels · 4 components',
      '0 · route component only · 1 component',
      '1 · up to level 1 · 3 components',
      '2 · up to level 2 · 4 components',
    ]);

    await choose('depth', '1 · up to level 1 · 3 components');
    expect(rows()).toHaveLength(3);
    expect(el.querySelector('main')!.textContent).toContain('showing up to level 1');
  });

  it('generates only for the ticked components', async () => {
    const { el, choose, tick, click } = await render();
    await choose('menu', 'Patient Management');
    await choose('tab', 'Tumor Tracking');
    const toolbar = () => el.querySelector('.tree-toolbar')!.textContent!;
    const selectAll = () => el.querySelector<HTMLInputElement>('.tree-toolbar input')!;
    expect(toolbar()).toContain('4 of 4 selected');

    // Untick AddTumorComponent (the third row): its dialog case disappears.
    await tick('.tree li:nth-child(3) input');
    expect(toolbar()).toContain('3 of 4 selected');
    expect(selectAll().indeterminate).toBe(true);
    await click('.btn.primary');
    expect([...el.querySelectorAll('.cases .title')].map((t) => t.textContent)).toEqual([
      'Open the Tumor Tracking page',
    ]);

    await click('.view-tab:nth-child(1)');
    await tick('.tree-toolbar input');
    await tick('.tree-toolbar input');
    expect(toolbar()).toContain('0 of 4 selected');
    await click('.btn.primary');
    expect(el.querySelector('main .notice')?.textContent).toContain(
      'Select at least one component',
    );
  });

  it('asks the runner to show the browser when that option is ticked', async () => {
    const { el, choose, click } = await render();
    await choose('menu', 'Patient Management');
    await choose('tab', 'Tumor Tracking');
    const http = TestBed.inject(HttpTestingController);

    await click('.btn.primary');
    expect(http.expectOne('e2e-api/run').request.body).toEqual({ headed: false });

    [...el.querySelectorAll<HTMLLabelElement>('app-nav-panel label.check')]
      .find((l) => l.textContent!.includes('Show the browser'))!
      .querySelector('input')!
      .click();
    await click('.btn.primary');
    expect(http.expectOne('e2e-api/run').request.body).toEqual({ headed: true });
  });

  it('switches and remembers the theme', async () => {
    localStorage.setItem('registry-auto-test.theme', 'light');
    const { el } = await render();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(el.querySelector('header .logo')?.getAttribute('alt')).toBe('LRG Patient Registry');

    const toggle = el.querySelector<HTMLButtonElement>('header .theme-toggle')!;
    expect(toggle.textContent).toContain('Dark');
    toggle.click();
    TestBed.tick();

    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('registry-auto-test.theme')).toBe('dark');
    expect(toggle.textContent).toContain('Light');
  });
});
