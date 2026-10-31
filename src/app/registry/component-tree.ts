import { RegistryComponent, RegistryRoute } from './registry-nav.model';

export interface ComponentRow {
  key: string;
  component: RegistryComponent;
  /** 0 for the route component, 1 for its direct children, … */
  level: number;
  viaDialog: boolean;
}

export interface ComponentTree {
  /** Depth-first order, so each row sits under its parent. */
  rows: ComponentRow[];
  /** Number of components at each level: levelCounts[0] is the route component(s). */
  levelCounts: number[];
}

/**
 * The project components reachable from the given routes' components. A component reached
 * along several paths is listed once, at the shallowest level it appears.
 */
export function buildComponentTree(
  routes: RegistryRoute[],
  components: Record<string, RegistryComponent>,
): ComponentTree {
  const roots = [
    ...new Set(routes.map((r) => `${r.componentFile}#${r.component}`).filter((k) => components[k])),
  ];

  // Breadth-first, so every component is attached at its shallowest level.
  const childrenOf = new Map<string, Array<{ key: string; viaDialog: boolean }>>();
  const levelOf = new Map<string, number>(roots.map((k) => [k, 0]));
  let frontier = roots;
  for (let level = 1; frontier.length; level++) {
    const next: string[] = [];
    for (const parent of frontier) {
      const c = components[parent];
      const links = [
        ...c.children.map((key) => ({ key, viaDialog: false })),
        ...c.dialogs.map((key) => ({ key, viaDialog: true })),
      ];
      for (const link of links) {
        if (!components[link.key] || levelOf.has(link.key)) continue;
        levelOf.set(link.key, level);
        childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), link]);
        next.push(link.key);
      }
    }
    frontier = next;
  }

  const rows: ComponentRow[] = [];
  const visit = (key: string, viaDialog: boolean): void => {
    rows.push({ key, component: components[key], level: levelOf.get(key)!, viaDialog });
    for (const child of childrenOf.get(key) ?? []) visit(child.key, child.viaDialog);
  };
  roots.forEach((k) => visit(k, false));

  const levelCounts: number[] = [];
  for (const level of levelOf.values()) levelCounts[level] = (levelCounts[level] ?? 0) + 1;
  return { rows, levelCounts };
}
