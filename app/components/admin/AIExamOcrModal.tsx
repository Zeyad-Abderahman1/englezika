'use client';

import { useState, useRef, useMemo, ChangeEvent, DragEvent } from 'react';
import {
  X,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  Save,
  LoaderCircle,
  Layers,
  ArrowLeftRight,
  BookOpen,
  Image as ImageIcon,
  Camera,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import type { ExtractedQuestion } from '../../lib/exam-ocr';

type Course = {
  id: string;
  title: string;
  grade: string;
};

type Video = {
  id: string;
  courseId: string;
  title: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  courses: Course[];
  videos: Video[];
  initialCourseId?: string;
  onExamSaved?: (examId: string) => void;
};

type ImageFileItem = {
  id: string;
  file: File;
  previewUrl: string;
};

export function AIExamOcrModal({
  isOpen,
  onClose,
  courses,
  videos,
  initialCourseId,
  onExamSaved,
}: Props) {
  // Placement & Meta state
  const [selectedCourseId, setSelectedCourseId] = useState(initialCourseId || courses[0]?.id || '');
  const [scopeType, setScopeType] = useState<'all_lectures' | 'lecture_range'>('lecture_range');
  const [fromVideoId, setFromVideoId] = useState('');
  const [toVideoId, setToVideoId] = useState('');
  const [passingScore, setPassingScore] = useState(70);
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);

  // Images & OCR state
  const [images, setImages] = useState<ImageFileItem[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');

  // Questions Edit Studio state
  const [questions, setQuestions] = useState<ExtractedQuestion[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Collapsible Question Accordion state (temp_id -> boolean)
  const [collapsedQuestions, setCollapsedQuestions] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Filter lectures belonging to selected course
  const courseVideos = useMemo(() => {
    return videos.filter((v) => v.courseId === selectedCourseId);
  }, [videos, selectedCourseId]);

  // Handle course change
  const handleCourseChange = (newCourseId: string) => {
    setSelectedCourseId(newCourseId);
    const available = videos.filter((v) => v.courseId === newCourseId);
    if (available.length >= 2) {
      setFromVideoId(available[0].id);
      setToVideoId(available[1].id);
    } else if (available.length === 1) {
      setFromVideoId(available[0].id);
      setToVideoId('');
    } else {
      setFromVideoId('');
      setToVideoId('');
    }
  };

  // Handle 'From Lecture' change and auto-set 'To Lecture' to immediately following lecture
  const handleFromLectureChange = (selectedFromId: string) => {
    setFromVideoId(selectedFromId);
    const fromIndex = courseVideos.findIndex((v) => v.id === selectedFromId);
    if (fromIndex >= 0 && fromIndex + 1 < courseVideos.length) {
      setToVideoId(courseVideos[fromIndex + 1].id);
    }
  };

  // Auto-init lecture range when modal opens or courseVideos changes
  useState(() => {
    if (courseVideos.length >= 2 && !fromVideoId) {
      setFromVideoId(courseVideos[0].id);
      setToVideoId(courseVideos[1].id);
    }
  });

  // Handle file uploads
  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;
    const newFiles = Array.from(event.target.files);
    appendFiles(newFiles);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files) {
      const droppedFiles = Array.from(event.dataTransfer.files);
      appendFiles(droppedFiles);
    }
  };

  const appendFiles = (newFiles: File[]) => {
    const valid = newFiles.filter((f) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(f.type)
    );
    if (!valid.length) {
      setOcrError('يرجى اختيار صور بصيغة PNG أو JPEG أو WEBP فقط.');
      return;
    }
    const mapped: ImageFileItem[] = valid.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...mapped].slice(0, 10));
    setOcrError('');
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  };

  // Run AI OCR
  const runAiOcr = async () => {
    if (!images.length) {
      setOcrError('يرجى إضافة صورة واحدة على الأقل للاستخراج.');
      return;
    }
    setIsOcrLoading(true);
    setOcrError('');
    try {
      const formData = new FormData();
      for (const item of images) {
        formData.append('images', item.file);
      }

      const res = await fetch('/api/admin/exams/ocr', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'تعذر استخراج الأسئلة من الصور');
      }

      const extracted: ExtractedQuestion[] = data.questions || [];
      setQuestions(extracted);

      // Auto-generate title if currently empty
      if (!title.trim()) {
        const c = courses.find((x) => x.id === selectedCourseId);
        const fromV = videos.find((v) => v.id === fromVideoId);
        const toV = videos.find((v) => v.id === toVideoId);
        if (scopeType === 'lecture_range' && fromV && toV) {
          setTitle(`اختبار فاصل بين (${fromV.title}) و (${toV.title})`);
        } else if (c) {
          setTitle(`اختبار شامل - ${c.title}`);
        } else {
          setTitle('اختبار جديد');
        }
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بالذكاء الاصطناعي');
    } finally {
      setIsOcrLoading(false);
    }
  };

  // Question editing actions
  const updateQuestion = (index: number, patch: Partial<ExtractedQuestion>) => {
    setQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, ...patch } : q))
    );
  };

  const updateOptionText = (qIndex: number, optIndex: number, newText: string) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        const newOptions = [...q.options];
        const oldVal = newOptions[optIndex];
        newOptions[optIndex] = newText;
        const newCorrect = q.correct_answer === oldVal ? newText : q.correct_answer;
        return { ...q, options: newOptions, correct_answer: newCorrect };
      })
    );
  };

  const selectCorrectAnswer = (qIndex: number, optionVal: string) => {
    setQuestions((prev) =>
      prev.map((q, i) => (i === qIndex ? { ...q, correct_answer: optionVal } : q))
    );
  };

  const deleteQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    setQuestions((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy.map((q, i) => ({ ...q, sort_order: i + 1 }));
    });
  };

  const addNewQuestion = () => {
    const newQ: ExtractedQuestion = {
      temp_id: crypto.randomUUID(),
      sort_order: questions.length + 1,
      type: 'multiple_choice',
      prompt: '',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correct_answer: 'Option A',
      points: 1,
      ai_confidence: 'high',
      ai_explanation: 'سؤال أضيف يدوياً',
    };
    setQuestions((prev) => [...prev, newQ]);
  };

  // Accordion toggle helpers
  const isQuestionCollapsed = (id: string) => Boolean(collapsedQuestions[id]);
  const toggleQuestionCollapse = (id: string) => {
    setCollapsedQuestions((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const collapseAllQuestions = () => {
    const next: Record<string, boolean> = {};
    questions.forEach((q) => {
      next[q.temp_id] = true;
    });
    setCollapsedQuestions(next);
  };
  const expandAllQuestions = () => {
    setCollapsedQuestions({});
  };

  // Final submission
  const handleSaveExam = async () => {
    setSubmitError('');
    if (!title.trim()) {
      setSubmitError('يرجى كتابة عنوان للاختبار');
      return;
    }
    if (!questions.length) {
      setSubmitError('يرجى استخراج أو إضافة سؤال واحد على الأقل قبل الحفظ');
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt.trim()) {
        setSubmitError(`السؤال رقم ${i + 1} لا يحتوي على نص.`);
        setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
        return;
      }
      if (q.type === 'multiple_choice') {
        if (q.options.length < 2) {
          setSubmitError(`السؤال رقم ${i + 1} يحتاج إلى اختيارين على الأقل.`);
          setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
          return;
        }
        if (!q.correct_answer || !q.options.includes(q.correct_answer)) {
          setSubmitError(
            `السؤال رقم ${i + 1} لم يتم تحديد إجابة صحيحة له. يرجى الضغط على أحد الخيارات لتحديده كإجابة صحيحة.`
          );
          setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
          return;
        }
      } else if (!q.correct_answer?.trim()) {
        setSubmitError(`السؤال رقم ${i + 1} لا يحتوي على إجابة صحيحة.`);
        setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        courseId: selectedCourseId || null,
        durationMinutes: Number(durationMinutes) || 30,
        passingScore: Number(passingScore) || 50,
        scopeType,
        fromVideoId: scopeType === 'lecture_range' ? fromVideoId || null : null,
        toVideoId: scopeType === 'lecture_range' ? toVideoId || null : null,
        status: 'published',
        questions: questions.map((q, idx) => ({
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correctAnswer: q.correct_answer,
          points: q.points || 1,
          sortOrder: idx + 1,
        })),
      };

      let res = await fetch('/api/admin/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data = await res.json();
      if (res.status === 409 && data.code === 'PREREQUISITE_CONFLICT') {
        const confirmOverride = window.confirm(
          `${data.error || 'المحاضرة المستهدفة مرتبطة بالفعل باختبار إجباري آخر.'}\n\nهل ترغب في استبداله بهذا الاختبار؟`
        );
        if (confirmOverride) {
          res = await fetch('/api/admin/exams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, confirmOverride: true }),
          });
          data = await res.json();
        } else {
          setIsSubmitting(false);
          return;
        }
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'تعذر حفظ الاختبار');
      }

      onExamSaved?.(data.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'فشل حفظ الاختبار في قاعدة البيانات');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="ai-exam-modal-overlay" dir="rtl">
      <div className="ai-exam-modal-container">
        {/* Modal Header */}
        <header className="ai-exam-modal-header">
          <div className="header-badge-title">
            <span className="ai-badge">
              <Sparkles size={16} /> استخراج ذكي (Vision OCR)
            </span>
            <h2>إنشاء اختبار تفاعلي بالذكاء الاصطناعي وبوابة المحاضرات</h2>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="إغلاق النافذة">
            <X size={20} />
          </button>
        </header>

        {/* Modal Scrollable Body */}
        <div className="ai-exam-modal-body">
          {/* SECTION 1: Placement and Passing Score Config */}
          <section className="config-section">
            <h3 className="section-title">
              <Layers size={18} /> 1. نطاق الامتحان وبوابة المحاضرات ونسبة النجاح
            </h3>

            {/* Course Selector */}
            <div className="placement-grid">
              <div className="form-group">
                <label>
                  <BookOpen size={16} /> الدورة التعليمية (الكورس):
                </label>
                <select
                  value={selectedCourseId}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  className="custom-select"
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title} ({course.grade})
                    </option>
                  ))}
                </select>
              </div>

              {/* Scope Toggle: All Lectures vs Lecture Range */}
              <div className="form-group">
                <label>
                  <ArrowLeftRight size={16} /> نطاق الاختبار:
                </label>
                <div className="ai-segments" role="group" aria-label="نطاق الاختبار">
                  <button
                    type="button"
                    className={`ai-segment-btn ${scopeType === 'all_lectures' ? 'active' : ''}`}
                    onClick={() => setScopeType('all_lectures')}
                    aria-pressed={scopeType === 'all_lectures'}
                  >
                    جميع المحاضرات
                  </button>
                  <button
                    type="button"
                    className={`ai-segment-btn ${scopeType === 'lecture_range' ? 'active' : ''}`}
                    onClick={() => setScopeType('lecture_range')}
                    aria-pressed={scopeType === 'lecture_range'}
                  >
                    نطاق محاضرات
                  </button>
                </div>
              </div>
            </div>

            {/* Lecture Range Selectors (Visible only when scope_type === 'lecture_range') */}
            {scopeType === 'lecture_range' && (
              <div className="lecture-range-container">
                <div className="range-dropdown-row">
                  <div className="form-group">
                    <label>من المحاضرة:</label>
                    <select
                      value={fromVideoId}
                      onChange={(e) => handleFromLectureChange(e.target.value)}
                      className="custom-select"
                    >
                      {courseVideos.length === 0 ? (
                        <option value="">لا توجد محاضرات في هذا الكورس</option>
                      ) : (
                        courseVideos.map((video, idx) => (
                          <option key={video.id} value={video.id}>
                            المحاضرة {idx + 1} - {video.title}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <span className="range-separator">➔ فاصل بينهما ➔</span>

                  <div className="form-group">
                    <label>إلى المحاضرة (تُقفل بالاختبار):</label>
                    <select
                      value={toVideoId}
                      onChange={(e) => setToVideoId(e.target.value)}
                      className="custom-select"
                    >
                      {courseVideos.length === 0 ? (
                        <option value="">لا توجد محاضرات في هذا الكورس</option>
                      ) : (
                        courseVideos.map((video, idx) => (
                          <option key={video.id} value={video.id}>
                            المحاضرة {idx + 1} - {video.title}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
                <p className="inter-lecture-hint">
                  🔒 سيتم قفل المحاضرة التالية إجبارياً على الطالب حتى يجتاز هذا الامتحان بنسبة لا تقل عن {passingScore}%.
                </p>
              </div>
            )}

            {/* Meta: Title, Duration, Passing Score */}
            <div className="meta-grid">
              <div className="form-group">
                <label>عنوان الاختبار:</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: اختبار شامل على Unit 1 Grammar"
                  className="custom-input"
                />
              </div>

              <div className="form-group">
                <label>المدة (بالدقائق):</label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="custom-input"
                />
              </div>

              <div className="form-group">
                <label>
                  نسبة النجاح المطلوبة: <span className="passing-badge">{passingScore}%</span>
                </label>
                <div className="ai-pass-stepper-wrap">
                  <div className="ai-count-control">
                    <button
                      type="button"
                      onClick={() => setPassingScore((prev) => Math.max(10, prev - 5))}
                      disabled={passingScore <= 10}
                      aria-label="تقليل نسبة النجاح"
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      step={5}
                      value={passingScore}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!isNaN(val)) setPassingScore(Math.max(10, Math.min(100, val)));
                      }}
                      aria-label="نسبة النجاح"
                    />
                    <button
                      type="button"
                      onClick={() => setPassingScore((prev) => Math.min(100, prev + 5))}
                      disabled={passingScore >= 100}
                      aria-label="زيادة نسبة النجاح"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="ai-quick-pills" role="group" aria-label="خيارات نسبة النجاح السريعة">
                    {[50, 60, 70, 80].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`ai-quick-pill ${passingScore === preset ? 'active' : ''}`}
                        onClick={() => setPassingScore(preset)}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 2: Multi-Image Upload Dropzone & Touch Pickers */}
          <section className="upload-section">
            <h3 className="section-title">
              <ImageIcon size={18} /> 2. رفع صور أوراق الأسئلة (صورة أو أكثر)
            </h3>

            {/* Hidden native pickers */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {/* Desktop / Tablet Dropzone Box */}
            <div
              className="dropzone-box"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={32} className="dropzone-icon" />
              <h4>اسحب وأفلت صور أوراق الأسئلة هنا أو اضغط للاختيار</h4>
              <p>يدعم حتى 10 صور بدقة عالية (PNG, JPEG, WEBP - بحد أقصى 10MB لكل صورة)</p>
            </div>

            {/* Touch Action Buttons for Mobile / Tablet */}
            <div className="mobile-upload-actions">
              <button
                type="button"
                className="btn btn-touch-upload"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={18} />
                <span>التقاط بالكاميرا</span>
              </button>
              <button
                type="button"
                className="btn btn-touch-upload"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon size={18} />
                <span>اختيار من المعرض</span>
              </button>
            </div>

            {/* Image Thumbnails Horizontal Scrolling Track */}
            {images.length > 0 && (
              <div className="thumbnails-scroll-container">
                <div className="thumbnails-grid">
                  {images.map((img, idx) => (
                    <div key={img.id} className="thumbnail-card">
                      <span className="thumbnail-idx">{idx + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.previewUrl} alt={`Page ${idx + 1}`} />
                      <button
                        type="button"
                        className="thumb-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(img.id);
                        }}
                        title="حذف الصورة"
                        aria-label="حذف الصورة"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Button for OCR */}
            <div className="ocr-action-bar">
              <button
                type="button"
                className="btn btn-ocr"
                onClick={runAiOcr}
                disabled={!images.length || isOcrLoading}
              >
                {isOcrLoading ? (
                  <>
                    <LoaderCircle size={18} className="spinner" />
                    جاري استخراج الأسئلة وحلها بالذكاء الاصطناعي...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    استخراج الأسئلة بالذكاء الاصطناعي (OCR & Solve)
                  </>
                )}
              </button>
              {ocrError && <div className="error-banner">{ocrError}</div>}
            </div>
          </section>

          {/* SECTION 3: Interactive Preview & Edit Studio */}
          <section className="preview-studio-section">
            <div className="studio-header">
              <div>
                <h3 className="section-title" style={{ margin: 0, border: 'none' }}>
                  <CheckCircle2 size={18} /> 3. استوديو مراجعة وتعديل الأسئلة ({questions.length} سؤال)
                </h3>
                <p className="studio-subtitle">
                  راجع كل سؤال مستخرج حرفياً، يمكنك تعديل نص السؤال أو الخيارات أو تغيير الإجابة الصحيحة بنقرة زر.
                </p>
              </div>

              {/* Studio Quick Tools for Mobile and Desktop */}
              <div className="studio-quick-tools">
                {questions.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn-quick-tool"
                      onClick={collapseAllQuestions}
                      title="طي كل الأسئلة"
                    >
                      <Minimize2 size={14} /> طي الكل
                    </button>
                    <button
                      type="button"
                      className="btn-quick-tool"
                      onClick={expandAllQuestions}
                      title="توسيع كل الأسئلة"
                    >
                      <Maximize2 size={14} /> توسيع الكل
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-outline-sm" onClick={addNewQuestion}>
                  <Plus size={16} /> إضافة سؤال يدوي
                </button>
              </div>
            </div>

            {/* Questions List */}
            {questions.length === 0 ? (
              <div className="empty-questions-state">
                <Sparkles size={32} className="empty-sparkle" />
                <h4>لا توجد أسئلة مستخرجة بعد</h4>
                <p>ارفع صور أوراق الأسئلة بالأعلى واضغط &quot;استخراج الأسئلة بالذكاء الاصطناعي&quot; أو أضف سؤالاً يدوياً.</p>
              </div>
            ) : (
              <div className="questions-card-list">
                {questions.map((q, qIndex) => {
                  const collapsed = isQuestionCollapsed(q.temp_id);
                  return (
                    <article
                      key={q.temp_id}
                      className={`question-card ${collapsed ? 'is-collapsed' : ''}`}
                    >
                      {/* Card Top Bar / Summary Header */}
                      <div
                        className="card-topbar clickable-header"
                        onClick={() => toggleQuestionCollapse(q.temp_id)}
                      >
                        <div className="card-meta">
                          <span className="q-badge">سؤال {qIndex + 1}</span>
                          {q.ai_confidence && (
                            <span className={`confidence-pill ${q.ai_confidence}`}>
                              دقة الذكاء الاصطناعي: {q.ai_confidence === 'high' ? 'عالية' : q.ai_confidence === 'medium' ? 'متوسطة' : 'منخفضة'}
                            </span>
                          )}
                          {collapsed && (
                            <span className="collapsed-answer-chip">
                              <CheckCircle2 size={13} /> الإجابة: {q.correct_answer || 'لم تحدد'}
                            </span>
                          )}
                        </div>

                        <div className="card-controls" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="icon-ctrl"
                            onClick={() => moveQuestion(qIndex, 'up')}
                            disabled={qIndex === 0}
                            title="تحريك لأعلى"
                            aria-label="تحريك لأعلى"
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-ctrl"
                            onClick={() => moveQuestion(qIndex, 'down')}
                            disabled={qIndex === questions.length - 1}
                            title="تحريك لأسفل"
                            aria-label="تحريك لأسفل"
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-ctrl delete"
                            onClick={() => deleteQuestion(qIndex)}
                            title="حذف هذا السؤال"
                            aria-label="حذف هذا السؤال"
                          >
                            <Trash2 size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-ctrl toggle-expand"
                            onClick={() => toggleQuestionCollapse(q.temp_id)}
                            title={collapsed ? 'توسيع للتعديل' : 'طي السؤال'}
                            aria-label={collapsed ? 'توسيع للتعديل' : 'طي السؤال'}
                          >
                            {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                          </button>
                        </div>
                      </div>

                      {/* If collapsed: show compact prompt snippet */}
                      {collapsed && (
                        <div
                          className="collapsed-snippet"
                          dir="ltr"
                          onClick={() => toggleQuestionCollapse(q.temp_id)}
                        >
                          {q.prompt ? (
                            <span>{q.prompt.length > 95 ? `${q.prompt.slice(0, 95)}...` : q.prompt}</span>
                          ) : (
                            <span className="text-muted">(سؤال فارغ - اضغط هنا للتعديل)</span>
                          )}
                        </div>
                      )}

                      {/* If expanded: show full prompt and touch-optimized options editor */}
                      {!collapsed && (
                        <div className="expanded-editor-content">
                          {q.ai_explanation && (
                            <div className="explanation-pill-row">
                              <span className="explanation-pill" title={q.ai_explanation}>
                                💡 {q.ai_explanation}
                              </span>
                            </div>
                          )}

                          {/* Question Prompt Editor */}
                          <div className="prompt-editor-group">
                            <label>نص السؤال (مطابق تماماً للأصل):</label>
                            <textarea
                              dir="ltr"
                              className="prompt-textarea"
                              rows={2}
                              value={q.prompt}
                              onChange={(e) => updateQuestion(qIndex, { prompt: e.target.value })}
                              placeholder="Type question stem..."
                            />
                          </div>

                          {/* Multiple-Choice Options Editor */}
                          <div className="options-editor-group">
                            <label>الخيارات (المس الخيار أو الزر لتحديد الإجابة الصحيحة):</label>
                            <div className="options-list-grid">
                              {q.options.map((opt, optIndex) => {
                                const isCorrect = q.correct_answer === opt;
                                const letterLabel = ['A', 'B', 'C', 'D', 'E', 'F'][optIndex] || `${optIndex + 1}`;
                                return (
                                  <div
                                    key={optIndex}
                                    className={`option-row ${isCorrect ? 'is-correct-option' : ''}`}
                                    onClick={() => selectCorrectAnswer(qIndex, opt)}
                                  >
                                    <button
                                      type="button"
                                      className={`correct-radio-btn ${isCorrect ? 'checked' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        selectCorrectAnswer(qIndex, opt);
                                      }}
                                      title={isCorrect ? 'هذه هي الإجابة الصحيحة' : 'اجعلها الإجابة الصحيحة'}
                                      aria-label={`تحديد ${letterLabel} كإجابة صحيحة`}
                                    >
                                      {isCorrect ? <CheckCircle2 size={20} /> : letterLabel}
                                    </button>
                                    <input
                                      type="text"
                                      dir="ltr"
                                      value={opt}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => updateOptionText(qIndex, optIndex, e.target.value)}
                                      className="option-input"
                                    />
                                    {isCorrect ? (
                                      <span className="correct-tag">الإجابة الصحيحة</span>
                                    ) : (
                                      <span className="touch-select-hint">اختر كصحيحة</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Modal Sticky Bottom Action Bar (One-Thumb Operation) */}
        <footer className="ai-exam-modal-footer">
          {submitError && (
            <div className="submit-error-msg">
              <AlertCircle size={16} /> {submitError}
            </div>
          )}
          <div className="footer-btns">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              إلغاء
            </button>

            {questions.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary btn-sticky-primary"
                onClick={handleSaveExam}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle size={18} className="spinner" /> جاري حفظ الاختبار...
                  </>
                ) : (
                  <>
                    <Save size={18} /> حفظ الاختبار ({questions.length} سؤال)
                  </>
                )}
              </button>
            ) : (
              images.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ocr btn-sticky-ocr"
                  onClick={runAiOcr}
                  disabled={isOcrLoading}
                >
                  {isOcrLoading ? (
                    <>
                      <LoaderCircle size={18} className="spinner" /> جاري الاستخراج...
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} /> استخراج الأسئلة بالذكاء الاصطناعي
                    </>
                  )}
                </button>
              )
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
