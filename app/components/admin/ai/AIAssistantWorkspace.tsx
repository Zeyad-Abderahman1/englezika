'use client';

/**
 * app/components/admin/ai/AIAssistantWorkspace.tsx
 *
 * Dedicated full-page AI Assistant workspace for Englizeka Admin.
 * Provides:
 * - A conversational AGENT: the teacher talks naturally and the assistant collects
 *   missing details step by step (chips, thumbnail upload), shows a confirmation
 *   card, and only then performs the action through the confirmed-execution API
 * - Quick commands that start the matching flow (course, lecture, price, homework)
 * - Multi-turn memory that survives a page refresh
 * - Compound plan review for planner-driven requests (exams, quizzes, reordering)
 * - PDF assessment generation, safe disabled-AI fallback, full RTL + mobile layout
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  History,
  Sparkles,
  Send,
  LoaderCircle,
  StopCircle,
  ArrowRight,
  Bot,
  UserRound,
  ListChecks,
  BookPlus,
  BadgeDollarSign,
  ClipboardPlus,
  PlaySquare,
  Paperclip,
  FileSearch,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { CompoundPlanCard } from './CompoundPlanCard';
import { AssistantMessageContent } from './AssistantMessageContent';
import { ConversationHistoryPanel } from './ConversationHistoryPanel';
import { AgentUiBlocks, useRevokeOnUnmount, type ExtractViewState, type UploadViewState } from './AgentCards';
import { formatUserFacingConfirmationError } from '../../../lib/ai/confirmation-state';
import type { AgentEvent, AgentUi } from '../../../lib/ai/agent/ui-types';
import type { ConfirmationPreview } from '../../../lib/ai/preview-generator';
import './ai-assistant.css';
import './agent-chat.css';
import './conversation-history.css';

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ui?: AgentUi[];
  /** Set on client-side network failures so "retry" resends the same request. */
  clientRetry?: TurnPayload;
  confirmationToken?: string;
  preview?: ConfirmationPreview;
  actionsExecuted?: Array<{ tool: string; result: unknown }>;
}

interface TurnPayload {
  message?: string;
  event?: AgentEvent;
}

interface AIAssistantWorkspaceProps {
  activeCourseId?: string;
}

