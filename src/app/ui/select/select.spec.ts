import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Select, SelectGroup } from './select';

@Component({
  imports: [Select],
  template: `
    <app-select triggerId="pick" placeholder="Pick one…" [groups]="groups" [(value)]="value" />
    <p class="outside">outside</p>
  `,
})
class Host {
  readonly groups: SelectGroup[] = [
    {
      label: 'Staff',
      options: [
        { value: 'pm', label: 'Patient Management', selectedLabel: 'Staff › Patient Management' },
        { value: 'tm', label: 'Tissue Management' },
      ],
    },
    { label: 'Patient', options: [{ value: 'mp', label: 'My Profile' }] },
  ];
  readonly value = signal('');
}

describe('Select', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const trigger = el.querySelector<HTMLButtonElement>('#pick')!;
    const options = () =>
      [...el.querySelectorAll('[role=option]')].map((o) => o.textContent?.trim());
    const key = async (target: Element, k: string) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      await settle();
    };
    return { fixture, el, settle, trigger, options, key };
  }

  it('shows the placeholder, then the selected label', async () => {
    const { el, fixture, settle, trigger } = await setup();
    expect(trigger.textContent).toContain('Pick one…');

    trigger.click();
    await settle();
    expect([...el.querySelectorAll('.group-label')].map((g) => g.textContent)).toEqual([
      'Staff',
      'Patient',
    ]);
    el.querySelector<HTMLElement>('[role=option]')!.click();
    await settle();

    expect(fixture.componentInstance.value()).toBe('pm');
    expect(trigger.textContent).toContain('Staff › Patient Management');
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });

  it('filters by option text or group heading', async () => {
    const { el, settle, trigger, options } = await setup();
    trigger.click();
    await settle();
    const search = el.querySelector<HTMLInputElement>('.search input')!;

    search.value = 'tissue';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(options()).toEqual(['Tissue Management']);

    search.value = 'patient';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(options()).toEqual(['Patient Management', 'My Profile']);

    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(el.querySelector('.empty')?.textContent).toContain('No matches');
  });

  it('supports the keyboard', async () => {
    const { el, fixture, trigger, key } = await setup();
    await key(trigger, 'ArrowDown');
    const popup = el.querySelector('.popup')!;
    expect(popup).toBeTruthy();

    await key(popup, 'ArrowDown');
    await key(popup, 'ArrowDown');
    expect(el.querySelector('.option.active')?.textContent).toContain('My Profile');
    await key(popup, 'Enter');
    expect(fixture.componentInstance.value()).toBe('mp');

    await key(trigger, 'ArrowDown');
    await key(el.querySelector('.popup')!, 'Escape');
    expect(el.querySelector('.popup')).toBeNull();
    expect(fixture.componentInstance.value()).toBe('mp');
  });

  it('closes on a click outside', async () => {
    const { el, settle, trigger } = await setup();
    trigger.click();
    await settle();
    el.querySelector<HTMLElement>('.outside')!.click();
    await settle();
    expect(el.querySelector('.popup')).toBeNull();
  });
});
