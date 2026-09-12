import React from 'react';
import { BookOpen, GraduationCap } from 'lucide-react';
import {
  extractCourseResults,
  parseAssistantText,
  type AssistantInlineSegment,
} from './assistant-response';

interface AssistantMessageContentProps {
  text: string;
  actionsExecuted?: Array<{ tool: string; result: unknown }>;
}

function InlineContent({ segments }: { segments: AssistantInlineSegment[] }) {
  return segments.map((segment, index) => {
    if (segment.strong) return <strong key={index}>{segment.text}</strong>;
    if (segment.code) return <code key={index} dir="ltr">{segment.text}</code>;
    return <React.Fragment key={index}>{segment.text}</React.Fragment>;
  });
}

export function AssistantMessageContent({ text, actionsExecuted }: AssistantMessageContentProps) {
  const courseResults = extractCourseResults(actionsExecuted);
  const blocks = parseAssistantText(text);
  const richText = (
    <div className="ai-rich-text">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h2 key={index}><InlineContent segments={block.content} /></h2>;
        if (block.type === 'paragraph') return <p key={index}><InlineContent segments={block.content} /></p>;
        if (block.type === 'code-block') return <pre key={index} dir="ltr" data-language={block.language || undefined}><code>{block.text}</code></pre>;
        if (block.type === 'ordered-list' || block.type === 'unordered-list') {
          const List = block.type === 'ordered-list' ? 'ol' : 'ul';
          return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent segments={item} /></li>)}</List>;
        }
        return null;
      })}
    </div>
  );

  return <div className="ai-message-content">{richText}{courseResults ? (
      <section className="ai-course-results" aria-label={courseResults.title}>
        <header className="ai-course-results-header">
          <span className="ai-course-results-icon" aria-hidden="true"><BookOpen size={18} /></span>
          <div>
            <h2>{courseResults.title}</h2>
            <p>{courseResults.courses.length} {courseResults.courses.length === 1 ? 'كورس' : 'كورسات'}</p>
          </div>
        </header>

        {courseResults.courses.length > 0 ? (
          <ul className="ai-course-results-list">
            {courseResults.courses.map((course, index) => (
              <li className="ai-course-result-row" key={`${course.title}-${index}`}>
                <span className="ai-course-result-index" aria-hidden="true">{index + 1}</span>
                <div className="ai-course-result-main">
                  <strong>{course.title}</strong>
                  {course.grade && (
                    <span className="ai-course-result-grade">
                      <GraduationCap size={14} aria-hidden="true" />
                      الصف <bdi dir="ltr">{course.grade}</bdi>
                    </span>
                  )}
                </div>
                <span className={`ai-course-status ${course.status}`}>{course.statusLabel}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ai-course-results-empty">لا توجد كورسات متاحة حالياً.</p>
        )}
      </section>
    ) : null}</div>;
}
