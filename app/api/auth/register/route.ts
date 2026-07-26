import { registerStudent } from '../../../lib/native-auth';
import {
  createVerificationCode,
  hashVerificationCode,
  isEmailTestMode,
  recordDeliveryId,
  releaseFailedDelivery,
  saveVerificationCode,
  sendVerificationEmail,
  VERIFICATION_CODE_TTL_MS,
} from '../../../lib/email-verification';
import { isStrongPassword, jsonError, requireSameOrigin, safeText } from '../../../lib/security';
import { createStudentSession, studentSessionCookie } from '../../../lib/student-session';
import { checkRateLimit, getClientIp, rateLimitResponse } from '../../../lib/rate-limit';

const EGYPTIAN_GOVERNORATES = [
  'القاهرة',
  'الجيزة',
  'الإسكندرية',
  'الدقهلية',
  'الشرقية',
  'المنوفية',
  'القليوبية',
  'الغربية',
  'كفر الشيخ',
  'دمياط',
  'الإسماعيلية',
  'بورسعيد',
  'السويس',
  'شمال سيناء',
  'جنوب سيناء',
  'البحيرة',
  'المنيا',
  'أسيوط',
  'سوهاج',
  'قنا',
  'الأقصر',
  'أسوان',
  'البحر الأحمر',
  'الفيوم',
  'بني سويف',
  'مطروح',
  'الوادي الجديد',
];

const VALID_GRADES = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];
const VALID_GENDERS = ['ذكر', 'أنثى'];

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit('student-register', ip, 5, 300);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck.resetAfterSeconds);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const email = safeText(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const passwordConfirm = typeof body.password_confirm === 'string' ? body.password_confirm : '';
  const firstName = safeText(body.first_name, 60);
  const secondName = safeText(body.second_name, 60);
  const thirdName = safeText(body.third_name, 60);
  const lastName = safeText(body.last_name, 60);
  const phone = safeText(body.phone, 30);
  const fatherPhone = safeText(body.father_phone, 30);
  const motherPhone = safeText(body.mother_phone, 30);
  const schoolName = safeText(body.school_name, 150);
  const parentJob = safeText(body.parent_job, 100);
  const governorate = safeText(body.governorate, 60);
  const gender = safeText(body.gender, 20);
  const grade = safeText(body.grade, 60);
  const section = safeText(body.section, 60);

  // --- Validation ---
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('البريد الإلكتروني غير صحيح');
  }
  if (!firstName) return jsonError('الاسم الأول مطلوب');
  if (!lastName) return jsonError('الاسم الأخير مطلوب');
  if (!phone || !/^[0-9+\s\-]{7,20}$/.test(phone)) {
    return jsonError('رقم الهاتف غير صحيح');
  }
  if (!fatherPhone || !/^[0-9+\s\-]{7,20}$/.test(fatherPhone)) {
    return jsonError('رقم هاتف الأب غير صحيح');
  }
  if (!motherPhone || !/^[0-9+\s\-]{7,20}$/.test(motherPhone)) {
    return jsonError('رقم هاتف الأم غير صحيح');
  }
  if (!schoolName) return jsonError('اسم المدرسة مطلوب');
  if (!EGYPTIAN_GOVERNORATES.includes(governorate)) return jsonError('اختر المحافظة من القائمة');
  if (!VALID_GENDERS.includes(gender)) return jsonError('اختر النوع من القائمة');
  if (!VALID_GRADES.includes(grade)) return jsonError('اختر الصف الدراسي من القائمة');
  if (!section) return jsonError('اختر الشعبة');
  if (!isStrongPassword(password)) {
    return jsonError(
      'كلمة المرور يجب أن تكون 12 حرفاً على الأقل، وتحتوي على حرف كبير، وحرف صغير، ورقم، ورمز خاص (!@#$%).'
    );
  }
  if (password !== passwordConfirm) return jsonError('كلمتا السر غير متطابقتين');

  const result = await registerStudent({
    email,
    password,
    firstName,
    secondName,
    thirdName,
    lastName,
    phone,
    fatherPhone,
    motherPhone,
    schoolName,
    parentJob,
    governorate,
    gender,
    grade,
    section,
  });

  if (result === 'email_taken') {
    return jsonError('هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول.', 409);
  }

  // Create session immediately after registration
  const session = await createStudentSession(email);
  const secure = new URL(request.url).protocol === 'https:';
  const now = Date.now();

  // Send verification code
  let testCode: string | undefined;
  try {
    const code = createVerificationCode();
    const codeHash = await hashVerificationCode(email, code);
    await saveVerificationCode(email, codeHash, now);
    const idempotencyKey = `verify-${codeHash.slice(0, 32)}`;
    try {
      const deliveryId = await sendVerificationEmail(email, code, idempotencyKey);
      await recordDeliveryId(email, codeHash, deliveryId);
    } catch {
      await releaseFailedDelivery(email, codeHash);
    }
    if (isEmailTestMode()) testCode = code;
  } catch {
    // Registration + session succeeded even if email fails
  }

  return new Response(
    JSON.stringify({
      ok: true,
      expiresIn: Math.round(VERIFICATION_CODE_TTL_MS / 1000),
      ...(testCode ? { testCode } : {}),
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': studentSessionCookie(session.token, secure),
        'cache-control': 'no-store',
      },
    }
  );
}
