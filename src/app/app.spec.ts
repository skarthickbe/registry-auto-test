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
    const change = async (selector: string, value: string | boolean) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      if (typeof value === 'boolean') input.checked = value;
      else input.value = value;
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, change };
  }

  const optionLabels = (el: HTMLElement, selector: string) =>
    [...el.querySelectorAll<HTMLOptionElement>(`${selector} option`)].map((o) =>
      o.textContent?.trim(),
    );

  it('lists only confirmed menus until "Show other menus" is ticked', async () => {
    const { el, change } = await render();
    expect(optionLabels(el, '#menu')).toEqual(['Select a menu…', 'Staff › Patient Management']);

    await change('input[type=checkbox]', true);
    expect(optionLabels(el, '#menu')).toContain('Other Routes › /wr');
  });

  it('shows the routes of the selected tab', async () => {
    const { el, change } = await render();
    await change('#menu', 'staff-pm');
    await change('#tab', 't1');

    expect(el.querySelector('main h1')?.textContent).toContain('Tumor Tracking');
    expect(el.querySelector('main .crumb')?.textContent).toContain('My Diagnosis & Tumor Details');
    expect(el.querySelector('main table')?.textContent).toContain('/staff/patient/details/:id/104');
  });

  it('shows a notice when Generate Checklist is clicked', async () => {
    const { el, change } = await render();
    await change('#menu', 'staff-pm');
    await change('#tab', 't1');
    el.querySelector<HTMLButtonElement>('.btn.primary')!.click();
    await TestBed.inject(HttpTestingController).verify();
    TestBed.tick();

    expect(el.querySelector('main .notice')?.textContent).toContain('Tumor Tracking');
  });

  it('switches and remembers the theme', async () => {
    localStorage.setItem('registry-auto-test.theme', 'light');
    const { el } = await render();
    expect(document.documentElement.dataset['theme']).toBe('light');

    const toggle = el.querySelector<HTMLButtonElement>('.theme-toggle')!;
    expect(toggle.textContent).toContain('Dark');
    toggle.click();
    TestBed.tick();

    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('registry-auto-test.theme')).toBe('dark');
    expect(toggle.textContent).toContain('Light');
  });
});
