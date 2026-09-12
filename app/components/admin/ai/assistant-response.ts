export interface AssistantInlineSegment {
  text: string;
  strong?: true;
  code?: true;
}

export type AssistantContentBlock =
  | { type: 'heading' | 'paragraph'; content: AssistantInlineSegment[] }
  | { type: 'ordered-list' | 'unordered-list'; items: AssistantInlineSegment[][] }
  | { type: 'code-block'; text: string; language?: string };

export interface CourseResultItem {
  title: string;
  grade?: string;
  status: 'published' | 'draft';
  statusLabel: 'منشور' | 'مسودة';
}

export interface CourseResultGroup {
  title: string;
  courses: CourseResultItem[];
}

function parseInline(text: string): AssistantInlineSegment[] {
  const segments: AssistantInlineSegment[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index) });
    }

    const token = match[0];
    if (token.startsWith('**')) {
      segments.push({ text: token.slice(2, -2), strong: true });
    } else {
      segments.push({ text: token.slice(1, -1), code: true });
    }
    cursor = index + token.length;
  }

  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments;
}

export function parseAssistantText(text: string): AssistantContentBlock[] {
  const source = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
  if (!source) return [];

  const lines = source.split('\n');
  const blocks: AssistantContentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^\s`]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: 'code-block',
        text: codeLines.join('\n'),
        ...(fence[1] ? { language: fence[1] } : {}),
      });
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', content: parseInline(heading[1].trim()) });
      index += 1;
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (ordered || unordered) {
      const type = ordered ? 'ordered-list' : 'unordered-list';
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*]\s+(.+)$/;
      const items: AssistantInlineSegment[][] = [];
      while (index < lines.length) {
        const item = lines[index].match(pattern);
        if (!item) break;
        items.push(parseInline(item[1].trim()));
        index += 1;
      }
      blocks.push({ type, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^#{1,3}\s+/.test(lines[index]) &&
      !/^\s*(?:\d+[.)]|[-*])\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: parseInline(paragraphLines.join('\n')) });
  }

  return blocks;
}

export function extractCourseResults(actions: unknown): CourseResultGroup | null {
  if (!Array.isArray(actions)) return null;

  const action = actions.find(
    (item) => item && typeof item === 'object' && ['list_courses', 'search_courses'].includes(String(item.tool))
  );
  const rows = action?.result?.result?.courses;
  if (!Array.isArray(rows)) return null;

  const courses = rows.flatMap((course): CourseResultItem[] => {
    if (!course || typeof course !== 'object' || typeof course.title !== 'string') return [];
    const status = course.status === 'published' ? 'published' : 'draft';
    const grade = typeof course.grade === 'string' && course.grade.trim() ? course.grade.trim() : undefined;
    return [{
      title: course.title,
      ...(grade ? { grade } : {}),
      status,
      statusLabel: status === 'published' ? 'منشور' : 'مسودة',
    }];
  });

  return { title: 'الكورسات المتاحة', courses };
}
