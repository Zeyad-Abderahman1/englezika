'use client';

import Link from 'next/link';
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  LockKeyhole,
  PlayCircle,
  GraduationCap,
} from 'lucide-react';

export type SequenceItem = {
  key: string;
  itemType: 'video' | 'exam' | 'assignment';
  itemId: string;
  title: string;
  unlocked: boolean;
  isCompleted: boolean;
  lockReason?: 'previous_item' | null;
  assessmentType?: 'exam' | 'quiz';
};

function getItemIcon(item: SequenceItem) {
  if (item.isCompleted) return <CheckCircle2 size={20} className="seq-icon seq-icon-done" />;
  if (!item.unlocked) return <LockKeyhole size={20} className="seq-icon seq-icon-locked" />;

  switch (item.itemType) {
    case 'video':
      return <PlayCircle size={20} className="seq-icon seq-icon-active" />;
    case 'exam':
      return item.assessmentType === 'quiz'
        ? <ClipboardCheck size={20} className="seq-icon seq-icon-active" />
        : <GraduationCap size={20} className="seq-icon seq-icon-active" />;
    case 'assignment':
      return <ClipboardCheck size={20} className="seq-icon seq-icon-active" />;
    default:
      return <BookOpen size={20} className="seq-icon seq-icon-active" />;
  }
}

function getItemLabel(item: SequenceItem): string {
  switch (item.itemType) {
    case 'video':
      return 'محاضرة';
    case 'exam':
      return item.assessmentType === 'quiz' ? 'اختبار قصير' : 'اختبار';
    case 'assignment':
      return 'واجب';
    default:
      return '';
  }
}

function getStatusLabel(item: SequenceItem): string {
  if (item.isCompleted) return 'مكتمل';
  if (!item.unlocked) return 'مغلق';
  return 'متاح';
}

function getItemHref(item: SequenceItem, courseId: string): string | null {
  if (!item.unlocked) return null;
  switch (item.itemType) {
    case 'video':
      return `/learn/${courseId}?video=${item.itemId}`;
    case 'exam':
      return `/exam/${item.itemId}`;
    case 'assignment':
      return `/account`;
    default:
      return null;
  }
}

export default function CourseSequenceTree({
  items,
  courseId,
  activeItemId,
}: {
  items: SequenceItem[];
  courseId: string;
  activeItemId?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="course-sequence-tree">
      <h3 className="seq-heading">تسلسل التعلم</h3>
      <div className="seq-list">
        {items.map((item, index) => {
          const href = getItemHref(item, courseId);
          const isActive = item.itemId === activeItemId;

          const content = (
            <div
              className={`seq-item ${item.isCompleted ? 'seq-item-done' : ''} ${!item.unlocked ? 'seq-item-locked' : ''} ${isActive ? 'seq-item-active' : ''}`}
            >
              <div className="seq-item-left">
                <span className="seq-number">{index + 1}</span>
                {getItemIcon(item)}
              </div>
              <div className="seq-item-content">
                <span className="seq-item-type">{getItemLabel(item)}</span>
                <span className="seq-item-title">{item.title}</span>
              </div>
              <div className="seq-item-right">
                <span
                  className={`seq-status ${item.isCompleted ? 'seq-status-done' : ''} ${!item.unlocked ? 'seq-status-locked' : ''}`}
                >
                  {getStatusLabel(item)}
                </span>
              </div>
            </div>
          );

          return href ? (
            <Link key={item.key} href={href} className="seq-link">
              {content}
            </Link>
          ) : (
            <div key={item.key} className="seq-link seq-link-disabled">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
