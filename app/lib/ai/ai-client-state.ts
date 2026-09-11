/**
 * Client-Safe AI State
 * 
 * Defines sanitized AI state that may be passed to browser/client components.
 * NEVER expose server secrets, endpoints, model names, or resource configurations here.
 */

export interface AIClientState {
  enabled: boolean;
}

export function getClientAiState(enabled?: boolean): AIClientState {
  const isEnabled = typeof enabled === 'boolean'
    ? enabled
    : process.env.AI_ASSISTANT_ENABLED === 'true';

  return {
    enabled: isEnabled,
  };
}
