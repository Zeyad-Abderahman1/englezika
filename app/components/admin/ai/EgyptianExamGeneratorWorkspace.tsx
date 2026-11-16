'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Printer,
  Eye,
  EyeOff,
  BookOpen,
  Clock,
  Award,
  CheckCircle,
  RefreshCw,
  FileText,
  Copy,
  Check,
  GraduationCap,
  Layers,
  HelpCircle,
  CheckSquare,
  Upload,
  Trash2,
  AlertCircle,
  Square
} from 'lucide-react';
import {
  SCHOOL_GRADES,
  STAGE_PROFILES,
  EXAM_PRESETS,
  getStageForGrade,
  resolvePresetSections,
  getAvailableSectionsForStage,
  type SchoolStage,
  type SchoolGrade,
  type ExamPreset,
  type SectionType
} from '../../../lib/ai/stage-exam-profiles';
import type { GeneratedStageExam } from '../../../lib/ai/stage-exam-generator';
import './school-exam.css';

const STAGE_OPTIONS: { id: SchoolStage; label: string; sub: string }[] = [
  { id: 'primary', label: 'المرحلة الابتدائية', sub: 'Primary (P1-P6)' },
  { id: 'preparatory', label: 'المرحلة الإعدادية', sub: 'Prep (Prep 1-3)' },
  { id: 'secondary', label: 'المرحلة الثانوية', sub: 'Secondary (Sec 1-2)' },
  { id: 'thanaweya', label: 'الثانوية العامة', sub: 'Grade 12 (Sec 3)' },
];

