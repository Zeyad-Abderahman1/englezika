'use client';

/**
 * app/lib/admin-context.tsx
 *
 * Unified context and state management provider for Englizeka Admin and Assistant.
 * Supplies staff session info, permission checks, data synchronization,
 * global toast notifications, prompt dialogs, and confirm dialogs across
 * all admin domain pages.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { StaffPermission } from './staff-permissions';

// ─── Domain Entity Types ──────────────────────────────────────────────────────

export type Course = {
  id: string;
  title: string;
  grade: string;
  description: string;
  price: number;
  status: string;
};

export type Exam = {
  id: string;
  courseId?: string;
  title: string;
  description?: string;
  instructions?: string;
  courseTitle?: string;
  durationMinutes: number;
  passingScore: number;
  maxAttempts: number;
  status: string;
  questionCount: number;
  maxScore: number;
};

export type Enrollment = {
  id: string;
  userEmail: string;
  courseId: string;
  courseTitle: string;
  status: string;
  paymentMethod?: string;
  paymentReference?: string;
  createdAt: number;
};

export type Attempt = {
  id: string;
  userEmail: string;
  examTitle: string;
  score: number;
  maxScore: number;
  gradingMethod: string;
  submittedAt: number;
};

export type Video = {
  id: string;
  courseId: string;
  title: string;
  courseTitle: string;
  status: string;
  durationSeconds: number;
  prerequisiteExamId?: string;
  prerequisiteExamTitle?: string;
  minimumScore: number;
  maxViews?: number;
  sourceType: string;
  sourceUrl?: string;
  youtubeId?: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  message: string;
  status: string;
  createdAt: number;
};

export type Student = {
  email: string;
  name: string;
  firstName?: string;
  secondName?: string;
  thirdName?: string;
  lastName?: string;
  phone: string;
  fatherPhone: string;
  motherPhone: string;
  schoolName: string;
  parentJob?: string;
  governorate: string;
  gender: string;
  grade: string;
  section: string;
  createdAt: number;
  activeEnrollments: number;
  totalAttempts: number;
  hasBirthCertificate: number;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
};

export type Assignment = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  description: string;
  dueAt?: number | null;
  maxScore: number;
  status: string;
  /** pdf | mcq | generic — requires database migration */
  type: string;
  /** 1 if a teacher file has been uploaded, 0 otherwise */
  hasTeacherFile: number;
};

export type LectureAccessCodeHistory = {
  id: string;
  videoId: string;
  displaySuffix: string;
  createdAt: number;
  redeemedAt: number | null;
  videoTitle: string;
  courseTitle: string;
};

export type AccessCodeBatch = {
  id: string;
  course_id: string;
  video_id: string;
  count: number;
  created_by: string;
  created_at: number;
  video_title: string | null;
  course_title: string | null;
};

export type StaffAccount = {
  email: string;
  name: string;
  role: string;
  permissions: string;
  active: number;
  lockedUntil?: number;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type Counts = {
  students: number;
  activeEnrollments: number;
  pendingEnrollments: number;
  publishedExams: number;
  attempts: number;
  averageScore: number;
  newMessages: number;
};

export type AdminData = {
  admin: {
    email: string;
    name: string;
    role: 'teacher' | 'assistant';
    permissions: StaffPermission[];
  };
  counts: Counts;
  courses: Course[];
  exams: Exam[];
  assignments: Assignment[];
  enrollments: Enrollment[];
  attempts: Attempt[];
  videos: Video[];
  accessCodes: LectureAccessCodeHistory[];
  accessCodeBatches?: AccessCodeBatch[];
  contacts: Contact[];
  announcements: Announcement[];
  pagination: {
    courses: Pagination;
    assignments: Pagination;
    announcements: Pagination;
    exams: Pagination;
    enrollments: Pagination;
    attempts: Pagination;
    videos: Pagination;
    contacts: Pagination;
  };
};

export type QuestionDraft = {
  type: string;
  prompt: string;
  options: string;
  correctAnswer: string;
  rubric: string;
  explanation: string;
  points: number;
  imageFile?: File | null;
};

// ─── Modal Types ──────────────────────────────────────────────────────────────

export type PromptField = {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
};

export type PromptModalState = {
  isOpen: boolean;
  title: string;
  fields: PromptField[];
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
};

export type ConfirmDialogState = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  requireMatch?: string;
  onConfirm: () => void | Promise<void>;
};

// ─── API Helper ───────────────────────────────────────────────────────────────

export async function adminApiRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };
  if (response.status === 401 && path.startsWith('/api/admin/')) {
    window.location.assign('/staff/login');
  }
  if (!response.ok) {
    throw new Error(result.error || 'تعذر تنفيذ العملية');
  }
  return result;
}

