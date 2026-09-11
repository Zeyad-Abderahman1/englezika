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
  Upload,
  FileText,
  LoaderCircle,
  AlertCircle,
  CheckCircle,
  StopCircle,
  ArrowRight,
  ShieldAlert,
  Bot,
  Info,
} from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { CompoundPlanCard } from './CompoundPlanCard';
import { AssessmentPreviewModal } from './AssessmentPreviewModal';
import type { ConfirmationPreview } from '../../../lib/ai/preview-generator';
import type { GeneratedAssessmentPreview, GeneratedQuestion } from '../../../lib/ai/content-generator';
import './ai-assistant.css';

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  confirmationToken?: string;
  preview?: ConfirmationPreview;
  actionsExecuted?: Array<{ tool: string; result: any }>;
}

interface AIAssistantWorkspaceProps {
  activeCourseId?: string;
}

export function AIAssistantWorkspace({ activeCourseId }: AIAssistantWorkspaceProps) {
  const { data, refreshData, setNotice, setError: setGlobalError, aiEnabled: contextAiEnabled } = useAdmin();
  const courses = data?.courses || [];

  // Feature status check
  const [statusChecked, setStatusChecked] = useState(false);
  const [isAiEnabled, setIsAiEnabled] = useState(contextAiEnabled);

  // Tab & Chat State
  const [activeTab, setActiveTab] = useState<'chat' | 'assessment'>('chat');
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'مرحباً بك في المساعد الذكي لمعلم إنجليزيـكا! 👋\nيمكنني مساعدتك في صياغة الامتحانات من ملفات PDF، إعادة ترتيب الوحدات التعليمية، إضافة المحاضرات والواجبات، أو تعديل البيانات بسرعة وبشكل آمن.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // PDF Assessment State
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string>(activeCourseId || (courses[0]?.id || ''));
  const [questionCount, setQuestionCount] = useState(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [examType, setExamType] = useState<'exam' | 'quiz'>('quiz');
  const [generatedAssessment, setGeneratedAssessment] = useState<GeneratedAssessmentPreview | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Check AI feature availability
  useEffect(() => {
    if (contextAiEnabled) {
      setIsAiEnabled(true);
      setStatusChecked(true);
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
  useEffect(() => {
    if (!selectedCourseId && courses.length > 0) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

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
            courseId: selectedCourseId || activeCourseId,
          },
        }),
        signal: controller.signal,
      });

      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error(resData.error || 'تعذر التواصل مع المساعد الذكي');
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
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            text: `⚠️ خطأ: ${err.message || 'حدث خطأ غير متوقع أثناء معالجة الطلب.'}`,
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
        text: '✅ تم تأكيد وتنفيذ خطة العمل بنجاح! تم تطبيق التعديلات على قاعدة البيانات وتحديث النظام.',
      },
    ]);
  };

  // Upload and generate assessment from PDF
  const handleGeneratePdfAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile || loading) return;

    setLoading(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Step 1: Upload PDF to private storage
      const formData = new FormData();
      formData.append('file', pdfFile);

      const uploadRes = await fetch('/api/admin/ai/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.success) {
        throw new Error(uploadData.error || 'فشل رفع ملف PDF');
      }

      // Step 2: Request assessment generation from extracted content
      const genRes = await fetch('/api/admin/ai/generate-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempFileId: uploadData.tempFileId,
          title: `تقييم: ${uploadData.fileName}`,
          examType,
          questionCount,
          difficulty,
        }),
        signal: controller.signal,
      });

      const genData = await genRes.json();
      if (!genRes.ok || !genData.success) {
        throw new Error(genData.error || 'تعذر توليد التقييم من المستند');
      }

      setGeneratedAssessment(genData.assessment);
      setIsPreviewModalOpen(true);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setGlobalError(err.message || 'فشلت عملية إنشاء الأسئلة من الملف.');
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  // Save edited questions to course
  const handleSaveQuestionsToCourse = async (
    finalQuestions: GeneratedQuestion[],
    title: string,
    type: 'exam' | 'quiz'
  ) => {
    if (!selectedCourseId) {
      throw new Error('يرجى اختيار الدورة التعليمية المراد إدراج التقييم فيها');
    }

    // Step 1: Prepare confirmation for creating exam and questions
    const prepRes = await fetch('/api/admin/ai/prepare-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'compound_plan',
        actionPayload: {
          steps: [
            {
              tool: type === 'quiz' ? 'create_quiz' : 'create_exam',
              parameters: {
                courseId: selectedCourseId,
                title,
                durationMinutes: type === 'quiz' ? 15 : 45,
                passingScore: 50,
                maxAttempts: 2,
                examType: type,
              },
            },
          ],
        },
      }),
    });

    const prepData = await prepRes.json();
    if (!prepRes.ok || !prepData.success) {
      throw new Error(prepData.error || 'تعذر إعداد التأكيد لإدراج التقييم');
    }

    // Step 2: Execute confirmation
    const execRes = await fetch('/api/admin/ai/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: prepData.token }),
    });

    const execData = await execRes.json();
    if (!execRes.ok || !execData.success) {
      throw new Error(execData.error || 'فشل حفظ التقييم في الدورة');
    }

    await refreshData(1);
    setNotice(`تم إدراج ${type === 'quiz' ? 'الكويز' : 'الامتحان'} بنجاح في الدورة! يمكنك مراجعته الآن في قائمة الامتحانات.`);
    setActiveTab('chat');
  };

  // Loading state while checking status
  if (!statusChecked) {
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
  if (!isAiEnabled) {
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

        {/* Navigation Tabs */}
        <nav className="ai-workspace-tabs" role="tablist" aria-label="أقسام المساعد الذكي">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            className={`ai-workspace-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <Sparkles size={16} />
            <span>المحادثة والأوامر الذكية</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'assessment'}
            className={`ai-workspace-tab ${activeTab === 'assessment' ? 'active' : ''}`}
            onClick={() => setActiveTab('assessment')}
          >
            <FileText size={16} />
            <span>توليد امتحان من PDF</span>
          </button>
        </nav>

        {/* Tab 1: Chat & Intelligent Commands */}
        {activeTab === 'chat' && (
          <div className="ai-workspace-tab-panel" role="tabpanel">
            <div className="ai-workspace-messages-container" tabIndex={0} aria-label="سجل المحادثة">
              {messages.map((msg) => (
                <div key={msg.id} className={`ai-message-row ${msg.role}`}>
                  <div className="ai-message-avatar" aria-hidden="true">
                    {msg.role === 'assistant' ? <Sparkles size={16} /> : 'أنت'}
                  </div>
                  <div className="ai-message-bubble">
                    <div className="ai-message-text">{msg.text}</div>

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
                  📝 كويز سريع
                </button>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('أنشئ دورة جديدة باسم English Grade 10')}
                >
                  📚 إنشاء دورة جديدة
                </button>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('عدل سعر الدورة الحالية')}
                >
                  💰 تعديل السعر
                </button>
                <button
                  type="button"
                  className="ai-quick-chip"
                  onClick={() => handleSendMessage('أضف واجب منزلي بعد المحاضرة')}
                >
                  📑 إضافة واجب
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
        )}

        {/* Tab 2: PDF Assessment Generator */}
        {activeTab === 'assessment' && (
          <div className="ai-workspace-tab-panel" role="tabpanel">
            <form className="ai-upload-section" onSubmit={handleGeneratePdfAssessment}>
              <div className="ai-pdf-header-notice">
                <Info size={16} />
                <span>قم برفع مذكرة أو ملخص بصيغة PDF وسيقوم المساعد الذكي بتحليل المحتوى واستخراج الأسئلة بدقة.</span>
              </div>

              <div
                className={`ai-dropzone ${pdfFile ? 'has-file' : ''}`}
                onClick={() => document.getElementById('ai-workspace-pdf-input')?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    document.getElementById('ai-workspace-pdf-input')?.click();
                  }
                }}
                aria-label="اختر أو اسحب ملف المذكرة بصيغة PDF"
              >
                <Upload size={36} className="ai-dropzone-icon" />
                <h3 className="ai-dropzone-title">
                  {pdfFile ? pdfFile.name : 'اختر أو اسحب ملف المذكرة (PDF)'}
                </h3>
                <p className="ai-dropzone-subtitle">
                  يدعم ملفات PDF النصية حتى 15 ميجابايت. يُمنع المستندات الممسوحة ضوئياً (Scanned).
                </p>
                {pdfFile && (
                  <div className="ai-dropzone-file-tag">
                    <CheckCircle size={14} />
                    <span>تم تحديد الملف بنجاح ({Math.round(pdfFile.size / 1024)} كيلوبايت)</span>
                  </div>
                )}
                <input
                  id="ai-workspace-pdf-input"
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setPdfFile(f);
                  }}
                />
              </div>

              <div className="ai-pdf-controls-grid">
                {/* Target Course */}
                <div className="ai-pdf-form-group">
                  <label className="ai-pdf-label" htmlFor="ai-course-select">
                    الدورة التعليمية المستهدفة
                  </label>
                  <select
                    id="ai-course-select"
                    className="ai-pdf-select"
                    value={selectedCourseId}
                    onChange={(e) => setSelectedCourseId(e.target.value)}
                  >
                    {courses.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.grade})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assessment Type */}
                <div className="ai-pdf-form-group">
                  <label className="ai-pdf-label" htmlFor="ai-exam-type-select">
                    نوع التقييم
                  </label>
                  <select
                    id="ai-exam-type-select"
                    className="ai-pdf-select"
                    value={examType}
                    onChange={(e) => setExamType(e.target.value as 'exam' | 'quiz')}
                  >
                    <option value="quiz">كويز قصير (Quiz)</option>
                    <option value="exam">امتحان شامل (Exam)</option>
                  </select>
                </div>

                {/* Question Count */}
                <div className="ai-pdf-form-group">
                  <label className="ai-pdf-label" htmlFor="ai-question-range">
                    عدد الأسئلة المطلوبة: <span className="ai-pdf-count-badge">({questionCount})</span>
                  </label>
                  <input
                    id="ai-question-range"
                    type="range"
                    min="3"
                    max="20"
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    className="ai-pdf-range"
                  />
                  <div className="ai-pdf-range-labels">
                    <span>3 أسئلة</span>
                    <span>20 سؤالاً</span>
                  </div>
                </div>

                {/* Difficulty */}
                <div className="ai-pdf-form-group">
                  <span className="ai-pdf-label">مستوى الصعوبة</span>
                  <div className="ai-difficulty-selector">
                    {(['easy', 'medium', 'hard'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        className={`btn ${difficulty === lvl ? 'btn-primary' : 'btn-secondary'} ai-difficulty-btn`}
                        onClick={() => setDifficulty(lvl)}
                        aria-pressed={difficulty === lvl}
                      >
                        {lvl === 'easy' ? 'سهل' : lvl === 'medium' ? 'متوسط' : 'متقدم'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary ai-pdf-submit-btn"
                disabled={!pdfFile || loading}
              >
                {loading ? (
                  <>
                    <LoaderCircle size={18} className="spin" />
                    <span>جاري تحليل المستند وتوليد الأسئلة...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    <span>تحليل المذكرة وتوليد الأسئلة</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Generated Assessment Modal */}
      {generatedAssessment && (
        <AssessmentPreviewModal
          assessment={generatedAssessment}
          targetCourseId={selectedCourseId}
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          onSaveToCourse={handleSaveQuestionsToCourse}
        />
      )}
    </div>
  );
}
