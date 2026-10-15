'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, Check, FileQuestion, Sparkles, GraduationCap, Camera } from 'lucide-react';
import { useAdmin } from '../../../lib/admin-context';
import { AIExamOcrModal } from '../AIExamOcrModal';
import './ai-assistant.css';

interface ToolItem {
  id: string;
  title: string;
  badge?: string;
  description: string;
  action: string;
  icon: typeof Bot;
  capabilities: string[];
  href?: string;
}

const tools: ToolItem[] = [
  {
    id: 'ai-assistant',
    href: '/admin/ai/assistant',
    title: 'المساعد الإداري والتعليمي الذكي',
    description: 'مساعد ذكي مدعوم بنماذج متطورة لمساعدتك في صياغة المحتوى التعليمي، إجابة الاستفسارات، وتنظيم المهام الدراسية بكفاءة.',
    action: 'فتح المساعد الذكي',
    icon: Bot,
    capabilities: ['دعم إداري وتربوي فوري', 'صياغة وتحليل الأسئلة', 'تنفيذ إجراءات ذكية متعددة'],
  },
  {
    id: 'pdf-exam',
    href: '/admin/ai/pdf-exam',
    title: 'مولد الاختبارات من ملفات PDF',
    description: 'استخراج وتوليد أسئلة واختبارات تفاعلية مباشرة من مذكرات وملفات الـ PDF مع مراجعة دقيقة وتخصيص مستويات الصعوبة.',
    action: 'توليد اختبار من PDF',
    icon: FileQuestion,
    capabilities: ['استخراج نصوص عالي الدقة', 'تحديد نطاق وبوابات المحاضرات', 'مستويات صعوبة متنوعة'],
  },
  {
    id: 'school-exam',
    href: '/admin/ai/school-exam',
    title: 'مولد امتحانات المدارس المصرية',
    description: 'توليد امتحانات رسمية متوافقة تماماً مع مواصفات وزارة التربية والتعليم لكافة المراحل الابتدائية والإعدادية والثانوية.',
    action: 'توليد امتحان مدرسي',
    icon: GraduationCap,
    capabilities: ['مطابقة للمواصفات الرسمية', 'تغطية جميع المراحل والصفوف', 'تصدير وطباعة فورية'],
  },
  {
    id: 'ocr-exam',
    title: 'مولد الاختبارات من الصور (AI OCR)',
    badge: 'جديد',
    description: 'استخراج الأسئلة والخيارات والإجابات النموذجية من صور أوراق الامتحانات والكاميرا مع ربط إجباري ببوابات وقفل المحاضرات.',
    action: 'إنشاء اختبار من الصور',
    icon: Camera,
    capabilities: ['استخراج فوري من عدة صور بدقة فائقة', 'ربط إجباري ببوابات وقفل المحاضرات', 'استوديو تفاعلي لمراجعة وتعديل الأسئلة'],
  },
];

export function AIHub() {
  const { data, refreshData, setNotice } = useAdmin();
  const [isOcrOpen, setIsOcrOpen] = useState(false);

  const courses = data?.courses || [];
  const videos = data?.videos || [];

  // Support opening OCR modal via query params (e.g. ?action=ocr or ?ocr=1)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('action') === 'ocr' || params.get('ocr') === '1' || params.get('modal') === 'ocr') {
        setIsOcrOpen(true);
      }
    }
  }, []);

  const handleCloseOcr = () => {
    setIsOcrOpen(false);
    if (typeof window !== 'undefined' && (window.location.search.includes('action=ocr') || window.location.search.includes('ocr='))) {
      const url = new URL(window.location.href);
      url.searchParams.delete('action');
      url.searchParams.delete('ocr');
      url.searchParams.delete('modal');
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <div className="ai-hub" dir="rtl">
      {/* ── Page Hero Heading ────────────────────────────────────────────── */}
      <header className="ai-page-heading">
        <span className="ai-page-heading-icon">
          <Sparkles size={26} />
        </span>
        <div>
          <h1>أدوات الذكاء الاصطناعي</h1>
          <p>
            منظومة أدوات الذكاء الاصطناعي المتقدمة لتوليد الاختبارات التفاعلية، تحليل المناهج الدراسية، وإدارة المحتوى التعليمي بكفاءة واحترافية.
          </p>
        </div>
      </header>

      {/* ── 2x2 Tools Grid ────────────────────────────────────────────────── */}
      <section className="ai-tools-grid" aria-label="أدوات الذكاء الاصطناعي">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <article className="ai-tool-card" key={tool.id}>
              <div className="ai-tool-card-header">
                <span className="ai-tool-card-icon">
                  <Icon size={24} />
                </span>
                <div className="ai-tool-card-copy">
                  <div className="ai-tool-card-title-row">
                    <h2>{tool.title}</h2>
                    {tool.badge && <span className="ai-tool-badge-new">{tool.badge}</span>}
                  </div>
                  <p>{tool.description}</p>
                </div>
              </div>

              <ul className="ai-tool-card-features">
                {tool.capabilities.map((capability) => (
                  <li key={capability}>
                    <Check size={14} />
                    <span>{capability}</span>
                  </li>
                ))}
              </ul>

              <div className="ai-tool-card-footer">
                {tool.href ? (
                  <Link href={tool.href} className="ai-tool-card-action">
                    <span>{tool.action}</span>
                    <ArrowLeft size={16} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="ai-tool-card-action"
                    onClick={() => setIsOcrOpen(true)}
                  >
                    <span>{tool.action}</span>
                    <ArrowLeft size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {/* ── AI Exam OCR Modal ────────────────────────────────────────────── */}
      <AIExamOcrModal
        isOpen={isOcrOpen}
        onClose={handleCloseOcr}
        courses={courses}
        videos={videos}
        onExamSaved={async () => {
          handleCloseOcr();
          setNotice('تم حفظ ونشر امتحان الذكاء الاصطناعي بنجاح');
          await refreshData(1);
        }}
      />
    </div>
  );
}
