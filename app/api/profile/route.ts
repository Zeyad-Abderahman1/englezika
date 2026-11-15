import { apiVerifiedUser, isResponse } from '../../lib/api-auth';
import { getDatabase } from '../../lib/platform';
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
  const isFirstSecondary = grade === 'أولى ثانوي';
  const finalSection = isFirstSecondary ? '' : section;
  const schoolName = safeText(body.school_name, 150);
  const parentJob = safeText(body.parent_job, 100);
  const governorate = safeText(body.governorate, 60);
  const gender = safeText(body.gender, 20);
  const fatherPhone = safeText(body.father_phone, 30);
  const motherPhone = safeText(body.mother_phone, 30);

  const now = Date.now();
  await getDatabase()
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
      finalSection,
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

  // Optional privacy choice: hide the student's name on public exam leaderboards.
  if (typeof body.hide_from_leaderboard === 'boolean' || body.hide_from_leaderboard === 'true' || body.hide_from_leaderboard === 'false') {
    const hidden = body.hide_from_leaderboard === true || body.hide_from_leaderboard === 'true';
    await getDatabase()
      .prepare('UPDATE users SET hide_from_leaderboard = ? WHERE email = ?')
      .bind(hidden, user.email.toLowerCase())
      .run();
  }

  return Response.json({ ok: true });
}
