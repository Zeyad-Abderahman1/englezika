'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, FileQuestion, LoaderCircle, Minus, Plus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import type { GeneratedAssessmentPreview, GeneratedQuestion } from '../../../lib/ai/content-generator';
import { AssessmentPreviewModal } from './AssessmentPreviewModal';
import './ai-assistant.css';

const QUESTION_COUNT_MIN = 1;
const QUESTION_COUNT_MAX = 30;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function safeGenerationError() {
  return 'تعذر توليد الأسئلة حاليًا. حاول مرة أخرى بعد قليل.';
}

export function PdfAssessmentWorkspace() {
  const { data, refreshData, setNotice } = useAdmin();
  const courses = data?.courses || [];
  const inputRef = useRef<HTMLInputElement>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [questionCount, setQuestionCount] = useState(20);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [examType, setExamType] = useState<'exam' | 'quiz'>('quiz');
  const [stage, setStage] = useState<'idle' | 'uploading' | 'generating' | 'validating'>('idle');
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState<GeneratedAssessmentPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Problem 2: Lecture coverage state
  const [coverageMode, setCoverageMode] = useState<'all' | 'range'>('all');
  const [startLectureId, setStartLectureId] = useState('');
  const [endLectureId, setEndLectureId] = useState('');
  const [courseLectures, setCourseLectures] = useState<Array<{ id: string; title: string; orderIndex: number }>>([]);

  const effectiveCourseId = selectedCourseId || courses[0]?.id || '';
  const busy = stage !== 'idle';
  const updateCount = (value: number) => setQuestionCount(Math.max(QUESTION_COUNT_MIN, Math.min(QUESTION_COUNT_MAX, value)));
  const chooseFile = (file?: File) => {
    setError('');
    if (!file) return;
    if (file.type !== 'application/pdf' || file.size > MAX_FILE_SIZE) { setPdfFile(null); setError('يرجى اختيار ملف PDF لا يتجاوز حجمه 10 ميجابايت.'); return; }
    setPdfFile(file);
  };

  // Load ordered lectures when course changes
  useEffect(() => {
    if (!effectiveCourseId) return;
    let cancelled = false;
    fetch(`/api/admin/courses/${effectiveCourseId}/lectures`)
      .then((res) => res.json())
      .then((resData) => {
        if (cancelled) return;
        if (resData.success && Array.isArray(resData.lectures)) {
          setCourseLectures(resData.lectures);
          if (resData.lectures.length > 0) {
            setStartLectureId((prev) => resData.lectures.some((l: any) => l.id === prev) ? prev : resData.lectures[0].id);
            setEndLectureId((prev) => resData.lectures.some((l: any) => l.id === prev) ? prev : resData.lectures[resData.lectures.length - 1].id);
          } else {
            setStartLectureId('');
            setEndLectureId('');
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [effectiveCourseId]);

  const startIdx = courseLectures.findIndex((l) => l.id === startLectureId);
  const endIdx = courseLectures.findIndex((l) => l.id === endLectureId);
  const isRangeValid = coverageMode === 'all' || (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pdfFile || busy || !isRangeValid) return;
    setError('');
    try {
      setStage('uploading');
      const formData = new FormData(); formData.append('file', pdfFile);
      const uploadRes = await fetch('/api/admin/ai/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.success) throw new Error(uploadData.error);
      setStage('generating');

      const selectedCourse = courses.find((c) => c.id === effectiveCourseId);
      const startLec = courseLectures.find((l) => l.id === startLectureId);
      const endLec = courseLectures.find((l) => l.id === endLectureId);
      const coverage = {
        mode: coverageMode,
        startLectureId: coverageMode === 'range' ? startLectureId : null,
        endLectureId: coverageMode === 'range' ? endLectureId : null,
        startLectureTitle: startLec ? `المحاضرة ${startLec.orderIndex} - ${startLec.title}` : undefined,
        endLectureTitle: endLec ? `المحاضرة ${endLec.orderIndex} - ${endLec.title}` : undefined,
        courseTitle: selectedCourse ? selectedCourse.title : undefined,
        sourceFileName: pdfFile.name,
      };

      const response = await fetch('/api/admin/ai/generate-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempFileId: uploadData.tempFileId,
          title: `تقييم: ${uploadData.fileName}`,
          examType,
          questionCount,
          difficulty,
          coverage,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error);
      setStage('validating');
      setAssessment(result.assessment); setPreviewOpen(true);
    } catch { setError(safeGenerationError()); }
    finally { setStage('idle'); }
  };

  const save = async (questions: GeneratedQuestion[], title: string, type: 'exam' | 'quiz') => {
    if (!effectiveCourseId) throw new Error('يرجى اختيار الدورة التعليمية المراد إدراج التقييم فيها');
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
                courseId: effectiveCourseId,
                title,
                questions,
                durationMinutes: type === 'quiz' ? 15 : 45,
                passingScore: 50,
                coverageStartLectureId: coverageMode === 'range' ? startLectureId : undefined,
                coverageEndLectureId: coverageMode === 'range' ? endLectureId : undefined,
              },
            },
          ],
        },
      }),
    });
    const prep = await prepRes.json(); if (!prepRes.ok || !prep.success) throw new Error('تعذر إعداد التقييم للإدراج.');
    const execRes = await fetch('/api/admin/ai/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: prep.token }) });
    const executed = await execRes.json(); if (!execRes.ok || !executed.success) throw new Error('تعذر إدراج التقييم في الدورة.');
    await refreshData(1); setNotice(`تم إدراج ${questions.length} سؤالًا بنجاح في الدورة.`);
  };

  return <div className="ai-pdf-page" dir="rtl">
    <header className="ai-page-heading"><span className="ai-page-heading-icon"><FileQuestion size={24} /></span><div><h1>مولد الاختبارات من PDF</h1><p>ارفع ملف PDF وسيقوم النظام بإنشاء أسئلة يمكنك مراجعتها وتعديلها قبل إضافتها.</p></div></header>
    <form className="ai-pdf-tool-card" onSubmit={generate}>
      <section><h2>ملف المحتوى</h2>{pdfFile ? <div className="ai-selected-file"><span className="ai-selected-file-icon"><FileQuestion size={22} /></span><div><strong>{pdfFile.name}</strong><small>{(pdfFile.size / 1024 / 1024).toFixed(2)} ميجابايت</small></div><CheckCircle2 className="ai-file-ok" size={20} /><button type="button" onClick={() => inputRef.current?.click()} aria-label="استبدال ملف PDF"><RefreshCw size={17} /></button><button type="button" onClick={() => setPdfFile(null)} aria-label="إزالة ملف PDF"><Trash2 size={17} /></button></div> : <button type="button" className="ai-pdf-dropzone" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); chooseFile(e.dataTransfer.files[0]); }}><Upload size={34} /><strong>اسحب ملف PDF هنا أو اختره من جهازك</strong><span>PDF فقط — بحد أقصى 10 ميجابايت</span><span className="ai-file-picker">اختيار ملف</span></button>}
        <input ref={inputRef} className="ai-visually-hidden" type="file" accept="application/pdf" onChange={(e) => chooseFile(e.target.files?.[0])} />
      </section>
      <section className="ai-pdf-settings"><h2>إعدادات الاختبار</h2><label>الدورة التعليمية<select value={effectiveCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>{courses.map((course) => <option key={course.id} value={course.id}>{course.title} ({course.grade})</option>)}</select></label>
        {/* نطاق الاختبار */}
        <fieldset><legend>نطاق الاختبار</legend><div className="ai-segments"><button type="button" className={coverageMode === 'all' ? 'active' : ''} aria-pressed={coverageMode === 'all'} onClick={() => setCoverageMode('all')}>جميع المحاضرات</button><button type="button" className={coverageMode === 'range' ? 'active' : ''} aria-pressed={coverageMode === 'range'} onClick={() => setCoverageMode('range')}>نطاق محاضرات</button></div></fieldset>
        {coverageMode === 'range' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label>من المحاضرة:<select value={startLectureId} onChange={(e) => setStartLectureId(e.target.value)} disabled={courseLectures.length === 0}>{courseLectures.length === 0 ? <option value="">لا توجد محاضرات في هذه الدورة</option> : courseLectures.map((lec) => <option key={lec.id} value={lec.id}>المحاضرة {lec.orderIndex} - {lec.title}</option>)}</select></label>
            <label>إلى المحاضرة:<select value={endLectureId} onChange={(e) => setEndLectureId(e.target.value)} disabled={courseLectures.length === 0}>{courseLectures.length === 0 ? <option value="">لا توجد محاضرات في هذه الدورة</option> : courseLectures.map((lec) => <option key={lec.id} value={lec.id}>المحاضرة {lec.orderIndex} - {lec.title}</option>)}</select></label>
          </div>
        )}
        {coverageMode === 'range' && !isRangeValid && (
          <p className="text-red-400 text-xs" style={{ marginTop: '-0.25rem' }} role="alert">
            يجب أن تكون محاضرة البداية قبل أو نفس محاضرة النهاية في تسلسل الدورة.
          </p>
        )}
        <fieldset><legend>نوع التقييم</legend><div className="ai-segments">{(['quiz', 'exam'] as const).map((type) => <button key={type} type="button" className={examType === type ? 'active' : ''} aria-pressed={examType === type} onClick={() => setExamType(type)}>{type === 'quiz' ? 'Quiz' : 'Exam'}</button>)}</div></fieldset>
        <fieldset><legend>مستوى الصعوبة</legend><div className="ai-segments">{(['easy', 'medium', 'hard'] as const).map((level) => <button key={level} type="button" className={difficulty === level ? 'active' : ''} aria-pressed={difficulty === level} onClick={() => setDifficulty(level)}>{level === 'easy' ? 'سهل' : level === 'medium' ? 'متوسط' : 'متقدم'}</button>)}</div></fieldset>
        <label>عدد الأسئلة<div className="ai-count-control"><button type="button" onClick={() => updateCount(questionCount - 1)} disabled={questionCount <= QUESTION_COUNT_MIN} aria-label="تقليل عدد الأسئلة"><Minus size={17} /></button><input type="number" min={QUESTION_COUNT_MIN} max={QUESTION_COUNT_MAX} value={questionCount} onChange={(e) => updateCount(Number(e.target.value))} /><button type="button" onClick={() => updateCount(questionCount + 1)} disabled={questionCount >= QUESTION_COUNT_MAX} aria-label="زيادة عدد الأسئلة"><Plus size={17} /></button></div></label>
      </section>
      {busy ? <ol className="ai-generation-progress" aria-live="polite"><li className="done"><Check size={16} />تم اختيار الملف</li><li className={stage !== 'uploading' ? 'done' : 'current'}>{stage !== 'uploading' ? <Check size={16} /> : <LoaderCircle className="spin" size={16} />}جاري رفع الملف وقراءة المحتوى</li><li className={stage === 'generating' ? 'current' : stage === 'validating' ? 'done' : ''}>{stage === 'generating' ? <LoaderCircle className="spin" size={16} /> : stage === 'validating' ? <Check size={16} /> : <span />}جاري تحليل المحتوى وتوليد الأسئلة</li><li className={stage === 'validating' ? 'current' : ''}>{stage === 'validating' ? <LoaderCircle className="spin" size={16} /> : <span />}جاري التحقق من جودة الأسئلة</li></ol> : null}
      {error ? <div className="ai-tool-error" role="alert"><strong>تعذر توليد الأسئلة حاليًا</strong><span>{error}</span></div> : null}
      <button className="ai-generate-button" type="submit" disabled={!pdfFile || busy || !isRangeValid}>{busy ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{busy ? 'جاري إعداد الأسئلة...' : 'توليد الأسئلة'}</button>
    </form>
    {assessment && previewOpen ? <AssessmentPreviewModal key={assessment.previewId} assessment={assessment} isOpen onClose={() => setPreviewOpen(false)} onSaveToCourse={save} /> : null}
  </div>;
}
