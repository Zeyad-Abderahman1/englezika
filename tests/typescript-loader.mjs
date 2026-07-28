export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      specifier.startsWith('next/') &&
      !specifier.endsWith('.js')
    ) {
      return nextResolve(`${specifier}.js`, context);
    }
    const isRelativeTypescriptImport =
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !specifier.match(/\.[cm]?[jt]sx?$/);

    if (!isRelativeTypescriptImport || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
