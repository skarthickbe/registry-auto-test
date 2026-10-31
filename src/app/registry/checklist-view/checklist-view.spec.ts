import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { RegistryNavService } from '../registry-nav.service';

import { TestCase } from '../checklist-generator';
import { ChecklistView } from './checklist-view';

const tc = (id: string, title: string, d: Partial<TestCase> = {}): TestCase => ({
  id,
  category: 'Buttons',
  component: 'PageComponent',
  title,
  steps: ['Do it.'],
  expected: 'It works.',
  priority: 'Medium',
  source: 'page.html:1',
  verification: 'Needs verification',
  ...d,
});

@Component({
  imports: [ChecklistView],
  template: `<app-checklist-view [cases]="cases()" storageKey="menu|tab" />`,
})
class Host {
  readonly cases = signal<TestCase[]>([
    tc('TC-001', 'Click "Save"', { priority: 'High' }),
    tc('TC-002', 'First Name is required', {
      category: 'Field validation',
      verification: 'Verified from source',
    }),
    tc('TC-003', 'Click "Cancel"'),
  ]);
}

describe('ChecklistView', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const count = (cls: string) => el.querySelector(`.count${cls} strong`)!.textContent;
    const ids = () => [...el.querySelectorAll('.cases .id')].map((td) => td.textContent);
    const statusBtn = (row: number, status: string) =>
      el.querySelector<HTMLButtonElement>(
        `.cases .case:nth-child(${row}) .status-btn[data-status="${status}"]`,
      )!;
    return { fixture, el, settle, count, ids, statusBtn };
  }

  it('records status and comments, and toggles a status off', async () => {
    const { el, settle, count, statusBtn } = await setup();
    expect(count('')).toBe('3');

    statusBtn(1, 'Pass').click();
    statusBtn(2, 'Fail').click();
    await settle();
    expect([count('.pass'), count('.fail'), count('')]).toEqual(['1', '1', '1']);
    expect(el.textContent).toContain('67% tested');

    statusBtn(1, 'Pass').click();
    await settle();
    expect(count('.pass')).toBe('0');

    const comment = el.querySelector<HTMLTextAreaElement>('.cases .case:nth-child(2) textarea')!;
    comment.value = 'Message not shown';
    comment.dispatchEvent(new Event('input'));
    await settle();
    const saved = JSON.parse(localStorage.getItem('registry-auto-test.checklist.menu|tab')!);
    expect(saved['PageComponent|First Name is required']).toEqual({
      status: 'Fail',
      comment: 'Message not shown',
    });
  });

  it('keeps results when the cases are regenerated with new ids', async () => {
    const { fixture, settle, statusBtn } = await setup();
    statusBtn(3, 'Blocked').click();
    await settle();

    fixture.componentInstance.cases.set([tc('TC-001', 'Click "Cancel"')]);
    await settle();
    expect(statusBtn(1, 'Blocked').classList).toContain('on');
  });

  it('filters by search text and category', async () => {
    const { el, settle, ids } = await setup();
    const search = el.querySelector<HTMLInputElement>('.search input')!;
    search.value = 'cancel';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(ids()).toEqual(['TC-003']);
    expect(el.querySelector('.showing')!.textContent).toContain('Showing 1 of 3');

    el.querySelector<HTMLButtonElement>('.showing .link')!.click();
    await settle();
    el.querySelector<HTMLButtonElement>('#filter-category')!.click();
    await settle();
    [...el.querySelectorAll<HTMLElement>('[role=option]')]
      .find((o) => o.textContent!.trim() === 'Field validation')!
      .click();
    await settle();
    expect(ids()).toEqual(['TC-002']);
  });

  it('shows Playwright results and uses them until a status is set by hand', async () => {
    TestBed.inject(RegistryNavService).e2e.set({
      runAt: '2026-10-31T06:30:00.000Z',
      status: 'failed',
      results: [
        {
          component: 'PageComponent',
          title: 'Click "Save"',
          status: 'failed',
          duration: 7400,
          error: 'expect(locator).toBeVisible() failed',
          notes: ['Error shown: Invalid email or password.'],
          screenshots: ['e2e-shots/save-0.png'],
        },
      ],
    });
    const { el, settle, count, statusBtn } = await setup();
    await settle();

    expect(el.querySelector('.e2e-run')!.textContent).toContain('1 of 3 cases');
    const card = el.querySelector('.cases .case:nth-child(1)')!;
    expect(card.querySelector('.e2e')!.textContent).toContain('Playwright: failed');
    expect(card.querySelector('.e2e')!.textContent).toContain('Invalid email or password.');
    expect(card.querySelector<HTMLImageElement>('.shots img')!.getAttribute('src')).toBe(
      'e2e-shots/save-0.png',
    );
    expect(statusBtn(1, 'Fail').classList).toContain('on');
    expect(count('.fail')).toBe('1');

    statusBtn(1, 'Pass').click();
    await settle();
    expect(statusBtn(1, 'Pass').classList).toContain('on');
    expect(card.querySelector('.e2e')!.textContent).not.toContain('sets the status');
  });
});
