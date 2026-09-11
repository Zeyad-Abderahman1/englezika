import { getToolDefinition, type AiToolName } from './tool-registry';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ActionPreviewItem {
  type: string;
  title: string;
  titleAr: string;
  summary: string;
  summaryAr: string;
  riskLevel: RiskLevel;
  details: Record<string, unknown>;
}

export interface ConfirmationPreview {
  actionType: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  items: ActionPreviewItem[];
  metadata?: Record<string, unknown>;
}

/**
 * Generates human-readable, bilingual (Arabic & English) previews
 * for tool calls and compound plans prior to teacher confirmation.
 */
export function generateActionPreview(actionType: string, payload: Record<string, any>): ConfirmationPreview {
  if (actionType === 'compound_plan') {
    return generateCompoundPlanPreview(payload);
  }

  const tool = getToolDefinition(actionType as AiToolName);
  const riskLevel: RiskLevel = tool ? tool.riskLevel : 'high';
  const requiresConfirmation = tool ? tool.confirmationPolicy !== 'none' : true;

  switch (actionType) {
    case 'update_course_price': {
      const price = payload.price;
      const courseId = payload.courseId || '';
      return {
        actionType,
        title: 'Update Course Price',
        titleAr: 'تعديل سعر الدورة',
        description: `Change price for course ${courseId} to ${price} EGP`,
        descriptionAr: `تعديل سعر الدورة (${courseId}) إلى ${price} جنيه مصري`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: 'Update Price',
            titleAr: 'تعديل السعر',
            summary: `Set price to ${price} EGP`,
            summaryAr: `تحديد السعر بمبلغ ${price} ج.م`,
            riskLevel,
            details: { courseId, price },
          },
        ],
      };
    }

    case 'update_course_status': {
      const status = payload.status;
      const courseId = payload.courseId || '';
      const isPublish = status === 'published';
      return {
        actionType,
        title: isPublish ? 'Publish Course' : 'Change Course Status',
        titleAr: isPublish ? 'نشر الدورة للطلاب' : 'تغيير حالة الدورة',
        description: `Change course ${courseId} status to "${status}"`,
        descriptionAr: isPublish
          ? `نشر الدورة (${courseId}) وإتاحتها لجميع الطلاب المشتركين`
          : `تغيير حالة الدورة (${courseId}) إلى "${status}"`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: isPublish ? 'Publish Course' : 'Update Status',
            titleAr: isPublish ? 'نشر الدورة' : 'تعديل الحالة',
            summary: `Status: ${status}`,
            summaryAr: `الحالة: ${status === 'published' ? 'منشور' : status === 'archived' ? 'مؤرشف' : 'مسودة'}`,
            riskLevel,
            details: { courseId, status },
          },
        ],
      };
    }

    case 'delete_course': {
      const courseId = payload.courseId || '';
      return {
        actionType,
        title: 'Delete Course',
        titleAr: 'حذف الدورة بالكامل',
        description: `Permanently delete course ${courseId} and all associated lectures/exams`,
        descriptionAr: `حذف الدورة (${courseId}) نهائياً مع كافة المحاضرات والامتحانات المرتبطة بها`,
        riskLevel: 'critical',
        requiresConfirmation: true,
        items: [
          {
            type: actionType,
            title: 'Delete Course',
            titleAr: 'حذف دورة',
            summary: `Delete course ID: ${courseId}`,
            summaryAr: `حذف معرف الدورة: ${courseId}`,
            riskLevel: 'critical',
            details: { courseId },
          },
        ],
      };
    }

    case 'delete_lecture': {
      const lectureId = payload.lectureId || '';
      return {
        actionType,
        title: 'Delete Lecture',
        titleAr: 'حذف المحاضرة',
        description: `Delete lecture ${lectureId}`,
        descriptionAr: `حذف المحاضرة (${lectureId}) نهائياً من الدورة`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: 'Delete Lecture',
            titleAr: 'حذف محاضرة',
            summary: `Lecture ID: ${lectureId}`,
            summaryAr: `معرف المحاضرة: ${lectureId}`,
            riskLevel,
            details: { lectureId },
          },
        ],
      };
    }

    case 'publish_assessment': {
      const assessmentId = payload.assessmentId || '';
      return {
        actionType,
        title: 'Publish Assessment',
        titleAr: 'نشر الامتحان / الواجب',
        description: `Publish assessment ${assessmentId} to make it available to students`,
        descriptionAr: `نشر التقييم (${assessmentId}) ليصبح متاحاً للطلاب فوراً`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: 'Publish Assessment',
            titleAr: 'نشر تقييم',
            summary: `Assessment ID: ${assessmentId}`,
            summaryAr: `معرف التقييم: ${assessmentId}`,
            riskLevel,
            details: { assessmentId },
          },
        ],
      };
    }

    case 'delete_assessment': {
      const assessmentId = payload.assessmentId || '';
      return {
        actionType,
        title: 'Delete Assessment',
        titleAr: 'حذف التقييم',
        description: `Delete assessment ${assessmentId}`,
        descriptionAr: `حذف التقييم (${assessmentId}) نهائياً بما فيه من أسئلة وإجابات`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: 'Delete Assessment',
            titleAr: 'حذف تقييم',
            summary: `Assessment ID: ${assessmentId}`,
            summaryAr: `معرف التقييم: ${assessmentId}`,
            riskLevel,
            details: { assessmentId },
          },
        ],
      };
    }

    case 'delete_announcement': {
      const announcementId = payload.announcementId || '';
      return {
        actionType,
        title: 'Delete Announcement',
        titleAr: 'حذف الإعلان',
        description: `Delete announcement ${announcementId}`,
        descriptionAr: `حذف الإعلان (${announcementId}) نهائياً`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: 'Delete Announcement',
            titleAr: 'حذف إعلان',
            summary: `Announcement ID: ${announcementId}`,
            summaryAr: `معرف الإعلان: ${announcementId}`,
            riskLevel,
            details: { announcementId },
          },
        ],
      };
    }

    case 'bulk_create_assessment_questions': {
      const count = Array.isArray(payload.questions) ? payload.questions.length : 0;
      return {
        actionType,
        title: 'Insert Generated Questions',
        titleAr: 'إدراج الأسئلة المُنشأة',
        description: `Insert ${count} questions into assessment ${payload.assessmentId}`,
        descriptionAr: `إدراج عدد ${count} سؤال في التقييم (${payload.assessmentId})`,
        riskLevel: 'medium',
        requiresConfirmation: true,
        items: [
          {
            type: actionType,
            title: 'Batch Insert Questions',
            titleAr: 'إدراج حزمة أسئلة',
            summary: `${count} questions prepared for review`,
            summaryAr: `تم تجهيز عدد ${count} سؤال للمراجعة`,
            riskLevel: 'medium',
            details: { assessmentId: payload.assessmentId, questionCount: count },
          },
        ],
      };
    }

    default: {
      const name = tool?.name || actionType;
      return {
        actionType,
        title: `Execute ${name}`,
        titleAr: `تنفيذ إجراء: ${name}`,
        description: `Requesting confirmation to execute ${name}`,
        descriptionAr: `طلب تأكيد لتنفيذ العملية (${name})`,
        riskLevel,
        requiresConfirmation,
        items: [
          {
            type: actionType,
            title: name,
            titleAr: name,
            summary: JSON.stringify(payload).slice(0, 100),
            summaryAr: JSON.stringify(payload).slice(0, 100),
            riskLevel,
            details: payload,
          },
        ],
      };
    }
  }
}

