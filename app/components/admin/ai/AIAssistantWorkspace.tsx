'use client';

/**
 * app/components/admin/ai/AIAssistantWorkspace.tsx
 *
 * Dedicated full-page AI Assistant workspace for Englizeka Admin.
 * Provides:
 * - Conversational intelligent commands and chat with multi-turn memory
 * - Compound plan review and one-click durable confirmation execution
 * - PDF assessment generation from uploaded study guides
 * - Editable assessment preview modal and course saving
 * - Safe disabled-AI fallback when AI_ASSISTANT_ENABLED is false
 * - Full RTL support and responsive mobile layout
 */

import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { CompoundPlanCard } from './CompoundPlanCard';
import { AssistantMessageContent } from './AssistantMessageContent';
import type { ConfirmationPreview } from '../../../lib/ai/preview-generator';
import './ai-assistant.css';

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  confirmationToken?: string;
  preview?: ConfirmationPreview;
  actionsExecuted?: Array<{ tool: string; result: unknown }>;
}

interface AIAssistantWorkspaceProps {
  activeCourseId?: string;
}

export function AIAssistantWorkspace({ activeCourseId }: AIAssistantWorkspaceProps) {
  const { data, refreshData, setNotice, aiEnabled: contextAiEnabled } = useAdmin();
  const courses = data?.courses || [];

  // Feature status check
  const [statusChecked, setStatusChecked] = useState(contextAiEnabled);
  const [isAiEnabled, setIsAiEnabled] = useState(contextAiEnabled);

  // Chat state
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '## أهلاً بك في المساعد الذكي\n\nيمكنني مساعدتك في صياغة الامتحانات من ملفات PDF، إعادة ترتيب الوحدات التعليمية، إضافة المحاضرات والواجبات، أو تعديل البيانات بسرعة وبشكل آمن.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Keep selected course in sync if courses load late
  const effectiveCourseId = activeCourseId || courses[0]?.id || '';

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cancel generation in flight
  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setLoading(false);
  };

  // Send conversational prompt to AI Chat
  const handleSendMessage = async (textToSend?: string) => {
    const message = (textToSend || inputText).trim();
    if (!message || loading) return;

    setInputText('');
    const userMsgId = `user_${Date.now()}`;
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', text: message }]);
    setLoading(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const res = await fetch('/api/admin/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId,
          context: {
            courseId: effectiveCourseId || activeCourseId,
          },
        }),
        signal: controller.signal,
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error('تعذر التواصل مع المساعد الذكي');
      }

      if (resData.conversationId) {
        setConversationId(resData.conversationId);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          text: resData.reply || 'تمت معالجة الطلب.',
          confirmationToken: resData.confirmationToken,
          preview: resData.preview,
          actionsExecuted: resData.actionsExecuted,
        },
      ]);

      // If safe low-risk actions were executed directly, refresh admin data
      if (resData.actionsExecuted && resData.actionsExecuted.length > 0) {
        await refreshData(1);
        setNotice('تم تطبيق التغييرات بنجاح وتحديث لوحة الإدارة.');
      }
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            text: 'تعذر إكمال الطلب\n\nحاول مرة أخرى بعد قليل.',
          },
        ]);
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  // Confirm and execute a compound action or risky tool call
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
                مساعد محلي لإدارة المحتوى والاختبارات — خصوصية تامة وحماية مؤكدة
              </p>
            </div>
          </div>
          <div className="ai-workspace-header-meta">
            <span className="ai-workspace-status-tag" title="المساعد الذكي يعمل محلياً">
              <span className="ai-workspace-status-dot" aria-hidden="true" />
              جاهز ومؤمّن
            </span>
          </div>
        </header>

        <div className="ai-workspace-tab-panel">
            <div className="ai-workspace-messages-container" tabIndex={0} aria-label="سجل المحادثة">
              {messages.map((msg) => (
                <div key={msg.id} className={`ai-message-row ${msg.role}`}>
                  <div className="ai-message-avatar" aria-hidden="true">
                    {msg.role === 'assistant' ? <Bot size={16} /> : <UserRound size={16} />}
                  </div>
                  <div className="ai-message-bubble">
                    {msg.role === 'assistant' ? (
                      <AssistantMessageContent text={msg.text} actionsExecuted={msg.actionsExecuted} />
                    ) : (
                      <p className="ai-message-text">{msg.text}</p>
                    )}

                    {/* Display compound plan card if confirmation is required */}
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
                  <div className="ai-status-indicator">
                    <LoaderCircle size={16} className="spin" />
                    <span>المساعد الذكي يحلل الأمر ويجهز الخطة...</span>
                  </div>
                  <button
                    type="button"
                    className="ai-cancel-btn"
                    onClick={handleCancel}
                    aria-label="إلغاء العملية الحالية"
                  >
                    <StopCircle size={14} style={{ display: 'inline', marginLeft: 4 }} />
                    إلغاء
                  </button>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Footer, Chips & Input */}
            <footer className="ai-workspace-footer">
              <div className="ai-workspace-quick-prompts" aria-label="أوامر مقترحة">
                <span className="ai-workspace-quick-label">أوامر سريعة:</span>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('أنشئ كويز سريع مكون من 5 أسئلة للمحاضرة الحالية')}
                >
                  <ListChecks size={15} aria-hidden="true" />
                  كويز سريع
                </button>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('أنشئ دورة جديدة باسم English Grade 10')}
                >
                  <BookPlus size={15} aria-hidden="true" />
                  إنشاء دورة جديدة
                </button>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('عدل سعر الدورة الحالية')}
                >
                  <BadgeDollarSign size={15} aria-hidden="true" />
                  تعديل السعر
                </button>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('أضف واجب منزلي بعد المحاضرة')}
                >
                  <ClipboardPlus size={15} aria-hidden="true" />
                  إضافة واجب
                </button>
              </div>

              <form
                className="ai-input-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
              >
                <textarea
                  ref={textareaRef}
                  className="ai-input-textarea"
                  placeholder="اكتب أمراً للمساعد الذكي باللغة العربية أو الإنجليزية... (اضغط Enter للإرسال)"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={2}
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
