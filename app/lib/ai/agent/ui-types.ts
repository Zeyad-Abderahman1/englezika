/**
 * Wire types shared by the chat API and the assistant UI. This file must stay
 * free of server-only imports so client components can import it.
 */

export type AgentFlowId = 'create_course' | 'add_lecture' | 'update_course' | 'add_homework';

export interface AgentChipOption {
  label: string;
  value: string;
}

export interface AgentConfirmRow {
  label: string;
  value: string;
  /** Previous value, shown crossed-out for edits (old → new). */
  previous?: string;
}

export type AgentUi =
  | { kind: 'chips'; slot: string; options: AgentChipOption[] }
  | { kind: 'upload'; slot: 'thumbnail'; skippable: boolean; accept: string; maxBytes: number }
  | {
      kind: 'confirm';
      token: string;
      title: string;
      rows: AgentConfirmRow[];
      editable: AgentChipOption[];
    }
  | {
      kind: 'success';
      title: string;
      lines: string[];
      link?: { href: string; label: string };
    }
  | { kind: 'error'; message: string; retry: boolean };

export type AgentEvent =
  | { type: 'start_flow'; flow: AgentFlowId }
  | { type: 'choice'; slot: string; value: string }
  | { type: 'attachment'; uploadId: string }
  | { type: 'skip' }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'executed'; token: string };

const FLOWS = new Set<string>(['create_course', 'add_lecture', 'update_course', 'add_homework']);

/** Validates an untrusted event object coming from the browser. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  switch (event.type) {
    case 'start_flow':
      return typeof event.flow === 'string' && FLOWS.has(event.flow)
        ? { type: 'start_flow', flow: event.flow as AgentFlowId }
        : null;
    case 'choice':
      return typeof event.slot === 'string' &&
        typeof event.value === 'string' &&
        event.slot.length <= 40 &&
        event.value.length <= 200
        ? { type: 'choice', slot: event.slot, value: event.value }
        : null;
    case 'attachment':
      return typeof event.uploadId === 'string' && event.uploadId.length <= 80
        ? { type: 'attachment', uploadId: event.uploadId }
        : null;
    case 'skip':
      return { type: 'skip' };
    case 'cancel':
      return { type: 'cancel' };
    case 'retry':
      return { type: 'retry' };
    case 'executed':
      return typeof event.token === 'string' && event.token.length <= 200
        ? { type: 'executed', token: event.token }
        : null;
    default:
      return null;
  }
}