const WELCOME: ChatMessageItem = {
  id: 'welcome',
  role: 'assistant',
  text: '## أهلاً بك في المساعد الذكي\n\nأقدر أضيف كورس، أرفع محاضرات من YouTube، أعدّل السعر، أضيف واجب، أو أجاوبك على أي سؤال عن المنصة. اختار أمر سريع من تحت أو اكتب طلبك بشكل طبيعي، وأنا هسألك عن أي تفاصيل ناقصة وأراجع معاك قبل ما أنفّذ.',
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Exam-paper photos use the same per-page limit as the OCR upload. */
const MAX_PAGE_BYTES = 10 * 1024 * 1024;

interface PendingPage {
  id: string;
  file: File;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  uploadId?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const QUICK_COMMANDS: Array<{
  key: string;
  label: string;
  icon: typeof BookPlus;
  payload: TurnPayload;
  bubble: string;
}> = [
  {
    key: 'course',
    label: 'إضافة كورس',
    icon: BookPlus,
    payload: { event: { type: 'start_flow', flow: 'create_course' } },
    bubble: 'عايز أضيف كورس جديد',
  },
  {
    key: 'lecture',
    label: 'إضافة محاضرة',
    icon: PlaySquare,
    payload: { event: { type: 'start_flow', flow: 'add_lecture' } },
    bubble: 'عايز أضيف محاضرة',
  },
  {
    key: 'price',
    label: 'تعديل السعر',
    icon: BadgeDollarSign,
    payload: { event: { type: 'choice', slot: '__start', value: 'update_course:price' } },
    bubble: 'عايز أعدّل سعر كورس',
  },
  {
    key: 'homework',
    label: 'إضافة واجب',
    icon: ClipboardPlus,
    payload: { event: { type: 'start_flow', flow: 'add_homework' } },
    bubble: 'عايز أضيف واجب',
  },
  {
    key: 'exam-photos',
    label: 'إنشاء امتحان من صور',
    icon: FileSearch,
    payload: { event: { type: 'start_flow', flow: 'create_exam_from_images' } },
    bubble: 'عايز أعمل امتحان من صور',
  },
  {
    key: 'quiz',
    label: 'كويز سريع',
    icon: ListChecks,
    payload: { message: 'أنشئ كويز سريع مكون من 5 أسئلة للمحاضرة الحالية' },
    bubble: 'أنشئ كويز سريع مكون من 5 أسئلة للمحاضرة الحالية',
  },
];

export function AIAssistantWorkspace({ activeCourseId }: AIAssistantWorkspaceProps) {
  const { data, admin, refreshData, setNotice, aiEnabled: contextAiEnabled } = useAdmin();
  const courses = data?.courses || [];

  // Feature status check
  const [statusChecked, setStatusChecked] = useState(contextAiEnabled);
  const [isAiEnabled, setIsAiEnabled] = useState(contextAiEnabled);

  // Chat state
  const [messages, setMessages] = useState<ChatMessageItem[]>([WELCOME]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [upload, setUpload] = useState<UploadViewState>({ status: 'idle' });
  useRevokeOnUnmount(upload.previewUrl);
  const [pendingPages, setPendingPages] = useState<PendingPage[]>([]);
  const [pageNotice, setPageNotice] = useState('');
  const [extractState, setExtractState] = useState<ExtractViewState | null>(null);
  const extractRunsRef = useRef<Set<string>>(new Set());
  const extractCancelRef = useRef(false);
  const pendingPagesRef = useRef<PendingPage[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const openConversationRef = useRef<((id: string) => Promise<void>) | null>(null);

  // Chat history: the open chat is reflected in the URL (?c=<id>) and can be switched at any time.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlConversationId = searchParams.get('c');
  /** Bumped whenever the visible chat changes, so a late response of an old chat is dropped. */
  const chatEpochRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** False when a reopened chat no longer has a live flow session: its old chips/uploads are disabled. */
  const [sessionActive, setSessionActive] = useState<boolean | undefined>(undefined);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const syncUrl = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set('c', id);
      else params.delete('c');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const storageKey = admin?.email ? `englizeka-ai-conversation:${admin.email.toLowerCase()}` : null;

  // Check AI feature availability
  useEffect(() => {
    if (contextAiEnabled) {
      return;
    }

    let active = true;
    fetch('/api/admin/ai/status')
      .then((res) => res.json())
      .then((statusData) => {
        if (active) {
          setIsAiEnabled(Boolean(statusData?.enabled));
          setStatusChecked(true);
        }
      })
      .catch(() => {
        if (active) {
          setIsAiEnabled(false);
          setStatusChecked(true);
        }
      });

    return () => {
      active = false;
    };
  }, [contextAiEnabled]);

  // Restore the chat after a refresh / shared link: ?c=<id> first, then the last chat of this browser.
  useEffect(() => {
    if (restoredRef.current || !storageKey) return;
    restoredRef.current = true;

    let id = urlConversationId;
    if (!id) {
      try {
        id = window.localStorage.getItem(storageKey);
      } catch {
        id = null;
      }
    }
    if (id) void openConversationRef.current?.(id);
  }, [storageKey, urlConversationId]);

  // Keep selected course in sync if courses load late (planner context only)
  const effectiveCourseId = activeCourseId || courses[0]?.id || '';

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  // Cancel generation in flight
  const handleCancelRequest = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setLoading(false);
  };

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();
  const lastUi = lastAssistantIndex >= 0 ? messages[lastAssistantIndex].ui : undefined;
  const uploadRequested = Boolean(lastUi?.some((block) => block.kind === 'upload'));
  const extracting = Boolean(extractState?.running);
  const pagesUploading = pendingPages.some((page) => page.status === 'uploading');
  const pagesWithError = pendingPages.some((page) => page.status === 'error');
  const readyPages = pendingPages.filter((page) => page.status === 'ready' && page.uploadId);

  /**
   * Sends one turn to the agent. `payload.event` is a button/attachment action,
   * `payload.message` is typed text. `bubble` is the text shown as the teacher's own
   * message (omit for silent events such as "executed").
   */
  const sendTurn = useCallback(
    async (payload: TurnPayload, bubble?: string) => {
      if (loading) return;
      const epoch = chatEpochRef.current;
      if (bubble) {
        setMessages((prev) => [...prev, { id: `user_${Date.now()}`, role: 'user', text: bubble }]);
      }
      setLoading(true);

      const controller = new AbortController();
      setAbortController(controller);

      try {
        const res = await fetch('/api/admin/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            conversationId,
            context: { courseId: effectiveCourseId || activeCourseId },
          }),
          signal: controller.signal,
        });

        const resData = await res.json().catch(() => null);
        if (!res.ok || !resData?.success) {
          throw new Error(typeof resData?.error === 'string' ? resData.error : 'تعذر التواصل مع المساعد الذكي');
        }
        // The teacher switched chats while this request was running: never show it in the other chat.
        if (epoch !== chatEpochRef.current) return;

        setSessionActive(undefined);
        setHistoryRefresh((n) => n + 1);
        if (resData.conversationId) {
          if (resData.conversationId !== conversationId) syncUrl(resData.conversationId);
          setConversationId(resData.conversationId);
          if (storageKey) {
            try {
              window.localStorage.setItem(storageKey, resData.conversationId);
            } catch {
              // storage unavailable (private mode) — the chat still works, just not across refreshes
            }
          }
        }

        const ui: AgentUi[] | undefined = Array.isArray(resData.ui) && resData.ui.length ? resData.ui : undefined;
        if (ui?.some((block) => block.kind === 'upload')) setUpload({ status: 'idle' });

        setMessages((prev) => [
          ...prev,
          {
            id: `asst_${Date.now()}`,
            role: 'assistant',
            text: resData.reply || 'تمت معالجة الطلب.',
            ui,
            confirmationToken: resData.confirmationToken,
            preview: resData.preview,
            actionsExecuted: resData.actionsExecuted,
          },
        ]);

        // A finished confirmed action, or safe actions executed directly by the planner.
        if (ui?.some((block) => block.kind === 'success') || (resData.actionsExecuted && resData.actionsExecuted.length > 0)) {
          await refreshData(1);
          setNotice('تم تطبيق التغييرات بنجاح وتحديث لوحة الإدارة.');
        }
      } catch (caught: unknown) {
        if (epoch === chatEpochRef.current && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          const message = caught instanceof Error && caught.message ? caught.message : 'تعذر إكمال الطلب. حاول مرة أخرى بعد قليل.';
          setMessages((prev) => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              role: 'assistant',
              text: 'تعذر إكمال الطلب',
              ui: [{ kind: 'error', message, retry: true }],
              clientRetry: payload,
            },
          ]);
        }
      } finally {
        if (epoch === chatEpochRef.current) {
          setLoading(false);
          setAbortController(null);
        }
      }
    },
    [loading, conversationId, effectiveCourseId, activeCourseId, storageKey, refreshData, setNotice, syncUrl]
  );

  const clearPendingPages = () => {
    for (const page of pendingPagesRef.current) URL.revokeObjectURL(page.previewUrl);
    setPendingPages([]);
    setPageNotice('');
  };

  // ── Chat history: new chat / open / older messages ────────────────────────────
  const resetChatState = () => {
    chatEpochRef.current += 1;
    abortController?.abort();
    setAbortController(null);
    setLoading(false);
    extractCancelRef.current = true;
    setExtractState(null);
    setInputText('');
    setUpload({ status: 'idle' });
    clearPendingPages();
  };

  const startNewChat = () => {
    resetChatState();
    setMessages([WELCOME]);
    setConversationId(undefined);
    setSessionActive(undefined);
    setOlderCursor(null);
    syncUrl(null);
    if (storageKey) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore: storage is only a convenience
      }
    }
    if (typeof window !== 'undefined' && window.innerWidth <= 860) setHistoryOpen(false);
  };

  const mapHistory = (items: Array<{ id: string; role: 'user' | 'assistant'; text: string; ui?: AgentUi[] }>): ChatMessageItem[] =>
    items.map((item) => ({
      id: `hist_${item.id}`,
      role: item.role,
      text: item.text,
      ui: Array.isArray(item.ui) && item.ui.length > 0 ? item.ui : undefined,
    }));

  const openConversation = async (id: string) => {
    if (loading && id === conversationId) return;
    resetChatState();
    const epoch = chatEpochRef.current;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/ai/conversations/${encodeURIComponent(id)}`);
      if (epoch !== chatEpochRef.current) return;
      if (!res.ok) {
        setMessages([WELCOME]);
        setConversationId(undefined);
        syncUrl(null);
        if (res.status === 404) setNotice('المحادثة دي مش موجودة أو مش بتاعتك.');
        return;
      }
      const payload = await res.json();
      if (epoch !== chatEpochRef.current) return;
      const history = mapHistory(payload.messages ?? []);
      setConversationId(id);
      setMessages(history.length ? [WELCOME, ...history] : [WELCOME]);
      setSessionActive(Boolean(payload.sessionActive));
      setOlderCursor(payload.hasMore && payload.messages?.length ? Number(payload.messages[0].createdAt) : null);
      syncUrl(id);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, id);
        } catch {
          // ignore
        }
      }
      if (typeof window !== 'undefined' && window.innerWidth <= 860) setHistoryOpen(false);
    } catch {
      if (epoch === chatEpochRef.current) setNotice('تعذر فتح المحادثة. حاول تاني.');
    } finally {
      if (epoch === chatEpochRef.current) setHistoryLoading(false);
    }
  };
  useEffect(() => {
    openConversationRef.current = openConversation;
  });

  const loadOlderMessages = async () => {
    if (!conversationId || olderCursor === null || loadingOlder) return;
    const epoch = chatEpochRef.current;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/admin/ai/conversations/${encodeURIComponent(conversationId)}?before=${olderCursor}`);
      const payload = res.ok ? await res.json() : null;
      if (!payload || epoch !== chatEpochRef.current) return;
      const older = mapHistory(payload.messages ?? []);
      // Old cards are never interactive: only the last assistant message of the chat is.
      setMessages((prev) => [prev[0], ...older, ...prev.slice(1)]);
      setOlderCursor(payload.hasMore && payload.messages?.length ? Number(payload.messages[0].createdAt) : null);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSendText = (textToSend?: string) => {
    const message = (textToSend ?? inputText).trim();
    if (loading || extracting) return;

    // Exam-paper photos attached in the composer start (or feed) the exam-from-photos flow.
    if (pendingPages.length > 0) {
      if (pagesUploading || pagesWithError || readyPages.length === 0) return;
      const uploadIds = readyPages.map((page) => page.uploadId as string);
      const bubble = message || '📎 ' + readyPages.length + ' صفحة من ورق الامتحان';
      setInputText('');
      clearPendingPages();
      void sendTurn({ message: message || undefined, event: { type: 'pages', uploadIds } }, bubble);
      return;
    }

    if (!message) return;
    setInputText('');
    void sendTurn({ message }, message);
  };

  // ── Exam-paper photos in the composer (many images, reorder, remove) ──────────
  useEffect(() => {
    pendingPagesRef.current = pendingPages;
  }, [pendingPages]);

  useEffect(() => {
    return () => {
      for (const page of pendingPagesRef.current) URL.revokeObjectURL(page.previewUrl);
    };
  }, []);

  const uploadPage = async (item: PendingPage) => {
    setPendingPages((prev) => prev.map((page) => (page.id === item.id ? { ...page, status: 'uploading', error: undefined } : page)));
    try {
      const formData = new FormData();
      formData.append('file', item.file);
      const res = await fetch('/api/admin/ai/upload-image?purpose=exam_page', { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || typeof data.uploadId !== 'string') {
        throw new Error(typeof data?.error === 'string' ? data.error : 'تعذر رفع الصورة');
      }
      setPendingPages((prev) =>
        prev.map((page) => (page.id === item.id ? { ...page, status: 'ready', uploadId: data.uploadId } : page))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر رفع الصورة';
      setPendingPages((prev) => prev.map((page) => (page.id === item.id ? { ...page, status: 'error', error: message } : page)));
    }
  };

  const addPageFiles = async (files: File[]) => {
    setPageNotice('');
    const accepted: PendingPage[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) rejected.push(file.name + ': النوع غير مدعوم (PNG أو JPEG أو WebP فقط)');
      else if (file.size > MAX_PAGE_BYTES) rejected.push(file.name + ': الحجم يتجاوز 10 ميجابايت');
      else {
        accepted.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), status: 'uploading' });
      }
    }
    if (rejected.length) setPageNotice(rejected.slice(0, 3).join(' — '));
    if (!accepted.length) return;
    setPendingPages((prev) => [...prev, ...accepted]);
    for (const item of accepted) await uploadPage(item);
  };

  const movePage = (id: string, direction: -1 | 1) => {
    setPendingPages((prev) => {
      const index = prev.findIndex((page) => page.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const removePage = (id: string) => {
    setPendingPages((prev) => {
      const target = prev.find((page) => page.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((page) => page.id !== id);
    });
  };

  // ── Browser-driven extraction: one short request per window of pages ──────────
  const runExtraction = async (block: Extract<AgentUi, { kind: 'extract' }>) => {
    extractCancelRef.current = false;
    let done = 0;
    let failed = 0;
    let found = 0;
    const base = {
      extractionId: block.extractionId,
      pagesTotal: block.pageCount,
      windowsTotal: block.windowIndices.length,
    };
    setExtractState({ ...base, running: true, windowsDone: 0, questionsSoFar: 0, failedWindows: 0 });

    for (const windowIndex of block.windowIndices) {
      if (extractCancelRef.current) return;
      let ok = false;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        try {
          const res = await fetch('/api/admin/ai/exam-extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extractionId: block.extractionId, windowIndex }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.ok) {
            found += Number(data.count) || 0;
            ok = true;
          } else if (data?.retryable === false) {
            break;
          }
        } catch {
          // network hiccup: retry once
        }
        if (!ok && attempt < 2) await sleep(1500);
      }
      if (!ok) failed += 1;
      done += 1;
      setExtractState({ ...base, running: true, windowsDone: done, questionsSoFar: found, failedWindows: failed });
    }

    if (extractCancelRef.current) return;
    setExtractState({ ...base, running: false, windowsDone: done, questionsSoFar: found, failedWindows: failed });
    await sendTurn({ event: { type: 'extraction_done', extractionId: block.extractionId } });
  };

  const lastAssistantId = lastAssistantIndex >= 0 ? messages[lastAssistantIndex].id : '';
  useEffect(() => {
    const block = lastUi?.find((item): item is Extract<AgentUi, { kind: 'extract' }> => item.kind === 'extract');
    if (!block) return;
    const key = lastAssistantId + ':' + block.extractionId + ':' + block.windowIndices.join(',');
    if (extractRunsRef.current.has(key)) return;
    extractRunsRef.current.add(key);
    void runExtraction(block);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per extract block
  }, [lastAssistantId]);

  // Chip / button actions
  const handleChoice = (slot: string, value: string, label: string) => {
    void sendTurn({ event: { type: 'choice', slot, value } }, label);
  };

  const handleSkip = () => void sendTurn({ event: { type: 'skip' } }, 'تخطي');
  const handleCancelFlow = () => {
    extractCancelRef.current = true;
    setExtractState(null);
    void sendTurn({ event: { type: 'cancel' } }, 'إلغاء');
  };

  const handleRetry = (message: ChatMessageItem) => {
    if (message.clientRetry) {
      void sendTurn(message.clientRetry);
    } else {
      void sendTurn({ event: { type: 'retry' } }, 'إعادة المحاولة');
    }
  };

  // Thumbnail selected in the chat: validate, upload, then tell the agent only the reference id.
  const handleFile = async (file: File) => {
    if (loading) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setUpload({ status: 'error', error: 'يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP.' });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUpload({ status: 'error', error: 'حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت).' });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setUpload({ status: 'uploading', previewUrl, fileName: file.name });

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/ai/upload-image', { method: 'POST', body: formData });
      const resData = await res.json().catch(() => null);
      if (!res.ok || !resData?.success || typeof resData.uploadId !== 'string') {
        setUpload({
          status: 'error',
          previewUrl,
          error: typeof resData?.error === 'string' ? resData.error : 'تعذر رفع الصورة. حاول مرة أخرى.',
        });
        return;
      }
      setUpload({
        status: 'done',
        previewUrl,
        fileName: file.name,
        note: resData.notWidescreen
          ? 'ملحوظة: الصورة مش بنسبة 16:9، فممكن تتقص شوية في العرض. تقدر تكمل أو ترفع صورة تانية.'
          : undefined,
      });
      await sendTurn({ event: { type: 'attachment', uploadId: resData.uploadId } }, `📎 ${file.name}`);
    } catch {
      setUpload({ status: 'error', previewUrl, error: 'تعذر رفع الصورة. تأكد من الاتصال وحاول مرة أخرى.' });
    }
  };

  // Confirm and execute (the only place a write is triggered, via the signed token)
  const handleConfirmToken = async (token: string, confirmText?: string) => {
    const res = await fetch('/api/admin/ai/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(confirmText === undefined ? { token } : { token, confirmText }),
    });

    const resData = await res.json().catch(() => null);
    if (!res.ok || !resData?.success) {
      const code = typeof resData?.code === 'string' ? resData.code : '';
      const serverMessage = typeof resData?.error === 'string' ? resData.error : '';
      // Delete guard rejections happen BEFORE the token is consumed: keep the card as it is.
      if (code === 'CONFIRM_TEXT_MISMATCH' || code === 'MISSING_CONFIRM_NAME' || code === 'BAD_PAYLOAD') {
        throw new Error(serverMessage || 'الاسم المكتوب غير مطابق.');
      }
      // The item changed (or vanished) since the card was shown: ask the agent for a fresh summary.
      if (code === 'IMPACT_CHANGED' || code === 'NOT_FOUND') {
        await sendTurn({ event: { type: 'retry' } });
        throw new Error(serverMessage || 'تغيّرت بيانات العنصر. راجع الملخص الجديد.');
      }
      // Let the agent post the failure card (with retry) from the stored result.
      await sendTurn({ event: { type: 'executed', token } });
      throw new Error(formatUserFacingConfirmationError(resData?.error));
    }

    await sendTurn({ event: { type: 'executed', token } });
  };

  // Legacy planner confirmation (compound plans)
  const handleConfirmPlan = async (token: string) => {
    const res = await fetch('/api/admin/ai/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const resData = await res.json();
    if (!res.ok || !resData.success) {
      throw new Error(resData.error || 'فشل تطبيق الإجراء المؤكد على المنصة');
    }

    await refreshData(1);
    setNotice('تم تنفيذ الإجراء المؤكد بنجاح وتحديث بيانات المنصة.');
    setMessages((prev) => [
      ...prev,
      {
        id: `done_${Date.now()}`,
        role: 'assistant',
        text: '**تم تنفيذ خطة العمل بنجاح.**\n\nطُبّقت التعديلات وتم تحديث بيانات النظام.',
      },
    ]);
  };

  // Loading state while checking status
  if (!statusChecked && !contextAiEnabled) {
    return (
      <div className="ai-workspace-loading" role="status" aria-live="polite">
        <div className="ai-workspace-loading-card">
          <LoaderCircle size={32} className="spin" />
          <p>جاري التحقق من جاهزية المساعد الذكي...</p>
        </div>
      </div>
    );
  }

  // Disabled State
  if (!isAiEnabled && !contextAiEnabled) {
    return (
      <div className="ai-workspace-disabled-container" role="alert">
        <div className="ai-workspace-disabled-card">
          <div className="ai-workspace-disabled-icon">
            <Bot size={48} />
          </div>
          <h2 className="ai-workspace-disabled-title">خدمة المساعد الذكي غير مفعلة حالياً</h2>
          <p className="ai-workspace-disabled-desc">
            خدمة المساعد الذكي للمعلم معطلة حالياً على هذا الخادم بواسطة إدارة المنصة.
            يمكنك متابعة العمل العادي وإدارة الكورسات والامتحانات عبر الأقسام المخصصة لها في القائمة الجانبية.
          </p>
          <div className="ai-workspace-disabled-actions">
            <Link href="/admin" className="btn btn-primary">
              <ArrowRight size={16} /> العودة للرئيسية
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-workspace-wrapper" dir="rtl">
      {/* ── Main Workspace Card ────────────────────────────────────────────── */}
      <section className="ai-workspace-card" aria-label="مساحة عمل المساعد الذكي للمعلم">
        {/* Header */}
        <header className="ai-workspace-header">
          <div className="ai-workspace-header-info">
            <div className="ai-workspace-header-badge">
              <Sparkles size={22} />
            </div>
            <div>
              <h1 className="ai-workspace-title">المساعد الذكي للمعلم</h1>
              <p className="ai-workspace-subtitle">
                مساعد لإدارة المحتوى والاختبارات — كل عملية تُراجَع وتُؤكَّد قبل التنفيذ
              </p>
            </div>
          </div>
          <div className="ai-workspace-header-meta">
            <button
              type="button"
              className="ai-history-toggle"
              aria-expanded={historyOpen}
              aria-controls="ai-history-panel"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History size={16} aria-hidden="true" /> سجل المحادثات
            </button>
            <span className="ai-workspace-status-tag" title="المساعد الذكي جاهز">
              <span className="ai-workspace-status-dot" aria-hidden="true" />
              جاهز ومؤمّن
            </span>
          </div>
        </header>

        <div className="ai-workspace-body">
        <div className="ai-history-wrap" id="ai-history-panel" hidden={!historyOpen}>
          <ConversationHistoryPanel
            activeId={conversationId}
            refreshKey={historyRefresh}
            disabled={historyLoading}
            onSelect={(id) => void openConversation(id)}
            onNew={startNewChat}
            onActiveDeleted={startNewChat}
            onClose={() => setHistoryOpen(false)}
          />
        </div>
        {historyOpen && (
          <button type="button" className="ai-history-backdrop" aria-label="إغلاق سجل المحادثات" onClick={() => setHistoryOpen(false)} />
        )}
        <div className="ai-workspace-tab-panel">
          <div
            className="ai-workspace-messages-container"
            tabIndex={0}
            role="log"
            aria-live="polite"
            aria-label="سجل المحادثة"
          >
            {olderCursor !== null && (
              <button type="button" className="ai-history-older" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>
                {loadingOlder ? 'جاري التحميل...' : 'تحميل رسائل أقدم'}
              </button>
            )}
            {historyLoading && <p className="ai-history-stale-note">جاري فتح المحادثة...</p>}
            {messages.map((msg, index) => (
              <div key={msg.id} className={`ai-message-row ${msg.role}`}>
                <div className="ai-message-avatar" aria-hidden="true">
                  {msg.role === 'assistant' ? <Bot size={16} /> : <UserRound size={16} />}
                </div>
                <div className="ai-message-bubble">
                  {msg.role === 'assistant' ? (
                    <AssistantMessageContent text={msg.text} actionsExecuted={msg.actionsExecuted} />
                  ) : (
                    <p className="ai-message-text" dir="auto">
                      {msg.text}
                    </p>
                  )}

                  {msg.ui && (
                    <AgentUiBlocks
                      extract={extractState}
                      blocks={msg.ui}
                      interactive={index === lastAssistantIndex && sessionActive !== false}
                      busy={loading}
                      upload={upload}
                      onChoice={handleChoice}
                      onSkip={handleSkip}
                      onCancel={handleCancelFlow}
                      onConfirm={handleConfirmToken}
                      onFile={(file) => void handleFile(file)}
                      onRetry={() => handleRetry(msg)}
                    />
                  )}

                  {/* Planner compound plan card if confirmation is required */}
                  {msg.confirmationToken && msg.preview && (
                    <CompoundPlanCard
                      token={msg.confirmationToken}
                      preview={msg.preview}
                      onConfirm={handleConfirmPlan}
                    />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="ai-status-banner" role="status" aria-live="polite">
                <div className="ai-status-indicator agent-typing">
                  <span className="agent-typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>المساعد بيكتب...</span>
                </div>
                <button
                  type="button"
                  className="ai-cancel-btn"
                  onClick={handleCancelRequest}
                  aria-label="إلغاء العملية الحالية"
                >
                  <StopCircle size={14} style={{ display: 'inline', marginLeft: 4 }} />
                  إلغاء
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Footer, Quick commands & Composer */}
          <footer className="ai-workspace-footer">
            <div className="ai-workspace-quick-prompts" aria-label="أوامر سريعة">
              <span className="ai-workspace-quick-label">أوامر سريعة:</span>
              {QUICK_COMMANDS.map((command) => {
                const Icon = command.icon;
                return (
                  <button
                    key={command.key}
                    type="button"
                    className="ai-quick-chip"
                    disabled={loading || extracting}
                    onClick={() => void sendTurn(command.payload, command.bubble)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {command.label}
                  </button>
                );
              })}
            </div>

            {pendingPages.length > 0 && (
              <div className="agent-pages-strip" aria-label="صور ورق الامتحان المرفقة">
                <div className="agent-pages-head">
                  <span>
                    {pendingPages.length} {pendingPages.length === 1 ? 'صورة' : 'صور'} مرفقة — الترتيب هنا هو ترتيب الصفحات
                  </span>
                  <button type="button" className="agent-btn agent-btn-ghost" onClick={clearPendingPages}>
                    إزالة الكل
                  </button>
                </div>
                <ol className="agent-pages-list">
                  {pendingPages.map((page, index) => (
                    <li key={page.id} className={'agent-page-thumb ' + (page.status === 'error' ? 'is-error' : '')}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                      <img src={page.previewUrl} alt={'الصفحة ' + (index + 1)} width={84} height={112} />
                      <span className="agent-page-num">{index + 1}</span>
                      {page.status === 'uploading' && <span className="agent-page-state">جاري الرفع…</span>}
                      {page.status === 'error' && (
                        <span className="agent-page-state" title={page.error}>
                          فشل الرفع
                        </span>
                      )}
                      <div className="agent-page-actions">
                        <button type="button" onClick={() => movePage(page.id, -1)} disabled={index === 0} aria-label="تقديم الصفحة">
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => movePage(page.id, 1)}
                          disabled={index === pendingPages.length - 1}
                          aria-label="تأخير الصفحة"
                        >
                          <ArrowLeft size={14} aria-hidden="true" />
                        </button>
                        {page.status === 'error' ? (
                          <button type="button" onClick={() => void uploadPage(page)} aria-label="إعادة رفع الصفحة">
                            ↻
                          </button>
                        ) : null}
                        <button type="button" onClick={() => removePage(page.id)} aria-label={'حذف الصفحة ' + (index + 1)}>
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
                {pageNotice && <p className="agent-inline-error">{pageNotice}</p>}
              </div>
            )}
            {pendingPages.length === 0 && pageNotice && <p className="agent-inline-error">{pageNotice}</p>}

            <form
              className="ai-input-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendText();
              }}
            >
              <input
                ref={attachInputRef}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                multiple
                className="agent-visually-hidden"
                tabIndex={-1}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (!files.length) return;
                  // A thumbnail question accepts ONE image. Anywhere else the images are exam pages.
                  if (uploadRequested) {
                    if (files.length > 1) {
                      setUpload({ status: 'error', error: 'اختار صورة واحدة فقط للصورة المصغرة.' });
                      return;
                    }
                    void handleFile(files[0]);
                  } else {
                    void addPageFiles(files);
                  }
                }}
              />
              <button
                type="button"
                className="agent-attach-btn"
                disabled={loading || extracting}
                onClick={() => attachInputRef.current?.click()}
                aria-label="إرفاق صور"
                title={uploadRequested ? 'إرفاق صورة واحدة (الصورة المصغرة)' : 'إرفاق صور ورق الامتحان (أكتر من صورة)'}
              >
                <Paperclip size={18} aria-hidden="true" />
              </button>
              <textarea
                ref={textareaRef}
                className="ai-input-textarea"
                placeholder="اكتب طلبك هنا…"
                aria-label="اكتب رسالة للمساعد الذكي (Enter للإرسال، Shift+Enter لسطر جديد)"
                title="Enter للإرسال، Shift+Enter لسطر جديد"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSendText();
                  }
                }}
                rows={2}
                maxLength={2000}
              />
              <button
                type="submit"
                className="ai-submit-btn"
                disabled={
                  loading ||
                  extracting ||
                  (pendingPages.length > 0
                    ? pagesUploading || pagesWithError || readyPages.length === 0
                    : !inputText.trim())
                }
                aria-label="إرسال الأمر للمساعد الذكي"
              >
                <Send size={18} />
              </button>
            </form>
          </footer>
        </div>
        </div>
      </section>
    </div>
  );
}
