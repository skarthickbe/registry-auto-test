// Scans the Registry App's Angular routes and navigation seed SQL and writes
// the menu/tab model the UI loads (registry.config.json → output).
//
//   node scripts/scan-registry.mjs           scan once
//   node scripts/scan-registry.mjs --watch   rescan whenever a source file changes

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.config.json'), 'utf8'));
const APP = path.resolve(ROOT, config.appPath);
const SRC = path.join(APP, 'src');
const NAV_SQL = config.navSqlPath ? path.resolve(ROOT, config.navSqlPath) : undefined;
const OUTPUT = path.resolve(ROOT, config.output);
// Vendored libraries inside the app (e.g. the Fuse template) are not the team's own components.
const EXCLUDE_COMPONENT_DIRS = (config.excludeComponentDirs ?? []).map((d) => path.resolve(APP, d) + path.sep);

const rel = (file) => path.relative(APP, file);

// ---------------------------------------------------------------------------
// Project index: lazily parsed source files, import resolution, constant lookup
// ---------------------------------------------------------------------------

class ProjectIndex {
  constructor(srcDir) {
    this.srcDir = srcDir;
    this.files = new Map();
  }

  /** Where an identifier used in `file` is imported from: { file, exportName }. */
  importOf(file, name) {
    const sf = this.getSourceFile(file);
    if (!sf) return undefined;
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const clause = stmt.importClause;
      let exportName;
      if (clause.name?.text === name) exportName = 'default';
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const el = bindings.elements.find((e) => e.name.text === name);
        if (el) exportName = (el.propertyName ?? el.name).text;
      }
      if (exportName) {
        const target = this.resolveImport(file, stmt.moduleSpecifier.text);
        return target ? { file: target, exportName } : undefined;
      }
    }
    return undefined;
  }

  /** Resolves './x' relative to the importing file and 'app/x' against src/ (tsconfig baseUrl). */
  resolveImport(fromFile, spec) {
    const base = spec.startsWith('.') ? path.resolve(path.dirname(fromFile), spec) : path.join(this.srcDir, spec);
    for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
      if (candidate.endsWith('.ts') && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return undefined;
  }

  /** Initializer of a top-level `const name = ...` declared in or imported into `file`. */
  lookupConst(file, name, depth = 0) {
    const sf = this.getSourceFile(file);
    if (!sf || depth > 8) return undefined;
    for (const stmt of sf.statements) {
      if (name === 'default' && ts.isExportAssignment(stmt)) return { expr: stmt.expression, file };
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) return { expr: decl.initializer, file };
      }
    }
    const imp = this.importOf(file, name);
    return imp ? this.lookupConst(imp.file, imp.exportName, depth + 1) : undefined;
  }

  /** Best-effort string value of an expression (literals, consts, enums, concatenation). */
  evalString(expr, file, depth = 0) {
    const e = unwrap(expr);
    if (depth > 8) return e.getText();
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isNumericLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      return e.head.text + e.templateSpans.map((s) => this.evalString(s.expression, file, depth + 1) + s.literal.text).join('');
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return this.evalString(e.left, file, depth + 1) + this.evalString(e.right, file, depth + 1);
    }
    if (ts.isIdentifier(e)) {
      const found = this.lookupConst(file, e.text);
      return found ? this.evalString(found.expr, found.file, depth + 1) : e.text;
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const en = this.findDeclaration(file, e.expression.text, ts.isEnumDeclaration);
      const member = en?.node.members.find((m) => m.name.getText() === e.name.text);
      if (member?.initializer) return this.evalString(member.initializer, en.file, depth + 1);
    }
    return e.getText();
  }

  findDeclaration(file, name, kind, depth = 0) {
    const sf = this.getSourceFile(file);
    if (!sf || depth > 8) return undefined;
    const node = sf.statements.find((s) => kind(s) && s.name?.text === name);
    if (node) return { node, file };
    const imp = this.importOf(file, name);
    return imp ? this.findDeclaration(imp.file, imp.exportName, kind, depth + 1) : undefined;
  }

  resolveClassFile(file, name) {
    return this.findDeclaration(file, name, ts.isClassDeclaration)?.file;
  }

  defaultExportClass(file) {
    const sf = this.getSourceFile(file);
    if (!sf) return undefined;
    for (const stmt of sf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return stmt.name?.text;
      if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) return stmt.expression.text;
    }
    return undefined;
  }

  getSourceFile(file) {
    if (!this.files.has(file)) {
      let sf;
      try {
        sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      } catch {
        sf = undefined;
      }
      this.files.set(file, sf);
    }
    return this.files.get(file);
  }

  lineOf(node) {
    return node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }
}

