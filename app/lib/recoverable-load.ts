type RecoverableLoadOptions<T> = {
  fallbackMessage: string;
  onSuccess: (value: T) => void;
  onError: (message: string) => void;
  onSettled?: () => void;
  signal?: AbortSignal;
};

function visibleErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) return fallbackMessage;
  const message = error.message.trim();
  if (!message || error instanceof TypeError || /^failed to fetch$/i.test(message)) {
    return fallbackMessage;
  }
  return message;
}

export function replaceAbortController(previous: AbortController | null): AbortController {
  previous?.abort();
  return new AbortController();
}

export async function runRecoverableLoad<T>(
  task: () => Promise<T>,
  options: RecoverableLoadOptions<T>
): Promise<void> {
  try {
    const value = await task();
    if (options.signal?.aborted) return;
    options.onSuccess(value);
  } catch (error) {
    if (options.signal?.aborted) return;
    options.onError(visibleErrorMessage(error, options.fallbackMessage));
  } finally {
    if (!options.signal?.aborted) options.onSettled?.();
  }
}
