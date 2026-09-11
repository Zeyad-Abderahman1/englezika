'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Send,
  Upload,
  FileText,
  LoaderCircle,
  AlertCircle,
  CheckCircle,
  HelpCircle,
  Layers,
  StopCircle,
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

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourseId?: string;
}

export function AIAssistantDrawer({ isOpen, onClose, activeCourseId }: AIAssistantDrawerProps) {
  const { data, refreshData, setNotice, setError: setGlobalError } = useAdmin();
  const courses = data?.courses || [];

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

  // Auto-scroll on new messages
  useEffect(() => {
    if (isOpen && activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, activeTab]);

  // Keyboard accessibility: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPreviewModalOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPreviewModalOpen, onClose]);

  if (!isOpen) return null;

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

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'تعذر التواصل مع المساعد الذكي');
      }

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          text: data.reply || 'تمت معالجة الطلب.',
          confirmationToken: data.confirmationToken,
          preview: data.preview,
          actionsExecuted: data.actionsExecuted,
        },
      ]);

      // If safe low-risk actions were executed directly, refresh admin data
      if (data.actionsExecuted && data.actionsExecuted.length > 0) {
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

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشل تطبيق الإجراء المؤكد على المنصة');
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

  return (
    <>
      <div className="ai-drawer-overlay" onClick={onClose} role="presentation">
        <div
          className="ai-drawer-container"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="المساعد الذكي للمعلم"
        >
          {/* Header */}
          <div className="ai-drawer-header">
            <div className="ai-drawer-title-group">
              <div className="ai-drawer-badge">
                <Sparkles size={20} />
              </div>
              <div>
                <h3 className="ai-drawer-title">المساعد الذكي للمعلم</h3>
                <div className="ai-drawer-subtitle">يعمل محلياً بأعلى معايير الخصوصية والأمان</div>
              </div>
            </div>
            <button
              type="button"
              className="ai-drawer-close-btn"
              onClick={onClose}
              aria-label="إغلاق المساعد الذكي"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tabs */}
          <div className="ai-drawer-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chat'}
              className={`ai-drawer-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <Sparkles size={16} />
              <span>المحادثة والأوامر الذكية</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'assessment'}
              className={`ai-drawer-tab ${activeTab === 'assessment' ? 'active' : ''}`}
              onClick={() => setActiveTab('assessment')}
            >
              <FileText size={16} />
              <span>توليد امتحان من PDF</span>
            </button>
          </div>

          {/* Tab 1: Chat & Commands */}
          {activeTab === 'chat' && (
            <>
              <div className="ai-messages-container">
                {messages.map((msg) => (
                  <div key={msg.id} className={`ai-message-row ${msg.role}`}>
                    <div className="ai-message-avatar">
                      {msg.role === 'assistant' ? <Sparkles size={16} /> : 'أنت'}
                    </div>
                    <div className="ai-message-bubble">
                      <div>{msg.text}</div>

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
                  <div className="ai-status-banner">
                    <div className="ai-status-indicator">
                      <LoaderCircle size={16} className="spin" />
                      <span>المساعد الذكي يحلل الأمر ويجهز الخطة...</span>
                    </div>
                    <button type="button" className="ai-cancel-btn" onClick={handleCancel}>
                      <StopCircle size={14} style={{ display: 'inline', marginLeft: 4 }} />
                      إلغاء
                    </button>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Footer & Input */}
              <div className="ai-drawer-footer">
                <div className="ai-quick-prompts">
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
                    className="ai-input-textarea"
                    placeholder="اكتب أمراً للمساعد الذكي باللغة العربية أو الإنجليزية..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="ai-submit-btn"
                    disabled={loading || !inputText.trim()}
                    aria-label="إرسال الأمر"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </>
          )}

          {/* Tab 2: PDF Assessment Generator */}
          {activeTab === 'assessment' && (
            <form className="ai-upload-section" onSubmit={handleGeneratePdfAssessment}>
              <div
                className="ai-dropzone"
                onClick={() => document.getElementById('ai-pdf-input')?.click()}
              >
                <Upload size={32} className="ai-dropzone-icon" />
                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 700 }}>
                  {pdfFile ? pdfFile.name : 'اختر أو اسحب ملف المذكرة (PDF)'}
                </h4>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
                  يدعم ملفات PDF النصية حتى 15 ميجابايت. يُمنع المستندات الممسوحة ضوئياً (Scanned).
                </p>
                <input
                  id="ai-pdf-input"
                  type="file"
                  accept="application/pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setPdfFile(f);
                  }}
                />
              </div>

              {/* Target Course */}
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1 block">الدورة المستهدفة</label>
                <select
                  className="ai-question-prompt-input"
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

              {/* Assessment Type & Count */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="text-xs text-slate-400 font-semibold mb-1 block">نوع التقييم</label>
                  <select
                    className="ai-question-prompt-input"
                    value={examType}
                    onChange={(e) => setExamType(e.target.value as 'exam' | 'quiz')}
                  >
                    <option value="quiz">كويز قصير (Quiz)</option>
                    <option value="exam">امتحان شامل (Exam)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-semibold mb-1 block">
                    عدد الأسئلة: ({questionCount})
                  </label>
                  <input
                    type="range"
                    min="3"
                    max="20"
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#38bdf8' }}
                  />
                </div>
              </div>

              {/* Difficulty */}
              <div>
                <label className="text-xs text-slate-400 font-semibold mb-1 block">مستوى الصعوبة</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['easy', 'medium', 'hard'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`btn text-xs ${difficulty === lvl ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setDifficulty(lvl)}
                      style={{ flex: 1 }}
                    >
                      {lvl === 'easy' ? 'سهل' : lvl === 'medium' ? 'متوسط' : 'متقدم'}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary mt-2"
                disabled={!pdfFile || loading}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
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
          )}
        </div>
      </div>

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
    </>
  );
}