/**
 * Generates preview for a compound multi-step plan
 */
function generateCompoundPlanPreview(payload: Record<string, any>): ConfirmationPreview {
  const steps: Array<{ tool: string; payload: Record<string, any> }> = Array.isArray(payload.steps)
    ? payload.steps
    : [];

  let highestRisk: RiskLevel = 'low';
  const riskWeights: Record<RiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  const items: ActionPreviewItem[] = steps.map((step, idx) => {
    const singlePreview = generateActionPreview(step.tool, step.payload);
    const item = singlePreview.items[0] || {
      type: step.tool,
      title: step.tool,
      titleAr: step.tool,
      summary: `Step ${idx + 1}`,
      summaryAr: `الخطوة ${idx + 1}`,
      riskLevel: 'low' as RiskLevel,
      details: step.payload,
    };

    if (riskWeights[item.riskLevel] > riskWeights[highestRisk]) {
      highestRisk = item.riskLevel;
    }
    return item;
  });

  // Compound plans with >2 actions escalate risk to at least 'medium'
  if (steps.length > 2 && riskWeights[highestRisk] < riskWeights['medium']) {
    highestRisk = 'medium';
  }

  return {
    actionType: 'compound_plan',
    title: `Multi-Action Plan (${steps.length} steps)`,
    titleAr: `خطة عمل متعددة الخطوات (${steps.length} خطوات)`,
    description: `Executing ${steps.length} coordinated actions across course materials`,
    descriptionAr: `تنفيذ ${steps.length} إجراءات منسقة عبر المواد التعليمية والدورات`,
    riskLevel: highestRisk,
    requiresConfirmation: true, // Always requires confirmation for compound plans
    items,
    metadata: {
      stepCount: steps.length,
      planTitle: payload.title || undefined,
    },
  };
}
