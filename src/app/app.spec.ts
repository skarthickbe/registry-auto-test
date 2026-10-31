import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { RegistryNav } from './registry/registry-nav.model';

const NAV: RegistryNav = {
  generatedAt: '2026-10-31T00:00:00.000Z',
  source: { appPath: '/registry-app' },
  warnings: [],
  routes: [
    {
      id: 'r1',
      path: '/staff/patient/details/:id/104',
      component: 'TumorTrackingComponent',
      parents: [],
      definedIn: { file: 'src/app/patient-panel.routes.ts', line: 66 },
    },
  ],
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
    return { el, optionLabels, choose, tick };
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

  it('shows a notice when Generate Checklist is clicked', async () => {
    const { el, choose } = await render();
    await choose('menu', 'Patient Management');
    await choose('tab', 'Tumor Tracking');
    el.querySelector<HTMLButtonElement>('.btn.primary')!.click();
    TestBed.inject(HttpTestingController).verify();
    TestBed.tick();

    expect(el.querySelector('main .notice')?.textContent).toContain('Tumor Tracking');
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
