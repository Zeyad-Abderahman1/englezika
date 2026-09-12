import Link from 'next/link';
import { ArrowLeft, Bot, Check, FileQuestion, Sparkles } from 'lucide-react';
import './ai-assistant.css';

const tools = [
  { href: '/admin/ai/assistant', title: 'المساعد الذكي', description: 'إدارة الدورات والمحاضرات والاختبارات باستخدام أوامر طبيعية باللغة العربية.', action: 'فتح المساعد', icon: Bot, capabilities: ['إنشاء دورة', 'تعديل الأسعار', 'إدارة المحتوى'] },
  { href: '/admin/ai/pdf-exam', title: 'مولد الاختبارات من PDF', description: 'ارفع مذكرة أو وحدة دراسية لإنشاء أسئلة قابلة للمراجعة قبل إضافتها للدورة.', action: 'إنشاء اختبار', icon: FileQuestion, capabilities: ['رفع PDF', 'توليد الأسئلة', 'مراجعة قبل الإدراج'] },
] as const;

export function AIHub() {
  return <div className="ai-hub" dir="rtl">
    <header className="ai-page-heading"><span className="ai-page-heading-icon"><Sparkles size={24} /></span><div><h1>أدوات الذكاء الاصطناعي</h1><p>استخدم أدوات الذكاء الاصطناعي لإنشاء المحتوى وإدارة الدورات والاختبارات بسرعة أكبر.</p></div></header>
    <section className="ai-tools-grid" aria-label="أدوات الذكاء الاصطناعي المتاحة">
      {tools.map(({ href, title, description, action, icon: Icon, capabilities }) => <article className="ai-tool-card" key={href}>
        <span className="ai-tool-card-icon"><Icon size={24} /></span><div className="ai-tool-card-copy"><h2>{title}</h2><p>{description}</p></div>
        <ul>{capabilities.map((capability) => <li key={capability}><Check size={14} />{capability}</li>)}</ul>
        <Link href={href} className="ai-tool-card-action">{action}<ArrowLeft size={17} /></Link>
      </article>)}
    </section>
  </div>;
}
