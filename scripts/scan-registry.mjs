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
