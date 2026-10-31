import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ComponentTree, buildComponentTree } from './component-tree';
import { E2eResults, E2eRunStatus, RegistryNav, RegistryRoute } from './registry-nav.model';

const POLL_MS = 1500;

@Injectable({ providedIn: 'root' })
export class RegistryNavService {
  private readonly http = inject(HttpClient);

  readonly nav = signal<RegistryNav | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Latest Playwright run, or null when `npm run e2e` has not been run. */
  readonly e2e = signal<E2eResults | null>(null);
  /** The Playwright run started from the UI, if any. */
  readonly e2eRun = signal<E2eRunStatus | null>(null);

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

  /** Starts Playwright through the local runner and refreshes results until the run ends. */
  async runE2e(): Promise<void> {
    try {
      this.e2eRun.set(await firstValueFrom(this.http.post<E2eRunStatus>('e2e-api/run', {})));
    } catch (e) {
      // 409: a run is already in progress, so just follow it.
      if (!(e instanceof HttpErrorResponse && e.status === 409)) {
        this.e2eRun.set({ state: 'unavailable' });
        return;
      }
    }
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      try {
        this.e2eRun.set(
          await firstValueFrom(this.http.get<E2eRunStatus>(`e2e-api/status?t=${Date.now()}`)),
        );
      } catch {
        this.e2eRun.set({ state: 'unavailable' });
        return;
      }
      await this.loadE2e();
      if (this.e2eRun()?.state !== 'running') return;
    }
  }

  async loadE2e(): Promise<void> {
    try {
      this.e2e.set(
        await firstValueFrom(this.http.get<E2eResults>(`e2e-api/results?t=${Date.now()}`)),
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