function unwrap(expr) {
  let e = expr;
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression?.(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

function getProperty(obj, name) {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propName(p.name) === name) return p.initializer;
  }
  return undefined;
}

function propName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route discovery
// ---------------------------------------------------------------------------

function joinRoutePath(parent, child) {
  return `/${[...parent.split('/'), ...child.split('/')].filter(Boolean).join('/')}`;
}

function discoverRoutes(index) {
  const routes = [];
  const warnings = [];
  const visited = new Set();

  /** A route array written inline (`[...]`) or referenced through a const. */
  const resolveArray = (expr, file) => {
    const e = unwrap(expr);
    if (ts.isArrayLiteralExpression(e)) return { arr: e, file };
    if (ts.isIdentifier(e)) {
      const found = index.lookupConst(file, e.text);
      if (found) return resolveArray(found.expr, found.file);
    }
    return undefined;
  };

  /** NgModule style: RouterModule.forChild(routes) / forRoot(routes). */
  const forChildArray = (node, file) => {
    let found;
    const visit = (n) => {
      if (found) return;
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^for(Child|Root)$/.test(n.expression.name.text) && n.arguments[0]) {
        found = resolveArray(n.arguments[0], file);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };

  /** The routes a lazily loaded file exports: `export default [...]`, `export const x: Routes`, or forChild(). */
  const exportedRoutes = (file, member) => {
    const sf = index.getSourceFile(file);
    if (!sf) return undefined;
    if (member) {
      const found = index.lookupConst(file, member);
      return found ? resolveArray(found.expr, found.file) : forChildArray(sf, file);
    }
    for (const stmt of sf.statements) {
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        const resolved = resolveArray(stmt.expression, file);
        if (resolved) return resolved;
      }
    }
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt) || !stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && decl.type && /\bRoutes?\b/.test(decl.type.getText(sf))) {
          const resolved = resolveArray(decl.initializer, file);
          if (resolved) return resolved;
        }
      }
    }
    return forChildArray(sf, file);
  };

  /** `() => import('./x').then((m) => m.Y)` → { spec: './x', member: 'Y', file }. */
  const dynamicImport = (expr, file) => {
    let spec;
    let member;
    const visit = (n) => {
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        spec = n.arguments[0].text;
      }
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.parent && ts.isArrowFunction(n.parent) && n.parent.body === n) {
        member = n.name.text;
      }
      ts.forEachChild(n, visit);
    };
    visit(expr);
    return { spec, member, file: spec ? index.resolveImport(file, spec) : undefined };
  };

  const walk = ({ arr, file }, parentPath, parents, depth) => {
    const key = `${file}:${arr.pos}|${parentPath}`;
    if (depth > 12 || visited.has(key)) return;
    visited.add(key);
    for (const element of arr.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = resolveArray(element.expression, file);
        if (spread) walk(spread, parentPath, parents, depth + 1);
        continue;
      }
      let obj = unwrap(element);
      let objFile = file;
      if (ts.isIdentifier(obj)) {
        const found = index.lookupConst(file, obj.text);
        if (!found) continue;
        obj = unwrap(found.expr);
        objFile = found.file;
      }
      if (!ts.isObjectLiteralExpression(obj)) continue;

      const pathExpr = getProperty(obj, 'path');
      const fullPath = joinRoutePath(parentPath, pathExpr ? index.evalString(pathExpr, objFile) : '');
      let component;
      let componentFile;

      const componentExpr = getProperty(obj, 'component');
      if (componentExpr && ts.isIdentifier(unwrap(componentExpr))) {
        component = unwrap(componentExpr).text;
        componentFile = index.resolveClassFile(objFile, component);
      }
      const loadComponent = getProperty(obj, 'loadComponent');
      if (loadComponent) {
        const imp = dynamicImport(loadComponent, objFile);
        if (imp.file) {
          component = imp.member ?? index.defaultExportClass(imp.file);
          componentFile = imp.file;
        } else if (imp.spec) {
          warnings.push(`Could not resolve loadComponent import '${imp.spec}' in ${rel(objFile)}`);
        }
      }
      const redirectExpr = getProperty(obj, 'redirectTo');
      const redirectTo = redirectExpr ? index.evalString(redirectExpr, objFile) : undefined;

      // Pure grouping entries (only children / loadChildren) are not routes of their own.
      if (component || redirectTo !== undefined) {
        routes.push({
          id: `r${routes.length + 1}`,
          path: fullPath,
          component,
          componentFile: componentFile ? rel(componentFile) : undefined,
          parents,
          redirectTo,
          definedIn: { file: rel(objFile), line: index.lineOf(obj) },
        });
      }

      const childParents = component ? [...parents, component] : parents;
      const children = getProperty(obj, 'children');
      if (children) {
        const childArr = resolveArray(children, objFile);
        if (childArr) walk(childArr, fullPath, childParents, depth + 1);
      }
      const loadChildren = getProperty(obj, 'loadChildren');
      if (loadChildren) {
        const imp = dynamicImport(loadChildren, objFile);
        const childArr = imp.file ? exportedRoutes(imp.file, imp.member) : undefined;
        if (childArr) walk(childArr, fullPath, childParents, depth + 1);
        else warnings.push(`Could not load child routes '${imp.spec ?? loadChildren.getText()}' in ${rel(objFile)}`);
      }
    }
  };

  const root = findRootRoutes(index, resolveArray, exportedRoutes);
  if (!root) {
    warnings.push('No root route configuration found (looked for provideRouter(), RouterModule.forRoot() and app.routes.ts).');
    return { routes, warnings };
  }
  walk(root, '', [], 0);
  return { routes, rootFile: rel(root.file), warnings };
}

