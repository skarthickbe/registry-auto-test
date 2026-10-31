import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

export interface SelectOption {
  value: string;
  /** Text shown in the list. */
  label: string;
  /** Text shown on the closed trigger, when it should differ from `label`. */
  selectedLabel?: string;
}

export interface SelectGroup {
  label?: string;
  options: SelectOption[];
}

let nextId = 0;

/** A styled single-select dropdown with optional search, grouped options and keyboard support. */
@Component({
  selector: 'app-select',
  templateUrl: './select.html',
  styleUrl: './select.scss',
  host: {
    '[class.open]': 'open()',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class Select {
  readonly groups = input.required<SelectGroup[]>();
  readonly value = model('');
  readonly triggerId = input(`app-select-${nextId++}`);
  readonly placeholder = input('Select…');
  readonly disabled = input(false);
  readonly searchable = input(true);
  readonly searchPlaceholder = input('Search…');

  protected readonly listId = `app-select-list-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly selected = computed(() =>
    this.groups()
      .flatMap((g) => g.options)
      .find((o) => o.value === this.value()),
  );

  /** Groups whose heading or options match the search text. */
  protected readonly filtered = computed<SelectGroup[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.groups();
    return this.groups()
      .map((g) => ({
        label: g.label,
        options: g.label?.toLowerCase().includes(q)
          ? g.options
          : g.options.filter((o) => o.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.options.length);
  });

  protected readonly flat = computed(() => this.filtered().flatMap((g) => g.options));

  protected indexOf(option: SelectOption): number {
    return this.flat().indexOf(option);
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.openList();
  }

  protected close(focusTrigger = false): void {
    this.open.set(false);
    if (focusTrigger) this.trigger().nativeElement.focus();
  }

  protected choose(option: SelectOption): void {
    this.value.set(option.value);
    this.close(true);
  }

  protected onQuery(text: string): void {
    this.query.set(text);
    this.activeIndex.set(0);
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    if (!this.open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      this.openList();
    }
  }

  protected onPopupKey(event: KeyboardEvent): void {
    const count = this.flat().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (count) {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          this.activeIndex.set((this.activeIndex() + step + count) % count);
          this.scrollActiveIntoView();
        }
        break;
      case 'Enter': {
        event.preventDefault();
        const option = this.flat()[this.activeIndex()];
        if (option) this.choose(option);
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close(true);
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  private openList(): void {
    if (this.disabled()) return;
    this.query.set('');
    this.activeIndex.set(
      Math.max(
        0,
        this.flat().findIndex((o) => o.value === this.value()),
      ),
    );
    this.open.set(true);
    setTimeout(() => {
      (this.search() ?? this.list())?.nativeElement.focus();
      this.scrollActiveIntoView();
    });
  }

  private scrollActiveIntoView(): void {
    setTimeout(() =>
      this.list()
        ?.nativeElement.querySelector('.option.active')
        ?.scrollIntoView?.({ block: 'nearest' }),
    );
  }
}
