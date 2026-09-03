'use client';

/**
 * CourseSequenceManager
 *
 * Admin drag-and-drop course sequence editor.
 * Uses @dnd-kit for sortable reorder with keyboard fallback.
 * Shows Lecture / Exam / Quiz / Assignment items.
 * Persists via POST to /api/admin/courses/[id]/sequence.
 */

import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Trash2,
  Plus,
  BookOpen,
  GraduationCap,
  ClipboardCheck,
  FileText,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type ItemType = 'video' | 'exam' | 'assignment';

type SequenceItem = {
  id: string;
  itemType: ItemType;
  videoId?: string;
  examId?: string;
  assignmentId?: string;
  title: string;
  subtitle?: string;
};

type AvailableItem = {
  id: string;
  type: ItemType;
  title: string;
  subtitle?: string;
};

type Props = {
  courseId: string;
  courseTitle: string;
  initialItems: SequenceItem[];
  availableVideos: AvailableItem[];
  availableExams: AvailableItem[];
  availableAssignments: AvailableItem[];
  onSaved?: () => void;
  onClose?: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function itemTypeLabel(type: ItemType): string {
  if (type === 'video') return 'محاضرة';
  if (type === 'exam') return 'امتحان';
  return 'واجب';
}

function itemTypeIcon(type: ItemType) {
  if (type === 'video') return <BookOpen size={16} />;
  if (type === 'exam') return <GraduationCap size={16} />;
  return <FileText size={16} />;
}

function itemTypeColor(type: ItemType): string {
  if (type === 'video') return '#3b82f6';
  if (type === 'exam') return '#ef4444';
  return '#f59e0b';
}

// ─── Sortable Item ───────────────────────────────────────────────────────────

function SortableItem({
  item,
  index,
  totalCount,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: SequenceItem;
  index: number;
  totalCount: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="seq-manager-item"
      role="listitem"
      aria-label={`${itemTypeLabel(item.itemType)}: ${item.title}`}
    >
      <div className="seq-manager-item-drag" {...attributes} {...listeners}>
        <GripVertical size={16} />
      </div>
      <div className="seq-manager-item-num">{index + 1}</div>
      <div className="seq-manager-item-icon" style={{ color: itemTypeColor(item.itemType) }}>
        {itemTypeIcon(item.itemType)}
      </div>
      <div className="seq-manager-item-content">
        <span className="seq-manager-item-type">{itemTypeLabel(item.itemType)}</span>
        <span className="seq-manager-item-title">{item.title}</span>
        {item.subtitle && <span className="seq-manager-item-subtitle">{item.subtitle}</span>}
      </div>
      <div className="seq-manager-item-actions">
        <button
          type="button"
          className="seq-manager-btn"
          onClick={onMoveUp}
          disabled={index === 0}
          title="تحريك لأعلى"
          aria-label="تحريك لأعلى"
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          className="seq-manager-btn"
          onClick={onMoveDown}
          disabled={index === totalCount - 1}
          title="تحريك لأسفل"
          aria-label="تحريك لأسفل"
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          className="seq-manager-btn seq-manager-btn-danger"
          onClick={onRemove}
          title="إزالة من التسلسل"
          aria-label="إزالة من التسلسل"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CourseSequenceManager({
  courseId,
  courseTitle,
  initialItems,
  availableVideos,
  availableExams,
  availableAssignments,
  onSaved,
  onClose,
}: Props) {
  const [items, setItems] = useState<SequenceItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addType, setAddType] = useState<ItemType | ''>('');
  const [addItemId, setAddItemId] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const itemIds = items.map((i) => i.id);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    []
  );

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setItems((prev) => arrayMove(prev, index, index - 1));
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setItems((prev) => {
      if (index >= prev.length - 1) return prev;
      return arrayMove(prev, index, index + 1);
    });
  }, []);

  const handleRemove = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAdd = useCallback(() => {
    if (!addType || !addItemId) return;
    let source: AvailableItem | undefined;
    if (addType === 'video') source = availableVideos.find((v) => v.id === addItemId);
    else if (addType === 'exam') source = availableExams.find((e) => e.id === addItemId);
    else source = availableAssignments.find((a) => a.id === addItemId);
    if (!source) return;
    const newItem: SequenceItem = {
      id: `${addType}:${source.id}`,
      itemType: addType,
      videoId: addType === 'video' ? source.id : undefined,
      examId: addType === 'exam' ? source.id : undefined,
      assignmentId: addType === 'assignment' ? source.id : undefined,
      title: source.title,
      subtitle: source.subtitle,
    };
    setItems((prev) => [...prev, newItem]);
    setAddType('');
    setAddItemId('');
  }, [addType, addItemId, availableVideos, availableExams, availableAssignments]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/admin/courses/${courseId}/sequence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item, index) => ({
            itemType: item.itemType,
            videoId: item.videoId || null,
            examId: item.examId || null,
            assignmentId: item.assignmentId || null,
            sortOrder: index,
          })),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error || 'تعذر حفظ التسلسل');
        return;
      }
      setSuccess('تم حفظ التسلسل بنجاح');
      onSaved?.();
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }, [courseId, items, onSaved]);

  const allAvailable = [...availableVideos, ...availableExams, ...availableAssignments];
  const usedIds = new Set(items.map((i) => i.id));
  const filteredAvailable = allAvailable.filter((a) => !usedIds.has(a.id));

  return (
    <div className="seq-manager">
      <header className="seq-manager-header">
        <h3>تسلسل محتوى الكورس: {courseTitle}</h3>
        {onClose && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            إغلاق
          </button>
        )}
      </header>

      {error && <p className="seq-manager-error" role="alert">{error}</p>}
      {success && <p className="seq-manager-success">{success}</p>}

      <div className="seq-manager-list" role="list" aria-label="تسلسل المحتوى">
        {items.length === 0 ? (
          <p className="seq-manager-empty">لا توجد عناصر في التسلسل. أضف عناصر من القائمة أدناه.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  totalCount={items.length}
                  onRemove={() => handleRemove(index)}
                  onMoveUp={() => handleMoveUp(index)}
                  onMoveDown={() => handleMoveDown(index)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Add item form */}
      <div className="seq-manager-add">
        <select
          value={addType}
          onChange={(e) => { setAddType(e.target.value as ItemType | ''); setAddItemId(''); }}
          className="admin-select"
          aria-label="نوع العنصر"
        >
          <option value="">اختر النوع...</option>
          <option value="video">محاضرة</option>
          <option value="exam">امتحان</option>
          <option value="assignment">واجب</option>
        </select>
        {addType && (
          <select
            value={addItemId}
            onChange={(e) => setAddItemId(e.target.value)}
            className="admin-select"
            aria-label="اختر العنصر"
          >
            <option value="">اختر...</option>
            {addType === 'video' && availableVideos.map((v) => (
              <option key={v.id} value={v.id}>{v.title}</option>
            ))}
            {addType === 'exam' && availableExams.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
            {addType === 'assignment' && availableAssignments.map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={handleAdd}
          disabled={!addType || !addItemId}
        >
          <Plus size={14} /> إضافة
        </button>
      </div>

      {/* Save */}
      <div className="seq-manager-footer">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'جاري الحفظ...' : 'حفظ التسلسل'}
        </button>
      </div>
    </div>
  );
}