/** The array passed to provideRouter() / RouterModule.forRoot(), falling back to app.routes.ts. */
function findRootRoutes(index, resolveArray, exportedRoutes) {
  const files = walkFiles(index.srcDir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/provideRouter\s*\(|RouterModule\.forRoot\s*\(/.test(text)) continue;
    const sf = index.getSourceFile(file);
    let result;
    const visit = (n) => {
      if (result) return;
      if (ts.isCallExpression(n) && n.arguments[0] && /^(provideRouter|RouterModule\.forRoot)$/.test(n.expression.getText())) {
        const arg = unwrap(n.arguments[0]);
        if (ts.isIdentifier(arg)) {
          const found = index.lookupConst(file, arg.text);
          result = found ? resolveArray(found.expr, found.file) : undefined;
        } else {
          result = resolveArray(arg, file);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (result) return result;
  }
  const fallback = files.find((f) => /^(app\.routes|app-routing\.module)\.ts$/.test(path.basename(f)));
  return fallback ? exportedRoutes(fallback) : undefined;
}

// ---------------------------------------------------------------------------
// Component tree: which project components each component renders or opens
// ---------------------------------------------------------------------------

/** Element and attribute names a selector such as 'app-card, [appTooltip]' matches. */
function selectorTargets(selector) {
  const tags = [];
  const attrs = [];
  for (const part of selector.split(',').map((s) => s.trim())) {
    const tag = /^[a-zA-Z][\w-]*/.exec(part)?.[0];
    const attr = /^\[([\w-]+)/.exec(part)?.[1];
    if (tag) tags.push(tag.toLowerCase());
    else if (attr) attrs.push(attr.toLowerCase());
  }
  return { tags, attrs };
}

function discoverComponents(index) {
  const found = [];
  for (const file of walkFiles(index.srcDir)) {
    if (EXCLUDE_COMPONENT_DIRS.some((dir) => file.startsWith(dir))) continue;
    if (!fs.readFileSync(file, 'utf8').includes('@Component')) continue;
    const sf = index.getSourceFile(file);
    for (const cls of sf.statements) {
      if (!ts.isClassDeclaration(cls) || !cls.name) continue;
      const decorator = (ts.getDecorators(cls) ?? []).find((d) => ts.isCallExpression(d.expression) && d.expression.expression.getText() === 'Component');
      const meta = decorator?.expression.arguments[0];
      if (!meta || !ts.isObjectLiteralExpression(meta)) continue;
      const selectorExpr = getProperty(meta, 'selector');
      const templateUrl = getProperty(meta, 'templateUrl');
      const inline = getProperty(meta, 'template');
      let template = '';
      if (templateUrl) {
        try {
          template = fs.readFileSync(path.resolve(path.dirname(file), index.evalString(templateUrl, file)), 'utf8');
        } catch {
          // Missing template file: the component simply has no template children.
        }
      } else if (inline) {
        template = index.evalString(inline, file);
      }
      found.push({
        key: `${rel(file)}#${cls.name.text}`,
        file,
        cls,
        name: cls.name.text,
        selector: selectorExpr ? index.evalString(selectorExpr, file) : undefined,
        template: template.replace(/<!--[\s\S]*?-->/g, ''),
      });
    }
  }

  const byTag = new Map();
  const byAttr = new Map();
  const byFileAndName = new Map(found.map((c) => [`${c.file}#${c.name}`, c.key]));
  for (const c of found) {
    if (!c.selector) continue;
    const { tags, attrs } = selectorTargets(c.selector);
    for (const t of tags) if (!byTag.has(t)) byTag.set(t, c.key);
    for (const a of attrs) if (!byAttr.has(a)) byAttr.set(a, c.key);
  }

  const components = {};
  for (const c of found) {
    const children = new Set();
    const dialogs = new Set();
    // <app-card ...> in the template
    for (const m of c.template.matchAll(/<([a-zA-Z][\w-]*)/g)) {
      const key = byTag.get(m[1].toLowerCase());
      if (key) children.add(key);
    }
    // <div appTooltip ...> for attribute selectors
    for (const [attr, key] of byAttr) {
      if (new RegExp(`[\\s\\[]${attr}[\\s=\\]>/]`, 'i').test(c.template)) children.add(key);
    }
    // this.dialog.open(AddTumorComponent, ...) in the class
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'open') {
        const arg = n.arguments[0];
        if (arg && ts.isIdentifier(arg)) {
          const targetFile = index.resolveClassFile(c.file, arg.text);
          const key = targetFile && byFileAndName.get(`${targetFile}#${arg.text}`);
          if (key) dialogs.add(key);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(c.cls);
    children.delete(c.key);
    dialogs.delete(c.key);
    components[c.key] = {
      name: c.name,
      file: rel(c.file),
      selector: c.selector,
      children: [...children],
      dialogs: [...dialogs].filter((k) => !children.has(k)),
    };
  }
  return components;
}

// ---------------------------------------------------------------------------
// Navigation seed SQL (navigation_page / navigation_subpage)
// ---------------------------------------------------------------------------

/** Removes comments while keeping line breaks, so line numbers stay correct. */
function stripSqlComments(sql) {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inString) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") out += sql[++i];
        else inString = false;
      }
    } else if (c === "'") {
      inString = true;
      out += c;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      out += sql.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** Splits on top-level `;` and records each statement's starting line. */
function splitStatements(sql) {
  const out = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  let line = 1;
  let startLine = 1;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === '\n') line++;
    if (inString) {
      if (c === "'") {
        if (sql[i + 1] === "'") i++;
        else inString = false;
      }
      continue;
    }
    if (c === "'") inString = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth <= 0) {
      const text = sql.slice(start, i);
      const lead = text.length - text.trimStart().length;
      out.push({ text: text.trim(), line: startLine + (text.slice(0, lead).match(/\n/g)?.length ?? 0) });
      start = i + 1;
      startLine = line;
    }
  }
  return out;
}

/** One SQL value: 'text', number, null, true/false, or (SELECT id FROM x WHERE col = 'v'). */
function parseValue(raw) {
  const v = raw.trim();
  if (/^'.*'$/s.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^null$/i.test(v)) return null;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^\(\s*select\b/i.test(v)) {
    const where = {};
    const re = /(\w+)\s*=\s*(?:'((?:[^']|'')*)'|(-?\d+))/g;
    let m;
    while ((m = re.exec(v))) where[m[1].toLowerCase()] = (m[2] ?? m[3]).replace(/''/g, "'");
    return { where };
  }
  return v;
}

