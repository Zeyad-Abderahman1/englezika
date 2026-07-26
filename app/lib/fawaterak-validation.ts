const FAWATERAK_HOSTS = new Set(['app.fawaterk.com', 'staging.fawaterk.com']);

export function isAllowedFawaterakBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      FAWATERAK_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function isAllowedFawaterakCheckoutUrl(checkoutUrl: string, baseUrl: string): boolean {
  try {
    const checkout = new URL(checkoutUrl);
    const gateway = new URL(baseUrl);
    return (
      checkout.protocol === 'https:' &&
      checkout.hostname === gateway.hostname &&
      FAWATERAK_HOSTS.has(checkout.hostname) &&
      !checkout.username &&
      !checkout.password
    );
  } catch {
    return false;
  }
}

export function resolvePublicAppOrigin(
  configuredOrigin: string | undefined,
  requestUrl: string,
  production: boolean
): string {
  const requestOrigin = new URL(requestUrl).origin;
  const candidate =
    configuredOrigin?.trim().replace(/\/$/, '') || (production ? '' : requestOrigin);
  if (!candidate) throw new Error('APP_URL_NOT_CONFIGURED');

  const parsed = new URL(candidate);
  const localDevelopment = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (
    (parsed.protocol !== 'https:' && !(localDevelopment && !production)) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('APP_URL_INVALID');
  }
  return parsed.origin;
}
