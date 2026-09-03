'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ClipboardList,
  FileCheck,
  GraduationCap,
  HelpCircle,
  LockKeyhole,
  Play,
  PlayCircle,
  Sparkles,
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
  switch (item.itemType) {
    case 'video':
      return <PlayCircle size={17} />;
    case 'exam':
      return item.assessmentType === 'quiz' ? (
        <HelpCircle size={17} />
      ) : (
        <GraduationCap size={17} />
      );
    case 'assignment':
      return <ClipboardList size={17} />;
    default:
      return <FileCheck size={17} />;
  }
}

function getItemTypeLabel(item: SequenceItem): string {
  switch (item.itemType) {
    case 'video':
      return 'محاضرة';
    case 'exam':
      return item.assessmentType === 'quiz' ? 'اختبار قصير' : 'امتحان';
    case 'assignment':
      return 'واجب';
    default:
      return 'محتوى تعليمي';
  }
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

function getCtaText(item: SequenceItem, isCompleted: boolean): string {
  if (isCompleted) {
    return item.itemType === 'video' ? 'إعادة المشاهدة' : 'مراجعة النتيجة';
  }
  switch (item.itemType) {
    case 'video':
      return 'مشاهدة المحاضرة';
    case 'exam':
      return item.assessmentType === 'quiz' ? 'بدء الاختبار' : 'دخول الامتحان';
    case 'assignment':
      return 'عرض الواجب';
    default:
      return 'فتح المحتوى';
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
  if (!items || items.length === 0) return null;

  // Identify next uncompleted available item as current
  const nextActiveIndex = items.findIndex((it) => it.unlocked && !it.isCompleted);
  const completedCount = items.filter((it) => it.isCompleted).length;
  const progressPercent = Math.round((completedCount / items.length) * 100);

  return (
    <nav className="course-roadmap-container" aria-label="خارطة مسار التعلم">
      <div className="roadmap-header">
        <div className="roadmap-title-row">
          <div className="roadmap-title-group">
            <span className="roadmap-eyebrow">
              <Sparkles size={14} /> مسار التعلم المنهجي
            </span>
            <h2 className="roadmap-heading">خارطة تقدم الكورس</h2>
          </div>
          <div className="roadmap-progress-badge">
            <span className="progress-fraction">
              {completedCount} من {items.length} محطات مكتملة
            </span>
            <div className="roadmap-mini-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
              <div className="roadmap-mini-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="roadmap-timeline">
        {items.map((item, index) => {
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          const isCompleted = item.isCompleted;
          const isLocked = !item.unlocked;
          const isCurrent =
            (activeItemId && item.itemId === activeItemId) ||
            (!isCompleted && !isLocked && index === nextActiveIndex);
          const isAvailable = item.unlocked && !isCompleted && !isCurrent;

          const nextItem = !isLast ? items[index + 1] : null;
          const connectorBelowCompleted = isCompleted && nextItem && (nextItem.isCompleted || nextItem.unlocked);

          const href = getItemHref(item, courseId);
          const typeLabel = getItemTypeLabel(item);

          const stateClass = isCompleted
            ? 'is-completed'
            : isCurrent
              ? 'is-current'
              : isLocked
                ? 'is-locked'
                : 'is-available';

          const cardContent = (
            <div className="roadmap-node-card">
              <div className="node-card-header">
                <span className={`node-type-pill type-${item.itemType}`}>
                  {getItemIcon(item)}
                  <span>{typeLabel}</span>
                </span>
                <span className={`node-status-pill status-${stateClass}`}>
                  {isCompleted ? (
                    <>
                      <Check size={12} /> مكتمل
                    </>
                  ) : isCurrent ? (
                    <>
                      <Play size={11} fill="currentColor" /> المحطة الحالية
                    </>
                  ) : isLocked ? (
                    <>
                      <LockKeyhole size={12} /> مغلق
                    </>
                  ) : (
                    <>متاح الآن</>
                  )}
                </span>
              </div>

              <div className="node-card-body">
                <h3 className="node-item-title">{item.title}</h3>
                {isLocked ? (
                  <p className="node-item-hint">
                    أكمل العنصر السابق أولاً لفتح هذا المحتوى تلقائياً
                  </p>
                ) : isCurrent ? (
                  <p className="node-item-hint current-hint">
                    المحتوى التالي المطلوب إنجازه لمتابعة تقدمك
                  </p>
                ) : isCompleted ? (
                  <p className="node-item-hint completed-hint">
                    تم إنهاء هذه المحطة بنجاح
                  </p>
                ) : null}
              </div>

              {!isLocked && href && (
                <div className="node-card-footer">
                  <span className={`node-action-btn ${isCurrent ? 'btn-highlight' : ''}`}>
                    <span>{getCtaText(item, isCompleted)}</span>
                    <ArrowLeft size={14} className="action-arrow" />
                  </span>
                </div>
              )}
            </div>
          );

          return (
            <div
              key={item.key}
              className={`roadmap-step ${stateClass}`}
              data-item-id={item.itemId}
              data-item-type={item.itemType}
            >
              {/* Timeline Spine Column */}
              <div className="roadmap-spine" aria-hidden="true">
                <div className={`spine-line spine-top ${isFirst ? 'is-first' : ''} ${isCompleted ? 'line-completed' : ''}`} />

                <div className="spine-node">
                  <div className="node-circle">
                    {isCompleted ? (
                      <Check size={18} className="node-icon-completed" />
                    ) : isCurrent ? (
                      <div className="node-pulse-container">
                        <span className="pulse-ring" />
                        <Play size={14} fill="currentColor" className="node-icon-current" />
                      </div>
                    ) : isLocked ? (
                      <LockKeyhole size={16} className="node-icon-locked" />
                    ) : (
                      <Play size={13} fill="currentColor" className="node-icon-available" />
                    )}
                  </div>
                  <span className="spine-number">{index + 1}</span>
                </div>

                <div
                  className={`spine-line spine-bottom ${isLast ? 'is-last' : ''} ${connectorBelowCompleted ? 'line-completed' : ''}`}
                />
              </div>

              {/* Node Card Container */}
              <div className="roadmap-content-cell">
                {!isLocked && href ? (
                  <Link
                    href={href}
                    className="roadmap-link-wrapper"
                    aria-label={`${typeLabel}: ${item.title} - ${isCompleted ? 'مكتمل' : 'متاح'}`}
                  >
                    {cardContent}
                  </Link>
                ) : (
                  <div
                    className="roadmap-locked-wrapper"
                    aria-label={`${typeLabel}: ${item.title} - مغلق. أكمل العنصر السابق أولاً`}
                  >
                    {cardContent}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