/** The `(...), (...)` rows after VALUES, split into raw column values. */
function parseTuples(text, startLine) {
  const tuples = [];
  let i = 0;
  let line = startLine;
  while (i < text.length) {
    if (text[i] === '\n') line++;
    if (text[i] !== '(') {
      i++;
      continue;
    }
    const tupleLine = line;
    const values = [];
    let depth = 0;
    let inString = false;
    let current = '';
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') line++;
      if (inString) {
        current += ch;
        if (ch === "'") {
          if (text[i + 1] === "'") current += text[++i];
          else inString = false;
        }
        continue;
      }
      if (ch === "'") {
        inString = true;
        current += ch;
      } else if (ch === '(') {
        if (depth > 0) current += ch;
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) {
          values.push(current);
          i++;
          break;
        }
        current += ch;
      } else if (ch === ',' && depth === 1) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    tuples.push({ values, line: tupleLine });
  }
  return tuples;
}

const asString = (v) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));
const whereValue = (v, key) => (v && typeof v === 'object' ? v.where[key] : undefined);

function parseNavSql(file) {
  const sql = stripSqlComments(fs.readFileSync(file, 'utf8'));
  const tables = new Map();
  for (const stmt of splitStatements(sql)) {
    const insert = /^INSERT\s+INTO\s+([\w."]+)\s*\(([^)]*)\)\s*VALUES\s*/i.exec(stmt.text);
    if (insert) {
      const table = insert[1].replace(/"/g, '').split('.').pop().toLowerCase();
      const columns = insert[2].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
      const tupleLine = stmt.line + (insert[0].match(/\n/g)?.length ?? 0);
      const rows = tables.get(table) ?? [];
      for (const tuple of parseTuples(stmt.text.slice(insert[0].length), tupleLine)) {
        const values = {};
        columns.forEach((col, i) => (values[col] = parseValue(tuple.values[i] ?? 'null')));
        rows.push({ values, line: tuple.line });
      }
      tables.set(table, rows);
      continue;
    }
    // e.g. UPDATE navigation_subpage SET group_key = 'My Treatments' WHERE subpage_id IN (108, 109, 110)
    const update = /^UPDATE\s+([\w."]+)\s+SET\s+(\w+)\s*=\s*'((?:[^']|'')*)'\s+WHERE\s+(\w+)\s+(?:IN\s*\(([^)]*)\)|=\s*'?([^'\s]+)'?)/i.exec(stmt.text);
    if (update) {
      const table = update[1].replace(/"/g, '').split('.').pop().toLowerCase();
      const targets = (update[5] ?? update[6] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''));
      for (const row of tables.get(table) ?? []) {
        if (targets.includes(asString(row.values[update[4].toLowerCase()]))) row.values[update[2].toLowerCase()] = update[3].replace(/''/g, "'");
      }
    }
  }
  const pages = (tables.get('navigation_page') ?? []).map((row) => ({
    title: asString(row.values.title),
    link: asString(row.values.link),
    audience: whereValue(row.values.user_type_id, 'type'),
    order: Number(asString(row.values.page_order)) || 0,
    description: asString(row.values.description) || undefined,
    line: row.line,
  }));
  const subpages = (tables.get('navigation_subpage') ?? []).map((row) => ({
    title: asString(row.values.title),
    link: asString(row.values.link),
    pageTitle: whereValue(row.values.page_id_id ?? row.values.page_id, 'title') ?? '',
    subpageId: asString(row.values.subpage_id) || undefined,
    groupKey: asString(row.values.group_key) || undefined,
    order: Number(asString(row.values.page_order)) || 0,
    description: asString(row.values.description) || undefined,
    line: row.line,
  }));
  return { pages, subpages };
}

// ---------------------------------------------------------------------------
// Menus and tabs
// ---------------------------------------------------------------------------

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const normalizeLink = (link) => `/${link.split(/[?#]/)[0].split('/').filter(Boolean).join('/')}`;

function pathMatches(routePath, link) {
  const r = routePath.split('/').filter(Boolean);
  const l = link.split('/').filter(Boolean);
  return r.length === l.length && r.every((seg, i) => seg === l[i] || seg.startsWith(':') || l[i].startsWith(':'));
}

function buildMenus(routes, nav) {
  const componentRoutes = routes.filter((r) => r.component);
  const menus = [];
  const mapped = new Set();

  const mapLink = (link) => {
    if (!link) return { routes: [], note: 'Navigation entry has no link.' };
    const target = normalizeLink(link);
    const exact = componentRoutes.filter((r) => r.path === target);
    if (exact.length) return { routes: exact, note: `Matched link ${link} exactly.` };
    const pattern = componentRoutes.filter((r) => pathMatches(r.path, target));
    if (pattern.length) return { routes: pattern, note: `Matched link ${link} to a parameterised route.` };
    const redirect = routes.find((r) => r.path === target && r.redirectTo !== undefined);
    if (redirect) {
      const to = normalizeLink(redirect.redirectTo.startsWith('/') ? redirect.redirectTo : `${target}/${redirect.redirectTo}`);
      const hit = componentRoutes.filter((r) => r.path === to);
      if (hit.length) return { routes: hit, note: `Link ${link} redirects to ${to}.` };
    }
    const withParam = componentRoutes.filter((r) => r.path.startsWith(`${target}/:`) && r.path.split('/').length === target.split('/').length + 1);
    if (withParam.length) return { routes: withParam, note: `Link ${link} matched a route that adds a parameter.` };
    return { routes: [], note: `No Angular route matches link ${link}.` };
  };

  // A subpage id is the last segment of a parameterised route, e.g. 104 → /staff/patient/details/:id/104
  const mapSubpage = (pageLink, sub) => {
    if (sub.subpageId) {
      const byId = componentRoutes.filter((r) => {
        const segs = r.path.split('/').filter(Boolean);
        return segs[segs.length - 1] === sub.subpageId && segs.some((s) => s.startsWith(':'));
      });
      if (byId.length) {
        const first = pageLink.split('/').filter(Boolean)[0];
        const preferred = byId.filter((r) => r.path.split('/').filter(Boolean)[0] === first);
        return { routes: preferred.length ? preferred : byId, note: `Matched by subpage id ${sub.subpageId}.` };
      }
    }
    if (sub.link) return mapLink(sub.link);
    return { routes: [], note: `No Angular route found for subpage id ${sub.subpageId ?? '(none)'}.` };
  };

  const tab = (id, title, section, link, mapping, line, description) => {
    mapping.routes.forEach((r) => mapped.add(r.id));
    return { id, title, section, link: link || undefined, description, routes: mapping.routes.map((r) => r.id), note: mapping.note, navLine: line };
  };

  if (nav) {
    const audiences = [...new Set(nav.pages.map((p) => p.audience ?? 'Other'))].sort((a, b) => (b === 'Staff') - (a === 'Staff') || a.localeCompare(b));
    for (const audience of audiences) {
      const pages = nav.pages.filter((p) => (p.audience ?? 'Other') === audience).sort((a, b) => a.order - b.order);
      const mainTabs = [];
      const pageMenus = [];
      for (const page of pages) {
        const subs = nav.subpages.filter((s) => s.pageTitle === page.title).sort((a, b) => a.order - b.order);
        if (!subs.length) {
          mainTabs.push(tab(`nav:${slug(audience)}:${slug(page.title)}`, page.title, undefined, page.link, mapLink(page.link), page.line, page.description));
          continue;
        }
        const keys = [...new Set(subs.map((s) => s.groupKey).filter(Boolean))];
        const rank = (k) => (k ? keys.indexOf(k) : 999);
        subs.sort((a, b) => rank(a.groupKey) - rank(b.groupKey) || a.order - b.order);
        pageMenus.push({
          id: `nav:${slug(audience)}:${slug(page.title)}`,
          label: `${audience} › ${page.title}`,
          audience,
          confirmed: true,
          tabs: subs.map((s) =>
            tab(`nav:${slug(audience)}:${slug(page.title)}:${slug(s.title)}:${s.subpageId ?? ''}`, s.title, s.groupKey, s.link, mapSubpage(page.link, s), s.line, s.description),
          ),
        });
      }
      if (mainTabs.length) menus.push({ id: `nav:${slug(audience)}:main`, label: `${audience} › Main Menu`, audience, confirmed: true, tabs: mainTabs });
      menus.push(...pageMenus);
    }
  }

  // Routes that no navigation entry points at, grouped by their first two static path segments.
  const other = new Map();
  for (const route of componentRoutes) {
    if (mapped.has(route.id)) continue;
    const segs = route.path.split('/').filter(Boolean);
    const stat = segs.slice(0, segs.length > 1 ? 2 : 1).filter((s) => !s.startsWith(':'));
    const first = stat.length ? stat.join('/') : '(root)';
    const list = other.get(first) ?? [];
    list.push({ id: `route:${route.id}`, title: `${route.path} → ${route.component}`, link: route.path, routes: [route.id], note: 'Route only: no navigation entry confirms it is a visible tab.' });
    other.set(first, list);
  }
  for (const [first, tabs] of [...other.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    menus.push({ id: `route:${first}`, label: `Other Routes › /${first}`, audience: 'Other', confirmed: false, tabs });
  }
  return menus;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function scan() {
  const index = new ProjectIndex(SRC);
  const { routes, rootFile, warnings } = discoverRoutes(index);
  let nav;
  if (NAV_SQL && fs.existsSync(NAV_SQL)) nav = parseNavSql(NAV_SQL);
  else warnings.push(`Navigation SQL not found (${config.navSqlPath}); only route-based menus are listed.`);
  return {
    generatedAt: new Date().toISOString(),
    source: { appPath: APP, rootFile, navSql: nav ? NAV_SQL : undefined },
    warnings,
    routes,
    components: discoverComponents(index),
    menus: buildMenus(routes, nav),
  };
}

let lastBody = '';
function scanAndWrite() {
  const started = Date.now();
  const result = scan();
  // Skip the write when nothing but the timestamp changed.
  const body = JSON.stringify({ ...result, generatedAt: undefined });
  if (body === lastBody) return;
  lastBody = body;
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  const confirmed = result.menus.filter((m) => m.confirmed).length;
  console.log(
    `[scan-registry] ${result.routes.length} routes, ${Object.keys(result.components).length} components, ${confirmed} menus (+${result.menus.length - confirmed} other) → ${path.relative(ROOT, OUTPUT)} in ${Date.now() - started} ms`,
  );
  for (const w of result.warnings) console.warn(`[scan-registry] warning: ${w}`);
}

if (!fs.existsSync(SRC)) {
  console.error(`[scan-registry] Registry App source not found at ${SRC}. Check appPath in registry.config.json.`);
  process.exit(1);
}

scanAndWrite();

if (process.argv.includes('--watch')) {
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        scanAndWrite();
      } catch (e) {
        console.error(`[scan-registry] scan failed: ${e.message}`);
      }
    }, 300);
  };
  fs.watch(SRC, { recursive: true }, (_event, file) => file?.endsWith('.ts') && schedule());
  if (NAV_SQL && fs.existsSync(NAV_SQL)) fs.watch(NAV_SQL, schedule);
  console.log(`[scan-registry] watching ${SRC}`);
}