// ─── Context Interface ────────────────────────────────────────────────────────

interface AdminContextValue {
  data: AdminData | null;
  admin: AdminData['admin'] | null;
  counts: Counts;
  loading: boolean;
  error: string;
  notice: string;
  busy: boolean;
  light: boolean;
  sidebarOpen: boolean;
  promptModal: PromptModalState;
  confirmDialog: ConfirmDialogState;
  setSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setError: (err: string) => void;
  setNotice: (not: string) => void;
  toggleTheme: () => void;
  refreshData: (page?: number) => Promise<void>;
  mutate: (action: () => Promise<unknown>, successNotice: string) => Promise<boolean>;
  can: (permission: StaffPermission) => boolean;
  isTeacher: boolean;
  openPrompt: (prompt: Omit<PromptModalState, 'isOpen'>) => void;
  closePrompt: () => void;
  openConfirm: (confirm: Omit<ConfirmDialogState, 'isOpen'>) => void;
  closeConfirm: () => void;
}

const defaultCounts: Counts = {
  students: 0,
  activeEnrollments: 0,
  pendingEnrollments: 0,
  publishedExams: 0,
  attempts: 0,
  averageScore: 0,
  newMessages: 0,
};

const AdminContext = createContext<AdminContextValue | null>(null);

// ─── Provider Component ───────────────────────────────────────────────────────

export function AdminProvider({
  children,
  initialData,
}: {
  children: ReactNode;
  initialData?: AdminData | null;
}) {
  const [data, setData] = useState<AdminData | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [light, setLight] = useState(false);

  // Theme synchronization
  useEffect(() => {
    const savedTheme = window.localStorage.getItem('englizeka-theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const shouldUseLight = savedTheme ? savedTheme === 'light' : prefersLight;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLight(shouldUseLight);
    document.documentElement.dataset.theme = shouldUseLight ? 'light' : 'dark';
    document.documentElement.style.colorScheme = shouldUseLight ? 'light' : 'dark';
  }, []);

  const toggleTheme = useCallback(() => {
    setLight((prev) => {
      const next = !prev;
      document.documentElement.dataset.theme = next ? 'light' : 'dark';
      document.documentElement.style.colorScheme = next ? 'light' : 'dark';
      window.localStorage.setItem('englizeka-theme', next ? 'light' : 'dark');
      return next;
    });
  }, []);

  // Prompt Modal
  const [promptModal, setPromptModal] = useState<PromptModalState>({
    isOpen: false,
    title: '',
    fields: [],
    onSubmit: () => {},
  });

  const openPrompt = useCallback((prompt: Omit<PromptModalState, 'isOpen'>) => {
    setPromptModal({ isOpen: true, ...prompt });
  }, []);

  const closePrompt = useCallback(() => {
    setPromptModal({ isOpen: false, title: '', fields: [], onSubmit: () => {} });
  }, []);

  // Confirm Dialog
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const openConfirm = useCallback((confirm: Omit<ConfirmDialogState, 'isOpen'>) => {
    setConfirmDialog({ isOpen: true, ...confirm });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmDialog({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  }, []);

  // Data Refresh
  const refreshData = useCallback(async (pageNumber = 1) => {
    setError('');
    try {
      const res = (await adminApiRequest(
        `/api/admin/bootstrap?page=${pageNumber}&pageSize=50`,
        { cache: 'no-store' }
      )) as unknown as AdminData;
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الإدارة');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch if initialData was not provided
  useEffect(() => {
    if (!initialData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshData(1);
    }
  }, [initialData, refreshData]);

  // Mutation helper
  const mutate = useCallback(
    async (action: () => Promise<unknown>, successNotice: string): Promise<boolean> => {
      setBusy(true);
      setError('');
      setNotice('');
      try {
        await action();
        setNotice(successNotice);
        await refreshData(1);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تنفيذ العملية');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refreshData]
  );

  const can = useCallback(
    (permission: StaffPermission): boolean => {
      if (!data?.admin) return false;
      if (data.admin.role === 'teacher') return true;
      return data.admin.permissions.includes(permission);
    },
    [data]
  );

  const isTeacher = useMemo(() => data?.admin?.role === 'teacher', [data]);

  const value: AdminContextValue = {
    data,
    admin: data?.admin || null,
    counts: data?.counts || defaultCounts,
    loading,
    error,
    notice,
    busy,
    light,
    sidebarOpen,
    promptModal,
    confirmDialog,
    setSidebarOpen,
    setError,
    setNotice,
    toggleTheme,
    refreshData,
    mutate,
    can,
    isTeacher,
    openPrompt,
    closePrompt,
    openConfirm,
    closeConfirm,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}
