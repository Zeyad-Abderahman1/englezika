import { ensureDatabase } from '../../../../../../db/runtime';
import { apiStaff, isStaffResponse } from '../../../../../lib/staff-auth';
import { getD1, getVideoBucket } from '../../../../../lib/platform';
import { jsonError } from '../../../../../lib/security';

export async function GET(request: Request, { params }: { params: Promise<{ email: string }> }) {
  const actor = await apiStaff(request, 'view_students');
  if (isStaffResponse(actor)) return actor;
  await ensureDatabase();
  const { email: encodedEmail } = await params;
  const email = decodeURIComponent(encodedEmail).trim().toLowerCase();
  const student = await getD1()
    .prepare(
      `SELECT birth_certificate_key AS certificateKey,
       birth_certificate_content_type AS contentType
       FROM users WHERE email = ? AND role = 'student'`
    )
    .bind(email)
    .first<{ certificateKey: string | null; contentType: string | null }>();
  if (!student?.certificateKey) return jsonError('شهادة الميلاد غير موجودة', 404);

  const object = await getVideoBucket().get(student.certificateKey);
  if (!object) return jsonError('تعذر العثور على ملف شهادة الميلاد', 404);
  const extension =
    student.contentType === 'application/pdf'
      ? 'pdf'
      : student.contentType === 'image/png'
        ? 'png'
        : 'jpg';
  return new Response(object.body, {
    headers: {
      'content-type': student.contentType || 'application/octet-stream',
      'content-disposition': `inline; filename="birth-certificate.${extension}"`,
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}