export function EgyptianExamGeneratorWorkspace() {
  const [stage, setStage] = useState<SchoolStage>('thanaweya');
  const [grade, setGrade] = useState<SchoolGrade>('sec_3');
  const [preset, setPreset] = useState<ExamPreset>('thanaweya_mock');
  const [term, setTerm] = useState<'term_1' | 'term_2'>('term_1');
  const [unitTopic, setUnitTopic] = useState('الو (Comprehensive Revision)');
  const [questionCount, setQuestionCount] = useState<number>(35);
  const [totalMarks, setTotalMarks] = useState<number>(50);
  const [timeMinutes, setTimeMinutes] = useState<number>(180);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('hard');
  const [schoolName, setSchoolName] = useState('م ');
  const [governorate, setGovernorate] = useState('م ');
  const [selectedSections, setSelectedSections] = useState<SectionType[]>([]);
  const [referenceText, setReferenceText] = useState<string>('');
  const [isGeneralPractice, setIsGeneralPractice] = useState<boolean>(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileStatus, setFileStatus] = useState<'idle' | 'extracting' | 'extracted' | 'error'>('idle');
  const [fileStats, setFileStats] = useState<{ fileName?: string; pageCount?: number; charCount?: number }>({});
  const [fileError, setFileError] = useState<string | null>(null);

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [showAnswers, setShowAnswers] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [exam, setExam] = useState<GeneratedStageExam | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const defaultSecs = resolvePresetSections(stage, preset);
    setSelectedSections(defaultSecs);
  }, [stage, preset]);

  const handleStageChange = (newStage: SchoolStage) => {
    setStage(newStage);
    const stageProf = STAGE_PROFILES[newStage];
    const firstGrade = stageProf.allowedGrades[0];
    setGrade(firstGrade);

    let nextPreset: ExamPreset = 'midterm_exam';
    if (newStage === 'thanaweya') {
      nextPreset = 'thanaweya_mock';
    } else if (newStage === 'primary') {
      nextPreset = 'school_simple_exam';
    }
    setPreset(nextPreset);

    const presetConfig = EXAM_PRESETS[nextPreset];
    setQuestionCount(presetConfig.defaultQuestionCount);
    setTotalMarks(presetConfig.defaultTotalMarks);
    setTimeMinutes(presetConfig.defaultTimeMinutes);
    setDifficulty(presetConfig.defaultDifficulty);
  };

  const handlePresetChange = (newPreset: ExamPreset) => {
    setPreset(newPreset);
    const presetConfig = EXAM_PRESETS[newPreset];
    setQuestionCount(presetConfig.defaultQuestionCount);
    setTotalMarks(presetConfig.defaultTotalMarks);
    setTimeMinutes(presetConfig.defaultTimeMinutes);
    setDifficulty(presetConfig.defaultDifficulty);
  };

  const handleToggleSection = (sec: SectionType) => {
    if (selectedSections.includes(sec)) {
      if (selectedSections.length > 1) {
        setSelectedSections(selectedSections.filter(s => s !== sec));
      }
    } else {
      setSelectedSections([...selectedSections, sec]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setFileStatus('extracting');
    setFileError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/admin/ai/extract-text', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'فشل في استخراج النص من الملف المرفوع');
      }

      setFileStatus('extracted');
      setFileStats({
        fileName: data.fileName,
        pageCount: data.pageCount,
        charCount: data.charCount,
      });
      setReferenceText(prev => prev ? `${prev}\n\n${data.text}` : data.text);
      setIsGeneralPractice(false);
    } catch (err: any) {
      setFileStatus('error');
      setFileError(err.message || 'حدث خطأ أثناء معالجة واستخراج الملف.');
    }
  };

  const handleClearReferenceText = () => {
    setReferenceText('');
    setUploadedFile(null);
    setFileStatus('idle');
    setFileStats({});
    setFileError(null);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    const payload = {
      stage,
      grade,
      preset,
      term,
      unitTopic,
      questionCount,
      totalMarks,
      timeMinutes,
      difficulty,
      schoolName,
      governorate,
      sections: selectedSections.length > 0 ? selectedSections : undefined,
      referenceText: referenceText.trim() ? referenceText.trim() : undefined,
      isGeneralPractice,
      allowFallback: false,
    };

    try {
      const res = await fetch('/api/admin/ai/generate-stage-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.exam) {
        throw new Error(data.error || 'فشل توليد الاختبار بواسطة الذكاء الاصطناعي. يرجى مراجعة المدخلات أو المحاولة مرة أخرى.');
      }

      setExam(data.exam);
    } catch (err: any) {
      console.error('AI Stage Exam generation error:', err);
      setError(err.message || 'فشل توليد الاختبار. يرجى المحاولة لاحقاً');
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyExam = () => {
    if (!exam) return;
    let text = `${exam.paperLayout.ministryHeaderAr}\n`;
    text += `${(exam.paperLayout.termAssessmentAr || exam.paperLayout.termLabelAr)} - ${(exam.paperLayout.stageGradeAr || exam.paperLayout.gradeLabelAr)}\n`;
    text += `المادة: ${(exam.paperLayout.subjectAr || "اللغ الإنجليزية")} | الزمن: ${exam.metadata.timeMinutes} دقيق | الدر ${exam.metadata.totalMarks}\n\n`;

    exam.sections.forEach(sec => {
      text += `=== ${sec.titleAr} (${sec.title}) [${sec.totalMarks} Marks] ===\n`;
      if (sec.instructions) text += `Instructions: ${sec.instructions}\n`;
      if (sec.passage) text += `\nPassage:\n${sec.passage}\n\n`;

      sec.questions.forEach(q => {
        text += `${q.questionNumber}. ${q.prompt} [${q.marks} Mark${q.marks > 1 ? 's' : ''}]\n`;
        if (q.options && q.options.length > 0) {
          q.options.forEach((opt, idx) => {
            const letter = String.fromCharCode(97 + idx);
            text += `   (${letter}) ${opt}\n`;
          });
        }
      });
      text += `\n`;
    });

    if (showAnswers && exam.answerKey) {
      text += `\n=== ن (Official Answer Key) ===\n`;
      exam.answerKey.forEach(ans => {
        text += `Q${ans.questionNumber}: ${ans.correctAnswer || ans.answer} (${ans.marks ?? 1} Marks)\n`;
      });
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const availableGrades = STAGE_PROFILES[stage].allowedGrades.map(g => SCHOOL_GRADES[g]);
  const availableSections = getAvailableSectionsForStage(stage);

  return (
    <div className="school-exam-workspace">
      {/* Top Header */}
      <header className="school-exam-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.6rem', fontWeight: 800 }}>
            <GraduationCap style={{ color: '#3b82f6' }} size={28} />
            مولد  ام المدا الم الإنجليزي  ( ك الم )
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            ن ( اب إ ث ث ع ) و التع .
          </p>
        </div>
        <div className="action-btns-group">
          {exam && (
            <>
              <button
                type="button"
                onClick={() => setShowAnswers(!showAnswers)}
                className={`stage-tab-btn ${showAnswers ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem' }}
                title="ع"
              >
                {showAnswers ? <EyeOff size={16} /> : <Eye size={16} />}
                <span>{showAnswers ? 'إ' : 'ع'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyExam}
                className="stage-tab-btn"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem' }}
                title="ن"
              >
                {copied ? <Check size={16} style={{ color: '#10b981' }} /> : <Copy size={16} />}
                <span>{copied ? 'ت' : 'ن'}</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="stage-tab-btn active"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: '#2563eb', color: '#fff' }}
                title="ط"
              >
                <Printer size={16} />
                <span>طبا / PDF</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <div className="school-exam-grid">
        {/* Sidebar Controls */}
        <aside className="school-exam-controls">
          {/* Stage selection */}
          <div>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.9rem' }}>المرحلة الت </label>
            <div className="stage-tabs-list">
              {STAGE_OPTIONS.map(st => (
                <button
                  key={st.id}
                  type="button"
                  className={`stage-tab-btn ${stage === st.id ? 'active' : ''}`}
                  onClick={() => handleStageChange(st.id)}
                >
                  <strong>{st.label}</strong>
                  <small style={{ display: 'block', fontSize: '0.72rem', opacity: 0.85 }}>{st.sub}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Grade selection */}
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.9rem' }}>الص </label>
            <select
              value={grade}
              onChange={e => setGrade(e.target.value as SchoolGrade)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontSize: '0.9rem'
              }}
            >
              {availableGrades.map(g => (
                <option key={g.grade} value={g.grade}>
                  {g.labelAr} ({g.labelEn})
                </option>
              ))}
            </select>
          </div>

          {/* Preset templates */}
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.9rem' }}>ن </label>
            <div className="preset-grid">
              {Object.values(EXAM_PRESETS)
                .filter(p => stage === 'thanaweya' ? p.preset === 'thanaweya_mock' || p.preset === 'final_exam' : p.preset !== 'thanaweya_mock')
                .map(p => (
                  <button
                    key={p.preset}
                    type="button"
                    className={`preset-card ${preset === p.preset ? 'selected' : ''}`}
                    onClick={() => handlePresetChange(p.preset)}
                  >
                    <strong>{p.titleAr}</strong>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.titleEn}</span>
                    <span style={{ fontSize: '0.72rem', color: '#3b82f6', marginTop: '0.2rem' }}>{p.defaultQuestionCount} س • {p.defaultTimeMinutes} د</span>
                  </button>
              ))}
            </div>
          </div>

          {/* Term and Difficulty */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.85rem' }}>الف </label>
              <select
                value={term}
                onChange={e => setTerm(e.target.value as any)}
                style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              >
                <option value="term_1">الف الأ (Term 1)</option>
                <option value="term_2">الف ال (Term 2)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.85rem' }}>الم </label>
              <select
                value={difficulty}
                onChange={e => setDifficulty(e.target.value as any)}
                style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              >
                <option value="easy">س (Easy)</option>
                <option value="medium">م (Standard)</option>
                <option value="hard">م (Challenging)</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: '0.85rem' }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.85rem' }}>م </label>
            <input
              type="text"
              value={unitTopic}
              onChange={e => setUnitTopic(e.target.value)}
              placeholder="Units 1-3"
              style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            />
          </div>

          {/* Counts, marks, time */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.3rem', fontSize: '0.8rem' }}>ع </label>
              <input
                type="number"
                min="3"
                max="50"
                value={questionCount}
                onChange={e => setQuestionCount(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.3rem', fontSize: '0.8rem' }}>الد </label>
              <input
                type="number"
                min="10"
                max="100"
                value={totalMarks}
                onChange={e => setTotalMarks(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.3rem', fontSize: '0.8rem' }}>الز </label>
              <input
                type="number"
                min="15"
                max="240"
                step="5"
                value={timeMinutes}
                onChange={e => setTimeMinutes(Number(e.target.value))}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </div>
          </div>

          {/* School Name & Governorate */}
          <div style={{ marginTop: '0.85rem' }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.3rem', fontSize: '0.8rem' }}>اس </label>
            <input
              type="text"
              value={schoolName}
              onChange={e => setSchoolName(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ marginTop: '0.6rem' }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.3rem', fontSize: '0.8rem' }}>الم </label>
            <input
              type="text"
              value={governorate}
              onChange={e => setGovernorate(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            />
          </div>

          {/* Source Material Area: File Upload (PDF/TXT) & Reference Text */}
          <div style={{ marginTop: '0.85rem', background: '#f8fafc', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 700, fontSize: '0.82rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <FileText size={15} color="#0284c7" />
                المادة المرجعية للمنهج (PDF / نصوص / مذكرات)
              </label>
              {referenceText && (
                <button
                  type="button"
                  onClick={handleClearReferenceText}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.2rem',
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  <Trash2 size={12} />
                  مسح النص
                </button>
              )}
            </div>

            {/* Server-Side File Upload (PDF / TXT) */}
            <div style={{ marginBottom: '0.6rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem',
                  borderRadius: '0.375rem',
                  border: '1px dashed #94a3b8',
                  background: fileStatus === 'extracting' ? '#e0f2fe' : '#ffffff',
                  cursor: fileStatus === 'extracting' ? 'wait' : 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#334155',
                  transition: 'all 0.2s ease'
                }}
              >
                <Upload size={14} color="#0284c7" />
                <span>
                  {fileStatus === 'extracting'
                    ? 'جاري استخراج النصوص من الخادم...'
                    : 'رفع ملف وحدة أو كتاب خارجي (PDF أو TXT)'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.txt"
                  disabled={fileStatus === 'extracting'}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </label>

              {/* Extraction Status */}
              {fileStatus === 'extracted' && fileStats.fileName && (
                <div style={{ marginTop: '0.35rem', padding: '0.35rem 0.5rem', background: '#ecfdf5', borderRadius: '0.25rem', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.73rem', color: '#065f46' }}>
                  <CheckCircle size={13} color="#10b981" />
                  <span>
                    تم استخراج النص بنجاح من: <strong>{fileStats.fileName}</strong> ({fileStats.pageCount || 1} صفحة، {fileStats.charCount || 0} حرف).
                  </span>
                </div>
              )}

              {fileStatus === 'error' && fileError && (
                <div style={{ marginTop: '0.35rem', padding: '0.35rem 0.5rem', background: '#fef2f2', borderRadius: '0.25rem', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.73rem', color: '#b91c1c' }}>
                  <AlertCircle size={13} color="#ef4444" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>

            {/* Reference Textarea */}
            <textarea
              rows={4}
              value={referenceText}
              onChange={e => setReferenceText(e.target.value)}
              placeholder="نص المنهج المستخرج أو المنسوخ يظهر هنا... يمكنك أيضاً لصق كلمات الوحدة وقواعدها ونصوص الاستماع مباشرة."
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.78rem',
                fontFamily: 'inherit',
                resize: 'vertical',
                background: '#ffffff'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                {referenceText.trim() ? `${referenceText.trim().length} حرف متوفر للتوليد` : 'لم يتم توفير نص مرجعي بعد'}
              </span>
              <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                الكتب والمذكرات تُستخدم كمرجع تعليمي لصياغة أسئلة موازية دون نسخ حرفي
              </span>
            </div>
          </div>
          {/* General Practice Toggle */}
          <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              id="genPracticeCheck"
              checked={isGeneralPractice}
              onChange={e => setIsGeneralPractice(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="genPracticeCheck" style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
              ????? ??? ??????? ????? (General Curriculum Practice)
            </label>
          </div>

          {/* Sections customization */}
          <div style={{ marginTop: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 700, marginBottom: '0.4rem', fontSize: '0.85rem' }}>أ </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {availableSections.map(sec => {
                const isSelected = selectedSections.includes(sec);
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => handleToggleSection(sec)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.4rem 0.6rem',
                      borderRadius: '0.25rem',
                      border: '1px solid ' + (isSelected ? '#93c5fd' : '#e2e8f0'),
                      background: isSelected ? '#eff6ff' : '#f8fafc',
                      cursor: 'pointer',
                      textAlign: 'right',
                      fontSize: '0.8rem'
                    }}
                  >
                    {isSelected ? <CheckSquare size={15} style={{ color: '#2563eb' }} /> : <Square size={15} style={{ color: '#94a3b8' }} />}
                    <span>{sec}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate Button */}
          <button
            type="button"
            disabled={isGenerating}
            onClick={handleGenerate}
            style={{
              width: '100%',
              padding: '0.85rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              marginTop: '1.25rem',
              boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)'
            }}
          >
            {isGenerating ? (
              <>
                <RefreshCw size={18} className="ai-spin" />
                ج ...
              </>
            ) : (
              <>
                <Sparkles size={18} />
                ت
              </>
            )}
          </button>

          {error && (
            <div style={{ color: '#ef4444', fontSize: '0.85rem', padding: '0.6rem', background: '#fef2f2', borderRadius: '0.35rem', marginTop: '0.85rem', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}
        </aside>

        {/* Paper Preview */}
        <main className="school-exam-paper-wrapper">
          {!exam ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4rem 2rem',
              textAlign: 'center',
              background: '#fff',
              borderRadius: '0.75rem',
              border: '2px dashed #cbd5e1',
              color: '#64748b'
            }}>
              <FileText size={56} style={{ color: '#94a3b8', marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>ورقة الامتحان المدر ج </h3>
              <p style={{ maxWidth: '480px', marginTop: '0.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
                اخ المر ( اب إ ث ث ) .
              </p>
            </div>
          ) : (
            <div className="school-exam-paper">
              {/* Official Egyptian Ministry Paper Header */}
              <header className="official-paper-header">
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>ج م الع </div>
                  <div style={{ fontSize: '0.85rem' }}>و الت و </div>
                  <div style={{ fontSize: '0.82rem', color: '#475569' }}>{exam.metadata.governorate}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{exam.metadata.schoolName}</div>
                </div>

                <div className="exam-title-center" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{exam.paperLayout.termAssessmentAr}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e3a8a' }}>{exam.paperLayout.stageGradeAr}</div>
                  <div style={{ fontSize: '0.82rem', color: '#475569' }}>العام الد {(exam.metadata.academicYear || "2025 / 2026")}</div>
                </div>

                <div style={{ textAlign: 'left', direction: 'ltr' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Subject: English</div>
                  <div style={{ fontSize: '0.85rem' }}>Time: {exam.metadata.timeMinutes} Minutes</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>Total Marks: {exam.metadata.totalMarks}</div>
                </div>
              </header>

              {/* Student Identification Info */}
              <div className="student-info-grid">
                <div>اسم الطالب / الطالب : ..............................................................................................</div>
                <div>رقم الج : ..............................</div>
                <div>الف : ...................</div>
              </div>

              {/* General Exam Instructions */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '0.35rem',
                padding: '0.6rem 0.85rem',
                marginBottom: '1.25rem',
                fontSize: '0.85rem',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}>
                <div><strong>ت :</strong> {(exam.paperLayout.generalInstructionsAr || "أج ع ج الأ")}</div>
                <div style={{ direction: 'ltr', color: '#475569' }}><strong>Instructions:</strong> {(exam.paperLayout.generalInstructionsEn || "Answer all questions")}</div>
              </div>

              {/* Teacher Listening Script */}
              {exam.listeningScript && (
                <div className="teacher-listening-box" style={{
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '0.5rem',
                  padding: '1rem',
                  marginBottom: '1.25rem',
                }}>
                  <div style={{ fontWeight: 800, color: '#92400e', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span>?? ?? ???????? ????? ??????? (Teacher's Listening Script)</span>
                    <span style={{ fontSize: '0.72rem', background: '#fde68a', color: '#78350f', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontWeight: 600 }}>
                      ????? ?????? - ???? ?? ???????
                    </span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: '#78350f', lineHeight: 1.6, direction: 'ltr', textAlign: 'left', background: '#fffbeb', padding: '0.6rem', borderRadius: '0.35rem', border: '1px solid #fde68a' }}>
                    {exam.listeningScript}
                  </div>
                </div>
              )}

              {/* Exam Sections */}
              {exam.sections.map((sec, sIndex) => (
                <section key={sec.id || sIndex} className="paper-section">
                  {/* Section Title Banner */}
                  <div className="section-banner">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 800, fontSize: '1rem' }}>{sec.title}</span>
                      <span style={{ fontSize: '0.9rem', color: '#475569' }}>({sec.titleAr})</span>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>[{sec.totalMarks} Marks]</span>
                  </div>

                  {sec.instructions && (
                    <div style={{ fontSize: '0.85rem', fontStyle: 'italic', color: '#334155', marginBottom: '0.6rem', direction: 'ltr' }}>
                      {sec.instructions}
                    </div>
                  )}

                  {/* Passage Box if Reading Comprehension or Listening text */}
                  {sec.passage && (
                    <div className="paper-passage-box">
                      <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: '#1e3a8a', fontSize: '0.9rem' }}>
                        Read the following passage, then answer the questions below:
                      </div>
                      <div style={{ lineHeight: 1.7, fontSize: '0.92rem', color: '#0f172a', whiteSpace: 'pre-line' }}>
                        {sec.passage}
                      </div>
                    </div>
                  )}

                  {/* Questions List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.5rem' }}>
                    {sec.questions.map((q) => (
                      <div key={q.id || q.questionNumber} className="question-row">
                        <div className="question-prompt">
                          <span style={{ fontWeight: 700, minWidth: '24px' }}>{q.questionNumber}.</span>
                          <span style={{ flex: 1, whiteSpace: 'pre-line' }}>{q.prompt}</span>
                          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>({q.marks} {q.marks > 1 ? 'Marks' : 'Mark'})</span>
                        </div>

                        {/* Options Grid for Multiple Choice */}
                        {q.options && q.options.length > 0 && (
                          <div className="options-grid">
                            {q.options.map((opt, oIdx) => {
                              const optLetter = String.fromCharCode(97 + oIdx);
                              const isCorrect = showAnswers && (
                                q.correctIndex === oIdx ||
                                (q.correctIndices && q.correctIndices.includes(oIdx)) ||
                                (typeof q.correctAnswer === 'string' && q.correctAnswer.toLowerCase() === optLetter)
                              );

                              return (
                                <div
                                  key={oIdx}
                                  style={{
                                    padding: '0.35rem 0.6rem',
                                    borderRadius: '0.25rem',
                                    background: isCorrect ? '#dcfce7' : '#f8fafc',
                                    border: '1px solid ' + (isCorrect ? '#86efac' : '#e2e8f0'),
                                    fontWeight: isCorrect ? 700 : 400,
                                    color: isCorrect ? '#166534' : '#1e293b'
                                  }}
                                >
                                  <strong>({optLetter})</strong> {opt}
                                </div>
                              );
                          })}
                        </div>
                      )}

                      {/* Open-ended answer dotted lines */}
                      {(!q.options || q.options.length === 0) && (
                        <div style={{ marginTop: '0.4rem', paddingRight: '1.5rem', direction: 'ltr' }}>
                          <div className="answer-dotted-line">................................................................................................................................................................................................................................</div>
                          {q.marks > 2 && (
                            <div className="answer-dotted-line">................................................................................................................................................................................................................................</div>
                          )}
                        </div>
                      )}

                      {/* Model answer callout */}
                      {showAnswers && (
                        <div style={{
                          marginTop: '0.4rem',
                          padding: '0.4rem 0.75rem',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: '0.25rem',
                          fontSize: '0.82rem',
                          color: '#15803d'
                        }}>
                          <strong>ن : </strong>
                          <span>{typeof q.correctAnswer === 'string' ? q.correctAnswer : JSON.stringify(q.correctAnswer)}</span>
                          {q.explanation && (
                            <span style={{ marginRight: '0.5rem', color: '#166534' }}>({q.explanation})</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}

              {/* Teacher Listening Script if present */}
              {exam.listeningScript && (
                <div className="teacher-notes-callout">
                  <div style={{ fontWeight: 800, marginBottom: '0.4rem', color: '#92400e', fontSize: '0.95rem' }}>
                    [ المع ] - Listening Script (Teacher Only - Read Aloud)
                  </div>
                  <div style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#78350f', whiteSpace: 'pre-line' }}>
                    {exam.listeningScript}
                  </div>
                </div>
              )}

                            {/* Writing Rubric if present */}
              {exam.writingRubric && (
                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '0.35rem',
                  padding: '0.75rem',
                  marginTop: '1.5rem'
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.4rem', color: '#1e293b' }}>
                    ?????? ????? ??????? ???????? (Writing Rubric)
                  </div>
                  {typeof exam.writingRubric === 'string' ? (
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: '#334155', lineHeight: 1.6 }}>
                      {exam.writingRubric}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.82rem' }}>
                      {(((exam.writingRubric as any).criteria || []) as any[]).map((cr: any, idx: number) => (
                        <div key={idx} style={{ background: '#fff', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #e2e8f0' }}>
                          <div style={{ fontWeight: 700, color: '#2563eb' }}>{cr.name} ({cr.marks} Marks)</div>
                          <div style={{ color: '#64748b', marginTop: '0.2rem' }}>{cr.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Complete Answer Key Table if showAnswers is active */}
              {showAnswers && exam.answerKey && exam.answerKey.length > 0 && (
                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px dashed #94a3b8' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.75rem', color: '#1e293b' }}>
                    ج (Official Marking Scheme)
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'right' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                          <th style={{ padding: '0.5rem' }}>ر </th>
                          <th style={{ padding: '0.5rem' }}>الق </th>
                          <th style={{ padding: '0.5rem' }}>ن </th>
                          <th style={{ padding: '0.5rem' }}>الإ </th>
                          <th style={{ padding: '0.5rem' }}>الد </th>
                        </tr>
                      </thead>
                      <tbody>
                        {exam.answerKey.map((ans, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                            <td style={{ padding: '0.5rem', fontWeight: 700 }}>Q{ans.questionNumber}</td>
                            <td style={{ padding: '0.5rem', color: '#475569' }}>{ans.sectionTitle || ans.sectionType}</td>
                            <td style={{ padding: '0.5rem', color: '#64748b' }}>{ans.questionType}</td>
                            <td style={{ padding: '0.5rem', fontWeight: 600, color: '#166534', direction: 'ltr', textAlign: 'left' }}>
                              {ans.correctAnswer}
                              {ans.explanation && <span style={{ color: '#475569', fontSize: '0.75rem', marginLeft: '0.5rem' }}>({ans.explanation})</span>}
                            </td>
                            <td style={{ padding: '0.5rem', fontWeight: 700 }}>{ans.marks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
