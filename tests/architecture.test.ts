import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const files = ['app', 'components', 'lib'].flatMap((dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => `${dir}/${String(f).replaceAll('\\', '/')}`)
    .filter((f) => /\.tsx?$/.test(f)),
);
function imports(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.flatMap((node) => {
    if (
      (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      return [];
    if ((ts.isExportDeclaration(node) && node.isTypeOnly) || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly))
      return [];
    if (ts.isImportDeclaration(node)) {
      const names = node.importClause?.namedBindings;
      if (
        names &&
        ts.isNamedImports(names) &&
        !node.importClause?.name &&
        names.elements.every((n) => n.isTypeOnly)
      )
        return [];
    }
    return [node.moduleSpecifier.text];
  });
}

test('domain, command and read-model modules have no framework, UI or storage dependencies', () => {
  for (const file of files.filter((f) => /^lib\/(domain|mutations|read-models)\//.test(f)))
    for (const dep of imports(file)) {
      assert.doesNotMatch(
        dep,
        /^(next(?:\/|$)|react(?:\/|$)|@neondatabase\/|node:(?:fs|path))/,
        `${file} imports ${dep}`,
      );
      assert.doesNotMatch(
        dep,
        /(?:^|\/)(?:store|storage|components|app|events)(?:[/.]|$)/,
        `${file} imports ${dep}`,
      );
    }
});

test('UI modules cannot import persistence or command handlers', () => {
  for (const file of files.filter((f) => f.startsWith('components/')))
    for (const dep of imports(file))
      assert.doesNotMatch(
        dep,
        /(?:^|\/)lib\/(?:store|storage|mutations|domain|events)(?:[/.]|$)/,
        `${file} imports ${dep}`,
      );
});

test('local runtime module graph has no dependency cycles', () => {
  const graph = new Map(
    files.map((file) => [
      file,
      imports(file).flatMap((dep) => {
        const base = dep.startsWith('@/')
          ? dep.slice(2)
          : dep.startsWith('.')
            ? path.posix.normalize(path.posix.join(path.posix.dirname(file), dep))
            : '';
        const target = [base, base + '.ts', base + '.tsx', base + '/index.ts'].find((f) =>
          files.includes(f),
        );
        return target ? [target] : [];
      }),
    ]),
  );
  const done = new Set<string>(),
    active = new Set<string>();
  function visit(file: string, chain: string[]) {
    assert.ok(!active.has(file), `Dependency cycle: ${[...chain, file].join(' → ')}`);
    if (done.has(file)) return;
    active.add(file);
    for (const next of graph.get(file) ?? []) visit(next, [...chain, file]);
    active.delete(file);
    done.add(file);
  }
  for (const file of files) visit(file, []);
});
