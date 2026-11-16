'use client';

/**
 * app/components/admin/ai/AIAssistantDrawer.tsx
 *
 * Backward-compatibility wrapper delegating to the reusable AIAssistantWorkspace.
 * The primary entry point for AI is now the dedicated full-page route at /admin/ai.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { AIAssistantWorkspace } from './AIAssistantWorkspace';
import './ai-assistant.css';

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourseId?: string;
}

export function AIAssistantDrawer({ isOpen, onClose, activeCourseId }: AIAssistantDrawerProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="ai-drawer-overlay" onClick={onClose} role="presentation">
      <div
        className="ai-drawer-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="المساعد الذكي للمعلم"
      >
        <div className="ai-drawer-header-bar">
          <button
            type="button"
            className="ai-drawer-close-btn"
            onClick={onClose}
            aria-label="إغلاق المساعد الذكي"
          >
            <X size={16} />
          </button>
        </div>
        <div className="ai-drawer-inner-workspace">
          <AIAssistantWorkspace activeCourseId={activeCourseId} />
        </div>
      </div>
    </div>
  );
}
