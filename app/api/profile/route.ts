import { ensureDatabase } from '../../../db/runtime';
import { apiVerifiedUser, isResponse } from '../../lib/api-auth';
import { getD1 } from '../../lib/platform';
import { requireSameOrigin, safeText } from '../../lib/security';

export async function PUT(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await apiVerifiedUser();
  if (isResponse(user)) return user;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const name = safeText(body.name, 100) || user.fullName || user.displayName;
  const phone = safeText(body.phone, 30);
  const grade = safeText(body.grade, 60);
  const section = safeText(body.section, 60);
  const schoolName = safeText(body.school_name, 150);
  const parentJob = safeText(body.parent_job, 100);
  const governorate = safeText(body.governorate, 60);
  const gender = safeText(body.gender, 20);
  const fatherPhone = safeText(body.father_phone, 30);
  const motherPhone = safeText(body.mother_phone, 30);

  const now = Date.now();
  await ensureDatabase();
  await getD1()
    .prepare(
      `UPDATE users SET
       name = ?, phone = ?, grade = ?, section = ?, school_name = ?,
       parent_job = ?, governorate = ?, gender = ?,
       father_phone = ?, mother_phone = ?,
       updated_at = ?
     WHERE email = ?`
    )
    .bind(
      name,
      phone,
      grade,
      section,
      schoolName,
      parentJob,
      governorate,
      gender,
      fatherPhone,
      motherPhone,
      now,
      user.email.toLowerCase()
    )
    .run();

  return Response.json({ ok: true });
}
