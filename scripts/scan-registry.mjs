// Scans the Registry App's Angular routes and navigation seed SQL and writes
// the menu/tab model the UI loads (registry.config.json → output).
//
//   node scripts/scan-registry.mjs           scan once
//   node scripts/scan-registry.mjs --watch   rescan whenever a source file changes
//   node scripts/scan-registry.mjs --debug   also log every lookup the scanner makes

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

const DEBUG = process.argv.includes('--debug');
const debug = (method, message) => DEBUG && console.log(`[${method}] ${message}`);

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
        debug('importOf', `${name} in ${rel(file)} → ${target ? `${rel(target)} (${exportName})` : 'not resolved'}`);
        return target ? { file: target, exportName } : undefined;
      }
    }
    debug('importOf', `${name} is not imported in ${rel(file)}`);
    return undefined;
  }

  /** Resolves './x' relative to the importing file and 'app/x' against src/ (tsconfig baseUrl). */
  resolveImport(fromFile, spec) {
    const base = spec.startsWith('.') ? path.resolve(path.dirname(fromFile), spec) : path.join(this.srcDir, spec);
    for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
      if (candidate.endsWith('.ts') && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        debug('resolveImport', `'${spec}' → ${rel(candidate)}`);
        return candidate;
      }
    }
    debug('resolveImport', `'${spec}' → not a project file (package import?)`);
    return undefined;
  }

  /** Initializer of a top-level `const name = ...` declared in or imported into `file`. */
  lookupConst(file, name, depth = 0) {
    const sf = this.getSourceFile(file);
    if (!sf || depth > 8) return undefined;
    for (const stmt of sf.statements) {
      if (name === 'default' && ts.isExportAssignment(stmt)) {
        debug('lookupConst', `export default in ${rel(file)} (line ${this.lineOf(stmt)})`);
        return { expr: stmt.expression, file };
      }
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          debug('lookupConst', `${name} found in ${rel(file)} (line ${this.lineOf(decl)})`);
          return { expr: decl.initializer, file };
        }
      }
    }
    const imp = this.importOf(file, name);
    if (!imp) debug('lookupConst', `${name} not found from ${rel(file)}`);
    return imp ? this.lookupConst(imp.file, imp.exportName, depth + 1) : undefined;
  }

  /** Best-effort string value of an expression (literals, consts, enums, concatenation). */
  evalString(expr, file, depth = 0) {
    const e = unwrap(expr);
    const done = (value) => {
      if (depth === 0) debug('evalString', `${e.getText().replace(/\s+/g, ' ')} → ${JSON.stringify(value)}`);
      return value;
    };
    if (depth > 8) return done(e.getText());
    if (ts.isStringLiteralLike(e)) return done(e.text);
    if (ts.isNumericLiteral(e)) return done(e.text);
    if (ts.isTemplateExpression(e)) {
      return done(e.head.text + e.templateSpans.map((s) => this.evalString(s.expression, file, depth + 1) + s.literal.text).join(''));
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return done(this.evalString(e.left, file, depth + 1) + this.evalString(e.right, file, depth + 1));
    }
    if (ts.isIdentifier(e)) {
      const found = this.lookupConst(file, e.text);
      return done(found ? this.evalString(found.expr, found.file, depth + 1) : e.text);
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const en = this.findDeclaration(file, e.expression.text, ts.isEnumDeclaration);
      const member = en?.node.members.find((m) => m.name.getText() === e.name.text);
      if (member?.initializer) return done(this.evalString(member.initializer, en.file, depth + 1));
    }
    return done(e.getText());
  }

  findDeclaration(file, name, kind, depth = 0) {
    const sf = this.getSourceFile(file);
    if (!sf || depth > 8) return undefined;
    const node = sf.statements.find((s) => kind(s) && s.name?.text === name);
    if (node) {
      debug('findDeclaration', `${name} declared in ${rel(file)} (line ${this.lineOf(node)})`);
      return { node, file };
    }
    const imp = this.importOf(file, name);
    if (!imp) debug('findDeclaration', `${name} not found from ${rel(file)}`);
    return imp ? this.findDeclaration(imp.file, imp.exportName, kind, depth + 1) : undefined;
  }

  resolveClassFile(file, name) {
    const found = this.findDeclaration(file, name, ts.isClassDeclaration)?.file;
    debug('resolveClassFile', `${name} → ${found ? rel(found) : 'not found'}`);
    return found;
  }

  defaultExportClass(file) {
    const sf = this.getSourceFile(file);
    if (!sf) return undefined;
    for (const stmt of sf.statements) {
      let name;
      if (ts.isClassDeclaration(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) name = stmt.name?.text;
      else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) name = stmt.expression.text;
      else continue;
      debug('defaultExportClass', `${rel(file)} → ${name}`);
      return name;
    }
    debug('defaultExportClass', `${rel(file)} has no default export class`);
    return undefined;
  }

  getSourceFile(file) {
    if (!this.files.has(file)) {
      let sf;
      try {
        sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        debug('getSourceFile', `parsed ${rel(file)}`);
      } catch {
        sf = undefined;
        debug('getSourceFile', `could not read ${rel(file)}`);
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
