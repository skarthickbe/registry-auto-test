import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ComponentTree, buildComponentTree } from './component-tree';
import { E2eResults, RegistryNav, RegistryRoute } from './registry-nav.model';

@Injectable({ providedIn: 'root' })
export class RegistryNavService {
  private readonly http = inject(HttpClient);

  readonly nav = signal<RegistryNav | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Latest Playwright run, or null when `npm run e2e` has not been run. */
  readonly e2e = signal<E2eResults | null>(null);

  private readonly routesById = computed(
    () => new Map((this.nav()?.routes ?? []).map((r) => [r.id, r] as const)),
  );

  /** Loads the latest scan. The scanner rewrites the file whenever the Registry App changes. */
  async load(): Promise<void> {
    void this.loadE2e();
    this.loading.set(true);
    this.error.set(null);
    try {
      this.nav.set(
        await firstValueFrom(this.http.get<RegistryNav>(`registry-nav.json?t=${Date.now()}`)),
      );
    } catch {
      this.error.set('Could not load registry-nav.json. Run "npm run scan" (or "npm start").');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadE2e(): Promise<void> {
    try {
      this.e2e.set(
        await firstValueFrom(this.http.get<E2eResults>(`e2e-results.json?t=${Date.now()}`)),
      );
    } catch {
      this.e2e.set(null);
    }
  }

  routes(ids: string[]): RegistryRoute[] {
    const byId = this.routesById();
    return ids.map((id) => byId.get(id)).filter((r): r is RegistryRoute => !!r);
  }

  /** Components rendered or opened (at any depth) by the components of the given routes. */
  componentTree(routeIds: string[]): ComponentTree {
    return buildComponentTree(this.routes(routeIds), this.nav()?.components ?? {});
  }
}
