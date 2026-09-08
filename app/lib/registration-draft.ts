export const REGISTRATION_DRAFT_KEY = 'englizeka_registration_draft_v1';

export interface RegistrationDraft {
  firstName: string;
  secondName: string;
  thirdName: string;
  lastName: string;
  phone: string;
  fatherPhone: string;
  schoolName: string;
  governorate: string;
  gender: string;
  grade: string;
  section: string;
  email: string;
  agreementAccepted: boolean;
}

export function loadRegistrationDraft(storage?: Storage): Partial<RegistrationDraft> | null {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
  if (!store) return null;
  try {
    const raw = store.getItem(REGISTRATION_DRAFT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      firstName: typeof data.firstName === 'string' ? data.firstName : '',
      secondName: typeof data.secondName === 'string' ? data.secondName : '',
      thirdName: typeof data.thirdName === 'string' ? data.thirdName : '',
      lastName: typeof data.lastName === 'string' ? data.lastName : '',
      phone: typeof data.phone === 'string' ? data.phone : '',
      fatherPhone: typeof data.fatherPhone === 'string' ? data.fatherPhone : '',
      schoolName: typeof data.schoolName === 'string' ? data.schoolName : '',
      governorate: typeof data.governorate === 'string' ? data.governorate : '',
      gender: typeof data.gender === 'string' ? data.gender : '',
      grade: typeof data.grade === 'string' ? data.grade : '',
      section: typeof data.section === 'string' ? data.section : '',
      email: typeof data.email === 'string' ? data.email : '',
      agreementAccepted: Boolean(data.agreementAccepted),
    };
  } catch {
    return null;
  }
}

export function saveRegistrationDraft(draft: Partial<RegistrationDraft>, storage?: Storage): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
  if (!store) return;
  try {
    // Whitelist strictly NON-SENSITIVE fields.
    // Passwords, tokens, verification codes, and file contents MUST NEVER be persisted.
    const safePayload: RegistrationDraft = {
      firstName: typeof draft.firstName === 'string' ? draft.firstName : '',
      secondName: typeof draft.secondName === 'string' ? draft.secondName : '',
      thirdName: typeof draft.thirdName === 'string' ? draft.thirdName : '',
      lastName: typeof draft.lastName === 'string' ? draft.lastName : '',
      phone: typeof draft.phone === 'string' ? draft.phone : '',
      fatherPhone: typeof draft.fatherPhone === 'string' ? draft.fatherPhone : '',
      schoolName: typeof draft.schoolName === 'string' ? draft.schoolName : '',
      governorate: typeof draft.governorate === 'string' ? draft.governorate : '',
      gender: typeof draft.gender === 'string' ? draft.gender : '',
      grade: typeof draft.grade === 'string' ? draft.grade : '',
      section: typeof draft.section === 'string' ? draft.section : '',
      email: typeof draft.email === 'string' ? draft.email : '',
      agreementAccepted: Boolean(draft.agreementAccepted),
    };
    store.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(safePayload));
  } catch {
    // Gracefully handle storage errors
  }
}

export function clearRegistrationDraft(storage?: Storage): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
  if (!store) return;
  try {
    store.removeItem(REGISTRATION_DRAFT_KEY);
  } catch {
    // Gracefully handle storage errors
  }
}
