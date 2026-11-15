'use client';

import { useState, useRef, useMemo, useEffect, ChangeEvent, DragEvent } from 'react';
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
import {
  mergeBatches,
  planBatches,
  type BatchResult,
  type BatchWindow,
  type OcrWarning,
} from '../../lib/exam-ocr-merge';

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

type BatchView = {
  window: BatchWindow;
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
};

class BatchError extends Error {
  readonly retryable: boolean;
  readonly status: number;
  constructor(message: string, retryable: boolean, status = 0) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

/** Questions rendered per step in the review studio (all questions are kept and saved). */
const REVIEW_PAGE_SIZE = 40;
/** Batches processed at the same time. */
const OCR_CONCURRENCY = 2;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Downscales large photos (long edge 2200px, JPEG) so each batch request stays small and fast. */
async function prepareImage(file: File): Promise<File> {
  try {
    if (file.size <= 1_200_000 || typeof createImageBitmap !== 'function') return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function postBatch(files: File[]): Promise<ExtractedQuestion[]> {
  const formData = new FormData();
  for (const file of files) formData.append('images', file);

  let res: Response;
  try {
    res = await fetch('/api/admin/exams/ocr', { method: 'POST', body: formData });
  } catch {
    throw new BatchError('تعذر الاتصال بالخادم. تحقق من الإنترنت.', true);
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok) return (data.questions || []) as ExtractedQuestion[];

  const retryable =
    typeof data?.retryable === 'boolean' ? data.retryable : res.status >= 500 || res.status === 429 || res.status === 408;
  throw new BatchError(data?.error || 'تعذر استخراج الأسئلة من الصور', retryable, res.status);
}

/**
 * Extracts one window of pages. Retries transient failures with backoff; later
 * attempts send the pages one by one (smaller request, smaller answer).
 */
async function extractWindow(files: File[], window: BatchWindow): Promise<ExtractedQuestion[]> {
  let lastError: BatchError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt === 1 || files.length === 1) return await postBatch(files);
      const parts: BatchResult[] = [];
      for (let index = 0; index < files.length; index++) {
        parts.push({
          window: { start: window.start + index, end: window.start + index + 1 },
          questions: await postBatch([files[index]]),
        });
      }
      return mergeBatches(parts).questions;
    } catch (error) {
      lastError = error instanceof BatchError ? error : new BatchError('تعذر استخراج الأسئلة من الصور', true);
      if (!lastError.retryable && lastError.status !== 413) break;
      await sleep(1000 * attempt);
    }
  }
  throw lastError ?? new BatchError('تعذر استخراج الأسئلة من الصور', true);
}

