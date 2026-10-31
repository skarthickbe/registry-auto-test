import { Component, inject, signal } from '@angular/core';

import { NavPanel } from './registry/nav-panel/nav-panel';
import { NavMenu, TabSelection } from './registry/registry-nav.model';
import { RegistryNavService } from './registry/registry-nav.service';

@Component({
  selector: 'app-root',
  imports: [NavPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly registry = inject(RegistryNavService);
  protected readonly selection = signal<TabSelection | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected onSelectionChange(selection: TabSelection | null): void {
    this.selection.set(selection);
    this.notice.set(null);
  }

  protected onGenerate(selection: TabSelection): void {
    this.notice.set(`Checklist generation for "${selection.tab.title}" is not built yet.`);
  }

  protected onUnusedCode(menu: NavMenu | null): void {
    this.notice.set(`Unused code report${menu ? ` for "${menu.label}"` : ''} is not built yet.`);
  }
}
