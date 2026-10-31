import { buildComponentTree } from './component-tree';
import { RegistryComponent, RegistryRoute } from './registry-nav.model';

const comp = (
  name: string,
  children: string[] = [],
  dialogs: string[] = [],
): RegistryComponent => ({
  name,
  file: `${name}.ts`,
  children,
  dialogs,
  details: { fields: [], buttons: [], tables: 0, repeats: 0, paginator: false, sort: false },
});

// Page → [Card, Form] + dialog Edit; Form → [Card, Input]; Edit → [Form, Page] (cycle back)
const COMPONENTS: Record<string, RegistryComponent> = {
  'Page.ts#Page': comp('Page', ['Card.ts#Card', 'Form.ts#Form'], ['Edit.ts#Edit']),
  'Card.ts#Card': comp('Card'),
  'Form.ts#Form': comp('Form', ['Card.ts#Card', 'Input.ts#Input']),
  'Input.ts#Input': comp('Input'),
  'Edit.ts#Edit': comp('Edit', ['Form.ts#Form', 'Page.ts#Page']),
};

const route = (component: string): RegistryRoute => ({
  id: component,
  path: `/${component}`,
  component,
  componentFile: `${component}.ts`,
  parents: [],
  definedIn: { file: 'routes.ts', line: 1 },
});

describe('buildComponentTree', () => {
  it('lists each component once, at its shallowest level, in tree order', () => {
    const tree = buildComponentTree([route('Page')], COMPONENTS);

    expect(tree.rows.map((r) => `${'  '.repeat(r.level)}${r.component.name}`)).toEqual([
      'Page',
      '  Card',
      '  Form',
      '    Input',
      '  Edit',
    ]);
    expect(tree.rows.find((r) => r.component.name === 'Edit')?.viaDialog).toBe(true);
    expect(tree.levelCounts).toEqual([1, 3, 1]);
  });

  it('is empty when the route component is unknown', () => {
    expect(buildComponentTree([route('Missing')], COMPONENTS)).toEqual({
      rows: [],
      levelCounts: [],
    });
  });
});