function pagesLabel(window: BatchWindow): string {
  return window.end - window.start <= 1 ? String(window.start + 1) : window.start + 1 + '–' + window.end;
}

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
  const [showReview, setShowReview] = useState(true);

  // Images & OCR state
  const [images, setImages] = useState<ImageFileItem[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const [batches, setBatches] = useState<BatchView[]>([]);
  const [ocrWarnings, setOcrWarnings] = useState<OcrWarning[]>([]);
  const [ocrSummary, setOcrSummary] = useState('');
  const [questionsSoFar, setQuestionsSoFar] = useState(0);
  const [visibleCount, setVisibleCount] = useState(REVIEW_PAGE_SIZE);
  const batchResultsRef = useRef<Map<number, BatchResult>>(new Map());
  const preparedRef = useRef<Map<string, File>>(new Map());
  const editedRef = useRef(false);

  // Questions Edit Studio state
  const [questions, setQuestions] = useState<ExtractedQuestion[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Collapsible Question Accordion state (temp_id -> boolean)
  const [collapsedQuestions, setCollapsedQuestions] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Lock background scrolling and support keyboard dismissal while open.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

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
    setImages((prev) => [...prev, ...mapped]);
    setOcrError('');
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  };

  const preparedFor = async (item: ImageFileItem): Promise<File> => {
    const cached = preparedRef.current.get(item.id);
    if (cached) return cached;
    const prepared = await prepareImage(item.file);
    preparedRef.current.set(item.id, prepared);
    return prepared;
  };

  const applyMerged = (results: Map<number, BatchResult>, allWindows: BatchWindow[]) => {
    const merged = mergeBatches([...results.values()]);
    setQuestions(merged.questions);
    setOcrWarnings(merged.warnings);
    const failed = allWindows.length - results.size;
    setOcrSummary(
      failed > 0
        ? 'تم استخراج ' + merged.questions.length + ' سؤال حتى الآن — فشلت ' + failed + ' دفعة. أعد محاولة الدفعات الفاشلة.'
        : 'تم استخراج ' + merged.questions.length + ' سؤال'
    );
    setVisibleCount(REVIEW_PAGE_SIZE);
    editedRef.current = false;
  };

  // Runs the given windows with limited concurrency and live progress.
  const runWindows = async (allWindows: BatchWindow[], indices: number[]) => {
    const items = images;
    let cursor = 0;

    const worker = async () => {
      while (cursor < indices.length) {
        const index = indices[cursor++];
        const window = allWindows[index];
        setBatches((prev) => prev.map((b, i) => (i === index ? { ...b, status: 'running', error: undefined } : b)));
        try {
          const files = await Promise.all(items.slice(window.start, window.end).map(preparedFor));
          const extracted = await extractWindow(files, window);
          batchResultsRef.current.set(index, { window, questions: extracted });
          setBatches((prev) => prev.map((b, i) => (i === index ? { ...b, status: 'done' } : b)));
          setQuestionsSoFar(mergeBatches([...batchResultsRef.current.values()]).questions.length);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'تعذر استخراج الأسئلة من الصور';
          setBatches((prev) => prev.map((b, i) => (i === index ? { ...b, status: 'failed', error: message } : b)));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(OCR_CONCURRENCY, indices.length) }, worker));
  };

  const autoTitle = () => {
    if (title.trim()) return;
    const c = courses.find((x) => x.id === selectedCourseId);
    const fromV = videos.find((v) => v.id === fromVideoId);
    const toV = videos.find((v) => v.id === toVideoId);
    if (scopeType === 'lecture_range' && fromV && toV) {
      setTitle('اختبار فاصل بين (' + fromV.title + ') و (' + toV.title + ')');
    } else if (c) {
      setTitle('اختبار شامل - ' + c.title);
    } else {
      setTitle('اختبار جديد');
    }
  };

  // Run AI OCR: pages are sent in small overlapping batches, so any number of
  // pages / questions works and each request stays short.
  const runAiOcr = async () => {
    if (!images.length) {
      setOcrError('يرجى إضافة صورة واحدة على الأقل للاستخراج.');
      return;
    }
    setIsOcrLoading(true);
    setOcrError('');
    setOcrWarnings([]);
    setOcrSummary('');
    setQuestionsSoFar(0);

    const windows = planBatches(images.length);
    batchResultsRef.current = new Map();
    setBatches(windows.map((window) => ({ window, status: 'pending' as const })));

    try {
      await runWindows(
        windows,
        windows.map((_, index) => index)
      );
      if (batchResultsRef.current.size === 0) {
        throw new Error('تعذر استخراج الأسئلة من الصور. أعد المحاولة.');
      }
      applyMerged(batchResultsRef.current, windows);
      autoTitle();
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بالذكاء الاصطناعي');
    } finally {
      setIsOcrLoading(false);
    }
  };

  // Retry ONLY the batches that failed.
  const retryFailedBatches = async () => {
    const windows = batches.map((b) => b.window);
    const failedIndices = batches.flatMap((b, index) => (b.status === 'failed' ? [index] : []));
    if (!failedIndices.length) return;
    if (
      editedRef.current &&
      !window.confirm('إعادة دمج الصفحات الفاشلة ستستبدل تعديلاتك الحالية على الأسئلة. هل تريد المتابعة؟')
    ) {
      return;
    }
    setIsOcrLoading(true);
    setOcrError('');
    try {
      await runWindows(windows, failedIndices);
      applyMerged(batchResultsRef.current, windows);
    } finally {
      setIsOcrLoading(false);
    }
  };

  // Question editing actions
  const updateQuestion = (index: number, patch: Partial<ExtractedQuestion>) => {
    editedRef.current = true;
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
    editedRef.current = true;
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
    editedRef.current = true;
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
      explanation: '',
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
        setVisibleCount((count) => Math.max(count, i + 1));
        return;
      }
      if (q.type === 'multiple_choice') {
        if (q.options.length < 2) {
          setSubmitError(`السؤال رقم ${i + 1} يحتاج إلى اختيارين على الأقل.`);
          setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
        setVisibleCount((count) => Math.max(count, i + 1));
          return;
        }
        if (!q.correct_answer || !q.options.includes(q.correct_answer)) {
          setSubmitError(
            `السؤال رقم ${i + 1} لم يتم تحديد إجابة صحيحة له. يرجى الضغط على أحد الخيارات لتحديده كإجابة صحيحة.`
          );
          setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
        setVisibleCount((count) => Math.max(count, i + 1));
          return;
        }
      } else if (!q.correct_answer?.trim()) {
        setSubmitError(`السؤال رقم ${i + 1} لا يحتوي على إجابة صحيحة.`);
        setCollapsedQuestions((prev) => ({ ...prev, [q.temp_id]: false }));
        setVisibleCount((count) => Math.max(count, i + 1));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // Lecture gates may be selected in any order. Normalize them into a chronological
      // range (earlier lecture first, later lecture last) instead of blocking submission.
      let rangeStartVideoId = fromVideoId;
      let rangeEndVideoId = toVideoId;
      if (scopeType === 'lecture_range') {
        const fromIndex = courseVideos.findIndex((v) => v.id === fromVideoId);
        const toIndex = courseVideos.findIndex((v) => v.id === toVideoId);
        if (fromIndex >= 0 && toIndex >= 0) {
          rangeStartVideoId = courseVideos[Math.min(fromIndex, toIndex)].id;
          rangeEndVideoId = courseVideos[Math.max(fromIndex, toIndex)].id;
        }
      }

      const payload = {
        title: title.trim(),
        courseId: selectedCourseId || null,
        durationMinutes: Number(durationMinutes) || 30,
        passingScore: Number(passingScore) || 50,
        scopeType,
        fromVideoId: scopeType === 'lecture_range' ? rangeStartVideoId || null : null,
        toVideoId: scopeType === 'lecture_range' ? rangeEndVideoId || null : null,
        showReview,
        status: 'published',
        questions: questions.map((q, idx) => ({
          type: q.type,
          prompt: q.prompt,
          options: q.options,
          correctAnswer: q.correct_answer,
          explanation: q.explanation || '',
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
    <div
      className="ai-exam-modal-overlay"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-exam-ocr-title"
    >
      <div className="ai-exam-modal-container">
        {/* Modal Header */}
        <header className="ai-exam-modal-header">
          <div className="header-badge-title">
            <span className="ai-badge">
              <Sparkles size={16} /> استخراج ذكي (Vision OCR)
            </span>
            <h2 id="ai-exam-ocr-title">إنشاء اختبار تفاعلي بالذكاء الاصطناعي وبوابة المحاضرات</h2>
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

              {/* Review Settings */}
              <div className="form-group" style={{ gridColumn: '1 / -1', marginTop: '0.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showReview}
                    onChange={(e) => setShowReview(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--brand-primary, #6366f1)', cursor: 'pointer' }}
                  />
                  <span style={{ fontWeight: 600 }}>السماح للطلاب بمراجعة الإجابات بعد التسليم</span>
                </label>
                <p className="inter-lecture-hint" style={{ marginTop: '0.25rem' }}>
                  عند التفعيل، سيتمكن الطالب من مراجعة إجاباته ومعرفة الإجابات الصحيحة وشرحها بعد تسليم الاختبار.
                </p>
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
              <p>يدعم أي عدد من الصور بدقة عالية (PNG, JPEG, WEBP - بحد أقصى 10MB لكل صورة)</p>
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

              {batches.length > 0 && (isOcrLoading || batches.some((b) => b.status === 'failed')) && (
                <div className="ocr-progress" role="status" aria-live="polite">
                  {(() => {
                    const settled = batches.filter((b) => b.status === 'done' || b.status === 'failed');
                    const covered = new Set<number>();
                    for (const b of settled) for (let p = b.window.start; p < b.window.end; p++) covered.add(p);
                    const percent = Math.round((covered.size / Math.max(1, images.length)) * 100);
                    return (
                      <>
                        <div
                          className="ocr-progress-bar"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-label="تقدم استخراج الأسئلة"
                        >
                          <span style={{ width: percent + '%' }} />
                        </div>
                        <p className="ocr-progress-text">
                          {isOcrLoading
                            ? 'جاري معالجة الصفحات: ' + covered.size + ' من ' + images.length + ' — تم العثور على ' + questionsSoFar + ' سؤال حتى الآن'
                            : 'تمت معالجة ' + covered.size + ' من ' + images.length + ' صفحة'}
                        </p>
                      </>
                    );
                  })()}
                  {batches.some((b) => b.status === 'failed') && (
                    <div className="ocr-failed-batches">
                      {batches.map((b, index) =>
                        b.status === 'failed' ? (
                          <p key={index} className="ocr-failed-line">
                            <AlertCircle size={14} /> فشلت الصفحات {pagesLabel(b.window)}: {b.error}
                          </p>
                        ) : null
                      )}
                      <button type="button" className="btn-quick-tool" onClick={retryFailedBatches} disabled={isOcrLoading}>
                        إعادة محاولة الدفعات الفاشلة فقط
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!isOcrLoading && ocrSummary && (
                <div className="ocr-summary" role="status">
                  <CheckCircle2 size={16} /> {ocrSummary}
                </div>
              )}
              {ocrWarnings.length > 0 && (
                <ul className="ocr-warning-list" role="alert">
                  {ocrWarnings.map((warning, index) => (
                    <li key={index}>
                      <AlertCircle size={14} /> {warning.message}
                    </li>
                  ))}
                </ul>
              )}
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
                {questions.slice(0, visibleCount).map((q, qIndex) => {
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

                          {/* Student-facing Explanation Editor */}
                          <div className="explanation-editor-group" style={{ marginTop: '0.875rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                شرح الإجابة (يظهر للطالب بعد التسليم)
                              </label>
                              <span style={{ fontSize: '0.75rem', color: (q.explanation?.length || 0) > 400 ? 'var(--warning, #eab308)' : 'var(--text-muted)' }}>
                                {(q.explanation || '').length}/400
                              </span>
                            </div>
                            {q.needs_review && (
                              <div style={{ fontSize: '0.8rem', color: 'var(--warning, #eab308)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <AlertCircle size={14} /> تنبيه: الشرح بحاجة لمراجعة من المعلم للتأكد من توافقه مع الإجابة الصحيحة
                              </div>
                            )}
                            <textarea
                              dir="auto"
                              rows={2}
                              maxLength={1500}
                              value={q.explanation || ''}
                              onChange={(e) => updateQuestion(qIndex, { explanation: e.target.value, needs_review: false })}
                              placeholder="اكتب شرحاً مبسطاً باللغة العربية يوضح للطالب سبب صحة الإجابة..."
                              className="prompt-textarea"
                              style={{ minHeight: '60px', fontSize: '0.875rem' }}
                            />
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
                {questions.length > visibleCount && (
                  <div className="ocr-show-more">
                    <button
                      type="button"
                      className="btn btn-outline-sm"
                      onClick={() => setVisibleCount((count) => count + REVIEW_PAGE_SIZE)}
                    >
                      عرض المزيد ({questions.length - visibleCount} سؤال متبقٍ)
                    </button>
                    <button type="button" className="btn btn-outline-sm" onClick={() => setVisibleCount(questions.length)}>
                      عرض الكل
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Modal Sticky Bottom Action Bar (One-Thumb Operation) */}
        <footer className="ai-exam-modal-footer">
          {submitError && (
            <div className="submit-error-msg" role="alert">
              <AlertCircle size={16} /> {submitError}
            </div>
          )}
          <div className="footer-btns">
            <button
              type="button"
              className="btn btn-secondary ai-exam-footer-cancel"
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
                      <Sparkles size={18} /> استخراج الأسئلة
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
