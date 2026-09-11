'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, LoaderCircle, ArrowRight } from 'lucide-react';
import type { ConfirmationPreview } from '../../../lib/ai/preview-generator';

interface CompoundPlanCardProps {
  token: string;
  preview: ConfirmationPreview;
  onConfirm: (token: string) => Promise<void>;
  onCancel?: () => void;
}

export function CompoundPlanCard({
  token,
  preview,
  onConfirm,
  onCancel,
}: CompoundPlanCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const riskClass = preview.riskLevel || 'medium';
  const riskLabels: Record<string, string> = {
    low: 'منخفض المخاطر',
    medium: 'تأثير متوسط',
    high: 'عالي المخاطر (يتطلب موافقة)',
    critical: 'إجراء فائق الحساسية (حذف نهائي)',
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm(token);
    } catch (err: any) {
      setError(err?.message || 'تعذر تنفيذ الإجراء المؤكد');
    } finally {
      setLoading(false);
    }
  };

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

      {error && (
        <div className="p-2 mb-3 bg-red-900/40 border border-red-500/40 rounded text-red-200 text-xs">
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          className="ai-plan-confirm-btn"
          onClick={handleConfirm}
          disabled={loading}
          aria-label="تأكيد وتنفيذ الإجراء"
        >
          {loading ? (
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

        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={onCancel}
            disabled={loading}
            style={{ padding: '0.65rem 1rem' }}
          >
            إلغاء
          </button>
        )}
      </div>
    </div>
  );
}
