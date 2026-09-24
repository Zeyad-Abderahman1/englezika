import Link from 'next/link';
import { ArrowLeft, Bot, Check, FileQuestion, Sparkles, GraduationCap } from 'lucide-react';
import './ai-assistant.css';

const tools = [
  { href: '/admin/ai/assistant', title: 'الم الذ', description: '', action: '', icon: Bot, capabilities: ['', '', ''] },
  { href: '/admin/ai/pdf-exam', title: 'م م PDF', description: '', action: '', icon: FileQuestion, capabilities: ['', '', ''] },
  { href: '/admin/ai/school-exam', title: 'مولد امت المدا المص', description: 'ت ( اب إ ث ث ع ).', action: 'ت ام', icon: GraduationCap, capabilities: ['ج الم', 'م الو', 'ط و'] },
] as const;

export function AIHub() {
  return <div className="ai-hub" dir="rtl">
    <header className="ai-page-heading"><span className="ai-page-heading-icon"><Sparkles size={24} /></span><div><h1>أد الذ</h1><p>اس.</p></div></header>
    <section className="ai-tools-grid" aria-label="أد الذ">
      {tools.map(({ href, title, description, action, icon: Icon, capabilities }) => <article className="ai-tool-card" key={href}>
        <span className="ai-tool-card-icon"><Icon size={24} /></span><div className="ai-tool-card-copy"><h2>{title}</h2><p>{description}</p></div>
        <ul>{capabilities.map((capability) => <li key={capability}><Check size={14} />{capability}</li>)}</ul>
        <Link href={href} className="ai-tool-card-action">{action}<ArrowLeft size={17} /></Link>
      </article>)}
    </section>
  </div>;
}
