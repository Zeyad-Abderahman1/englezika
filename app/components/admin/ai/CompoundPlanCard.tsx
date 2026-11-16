'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, LoaderCircle, ArrowRight } from 'lucide-react';
import type { ConfirmationPreview } from '../../../lib/ai/preview-generator';
import {
  shouldRenderExecuteButton,
  formatUserFacingConfirmationError,
  type ConfirmationCardState,
} from '../../../lib/ai/confirmation-state';

export type CompoundPlanCardState = ConfirmationCardState;

interface CompoundPlanCardProps {
  token: string;
  preview: ConfirmationPreview;
  onConfirm: (token: string) => Promise<void>;
  onCancel?: () => void;
  initialState?: ConfirmationCardState;
}

export function CompoundPlanCard({
  token,
  preview,
  onConfirm,
  onCancel,
  initialState = 'pending',
}: CompoundPlanCardProps) {
  const [planState, setPlanState] = useState<ConfirmationCardState>(initialState);
  const [error, setError] = useState<string | null>(null);

  const riskClass = preview.riskLevel || 'medium';
  const riskLabels: Record<string, string> = {
    low: 'منخفض المخاطر',
    medium: 'تأثير متوسط',
    high: 'عالي المخاطر (يتطلب موافقة)',
    critical: 'إجراء فائق الحساسية (حذف نهائي)',
  };

  const handleConfirm = async () => {
    if (planState !== 'pending') return;
    setPlanState('executing');
    setError(null);
    try {
      await onConfirm(token);
      setPlanState('succeeded');
    } catch (err: any) {
      setPlanState('failed');
      setError(formatUserFacingConfirmationError(err?.message));
    }
  };

  if (preview.isUnknown || !preview.requiresConfirmation || !token) {
    return (
      <div className="ai-plan-card" role="region" aria-label="إجراء غير صالح">
        <div className="ai-plan-header">
          <div className="ai-plan-title">
            <AlertTriangle size={18} className="text-amber-400" />
            <span>{preview.titleAr || preview.title || 'إجراء غير متاح'}</span>
          </div>
          <span className="ai-risk-tag low">غير قابل للتنفيذ</span>
        </div>
        <p className="text-xs text-slate-300 mb-2" style={{ margin: '0.25rem 0 0.5rem 0' }}>
          {preview.descriptionAr || preview.description || 'لا يمكن تنفيذ هذا الإجراء لأنه غير معتمد في دليل الأدوات.'}
        </p>
        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={onCancel}
            style={{ padding: '0.5rem 1rem' }}
          >
            إغلاق
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ai-plan-card" role="region" aria-label="خطة العمل المقترحة">
      <div className="ai-plan-header">
        <div className="ai-plan-title">
          {preview.riskLevel === 'critical' ? (
            <ShieldAlert size={18} className="text-red-400" />
          ) : (
            <AlertTriangle size={18} className="text-amber-400" />
          )}
          <span>{preview.titleAr || preview.title}</span>
        </div>
        <span className={`ai-risk-tag ${riskClass}`}>
          {riskLabels[preview.riskLevel] || preview.riskLevel}
        </span>
      </div>

      <p className="text-xs text-slate-300 mb-3" style={{ margin: '0.25rem 0 0.75rem 0' }}>
        {preview.descriptionAr || preview.description}
      </p>

      {/* Plan Steps List */}
      {preview.items && preview.items.length > 0 && (
        <ul className="ai-plan-steps">
          {preview.items.map((item, index) => (
            <li key={index} className="ai-plan-step-item">
              <span className="font-bold text-sky-400">#{index + 1}</span>
              <div>
                <strong>{item.titleAr || item.title}</strong>: {item.summaryAr || item.summary}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Succeeded state banner */}
      {planState === 'succeeded' && (
        <div className="p-2 mb-3 bg-emerald-950/40 border border-emerald-500/40 rounded text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <span>تم تنفيذ الإجراء وتطبيقه بنجاح.</span>
        </div>
      )}

      {/* Failed state banner */}
      {planState === 'failed' && (
        <div className="p-2 mb-3 bg-red-950/50 border border-red-500/50 rounded text-red-200 text-xs flex items-start gap-2">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <span>{error || 'تعذر تنفيذ هذا الإجراء. يرجى إنشاء طلب جديد للمحاولة مرة أخرى.'}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {/* Execute button is strictly omitted for terminal states: failed, succeeded */}
        {shouldRenderExecuteButton(planState) && (
          <button
            type="button"
            className="ai-plan-confirm-btn"
            onClick={handleConfirm}
            disabled={planState === 'executing'}
            aria-label="تأكيد وتنفيذ الإجراء"
          >
            {planState === 'executing' ? (
              <>
                <LoaderCircle size={16} className="spin" />
                <span>جاري التنفيذ والتطبيق...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>تأكيد وتنفيذ الإجراء الآن</span>
              </>
            )}
          </button>
        )}

        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={onCancel}
            disabled={planState === 'executing'}
            style={{ padding: '0.65rem 1rem' }}
          >
            {planState === 'failed' || planState === 'succeeded' ? 'إغلاق' : 'إلغاء'}
          </button>
        )}
      </div>
    </div>
  );
}
