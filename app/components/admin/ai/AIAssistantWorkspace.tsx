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
import {
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
} from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { CompoundPlanCard } from './CompoundPlanCard';
import { AssistantMessageContent } from './AssistantMessageContent';
import { AgentUiBlocks, useRevokeOnUnmount, type UploadViewState } from './AgentCards';
import { formatUserFacingConfirmationError } from '../../../lib/ai/confirmation-state';
import type { AgentEvent, AgentUi } from '../../../lib/ai/agent/ui-types';
import type { ConfirmationPreview } from '../../../lib/ai/preview-generator';
import './ai-assistant.css';
import './agent-chat.css';

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);

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

  // Restore the previous conversation after a page refresh.
  useEffect(() => {
    if (restoredRef.current || !storageKey) return;
    restoredRef.current = true;

    let savedId: string | null = null;
    try {
      savedId = window.localStorage.getItem(storageKey);
    } catch {
      savedId = null;
    }
    if (!savedId) return;

    let active = true;
    fetch(`/api/admin/ai/chat?conversationId=${encodeURIComponent(savedId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!active || !payload?.success || !Array.isArray(payload.messages) || payload.messages.length === 0) {
          return;
        }
        setConversationId(savedId as string);
        setMessages([
          WELCOME,
          ...payload.messages.map((item: { id: string; role: 'user' | 'assistant'; text: string; ui?: AgentUi[] }) => ({
            id: `hist_${item.id}`,
            role: item.role,
            text: item.text,
            ui: Array.isArray(item.ui) ? item.ui : undefined,
          })),
        ]);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [storageKey]);

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

  /**
   * Sends one turn to the agent. `payload.event` is a button/attachment action,
   * `payload.message` is typed text. `bubble` is the text shown as the teacher's own
   * message (omit for silent events such as "executed").
   */
  const sendTurn = useCallback(
    async (payload: TurnPayload, bubble?: string) => {
      if (loading) return;
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

        if (resData.conversationId) {
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
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
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
        setLoading(false);
        setAbortController(null);
      }
    },
    [loading, conversationId, effectiveCourseId, activeCourseId, storageKey, refreshData, setNotice]
  );

  const handleSendText = (textToSend?: string) => {
    const message = (textToSend ?? inputText).trim();
    if (!message || loading) return;
    setInputText('');
    void sendTurn({ message }, message);
  };

  // Chip / button actions
  const handleChoice = (slot: string, value: string, label: string) => {
    void sendTurn({ event: { type: 'choice', slot, value } }, label);
  };

  const handleSkip = () => void sendTurn({ event: { type: 'skip' } }, 'تخطي');
  const handleCancelFlow = () => void sendTurn({ event: { type: 'cancel' } }, 'إلغاء');

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
  const handleConfirmToken = async (token: string) => {
    const res = await fetch('/api/admin/ai/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const resData = await res.json().catch(() => null);
    if (!res.ok || !resData?.success) {
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
            <span className="ai-workspace-status-tag" title="المساعد الذكي جاهز">
              <span className="ai-workspace-status-dot" aria-hidden="true" />
              جاهز ومؤمّن
            </span>
          </div>
        </header>

        <div className="ai-workspace-tab-panel">
          <div
            className="ai-workspace-messages-container"
            tabIndex={0}
            role="log"
            aria-live="polite"
            aria-label="سجل المحادثة"
          >
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
                      blocks={msg.ui}
                      interactive={index === lastAssistantIndex}
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
                    disabled={loading}
                    onClick={() => void sendTurn(command.payload, command.bubble)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {command.label}
                  </button>
                );
              })}
            </div>

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
                className="agent-visually-hidden"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void handleFile(file);
                }}
              />
              <button
                type="button"
                className="agent-attach-btn"
                disabled={loading || !uploadRequested}
                onClick={() => attachInputRef.current?.click()}
                aria-label="إرفاق صورة"
                title={uploadRequested ? 'إرفاق صورة الكورس' : 'يتم تفعيل الإرفاق عندما يطلب المساعد صورة الكورس'}
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
                disabled={loading || !inputText.trim()}
                aria-label="إرسال الأمر للمساعد الذكي"
              >
                <Send size={18} />
              </button>
            </form>
          </footer>
        </div>
      </section>
    </div>
  );
}
