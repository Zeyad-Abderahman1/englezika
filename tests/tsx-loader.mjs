import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelativeTypescriptImport =
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !specifier.match(/\.[cm]?[jt]sx?$/);

    if (!isRelativeTypescriptImport || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;

    try {
      return await nextResolve(`${specifier}.tsx`, context);
    } catch {
      return nextResolve(`${specifier}.ts`, context);
    }
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.tsx')) return nextLoad(url, context);

  const source = await readFile(new URL(url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: new URL(url).pathname,
  });

  return { format: 'module', shortCircuit: true, source: transpiled.outputText };
}
