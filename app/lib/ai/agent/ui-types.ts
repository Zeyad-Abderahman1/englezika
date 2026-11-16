/**
 * Wire types shared by the chat API and the assistant UI. This file must stay
 * free of server-only imports so client components can import it.
 */

export type AgentFlowId =
  | 'create_course'
  | 'add_lecture'
  | 'update_course'
  | 'add_homework'
  | 'create_exam_from_images'
  | 'delete_item';

export type AgentCardStatus = 'active' | 'used' | 'expired' | 'cancelled' | 'failed';

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
      /** Set when a reopened chat shows an old card: anything but 'active' is shown disabled. */
      status?: AgentCardStatus;
    }
  | {
      kind: 'success';
      title: string;
      lines: string[];
      link?: { href: string; label: string };
    }
  | { kind: 'error'; message: string; retry: boolean }
  /**
   * Strong confirmation for deleting ONE item: the teacher must type the exact item name
   * before the button is enabled. The server checks the typed text again.
   */
  | {
      kind: 'delete_confirm';
      token: string;
      itemKind: string;
      name: string;
      rows: AgentConfirmRow[];
      expectText: string;
      /** Hard delete cannot be undone; the card says so. */
      irreversible: boolean;
      expiresInSec: number;
      status?: AgentCardStatus;
    }
  /** Asks for the photos of the exam paper (composer accepts MANY images in this state). */
  | { kind: 'pages_request'; accept: string; maxBytesPerPage: number }
  /** Tells the browser to extract these windows of pages (one short request each). */
  | { kind: 'extract'; extractionId: string; windowIndices: number[]; windowCount: number; pageCount: number }
  | {
      kind: 'extraction_result';
      extractionId: string;
      questionCount: number;
      pageCount: number;
      invalidCount: number;
      duplicatesRemoved: number;
      warnings: string[];
      failedPages: string[];
      preview: Array<{ number: number; prompt: string; options: string[] }>;
      reviewHref: string;
    };

export type AgentEvent =
  | { type: 'start_flow'; flow: AgentFlowId }
  | { type: 'choice'; slot: string; value: string }
  | { type: 'attachment'; uploadId: string }
  /** Exam-paper photos staged by the browser, in order. Starts the exam-from-photos flow. */
  | { type: 'pages'; uploadIds: string[] }
  | { type: 'extraction_done'; extractionId: string }
  | { type: 'skip' }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'executed'; token: string };

const FLOWS = new Set<string>([
  'create_course',
  'add_lecture',
  'update_course',
  'add_homework',
  'create_exam_from_images',
  'delete_item',
]);
const UPLOAD_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

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
    case 'pages':
      return Array.isArray(event.uploadIds) &&
        event.uploadIds.length > 0 &&
        event.uploadIds.every((id) => typeof id === 'string' && UPLOAD_ID_SHAPE.test(id))
        ? { type: 'pages', uploadIds: Array.from(new Set(event.uploadIds as string[])) }
        : null;
    case 'extraction_done':
      return typeof event.extractionId === 'string' && event.extractionId.length > 0 && event.extractionId.length <= 64
        ? { type: 'extraction_done', extractionId: event.extractionId }
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
