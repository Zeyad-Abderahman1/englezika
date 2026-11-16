import { getDatabase } from '../../../../lib/platform';
import { apiStaff, isStaffResponse } from '../../../../lib/staff-auth';
import { thumbnailResponse } from '../../../../lib/exam-thumbnail-response';

/**
 * GET /api/exams/[id]/thumbnail
 * Thumbnail of a PUBLISHED exam (used by student and admin lists). Unpublished exams are
 * only visible to staff. Artwork only: no exam content is exposed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id.length > 80) return new Response('Not Found', { status: 404 });

  const exam = await getDatabase()
    .prepare('SELECT thumbnail_key AS "thumbnailKey", status FROM exams WHERE id = ?')
    .bind(id)
    .first<{ thumbnailKey: string | null; status: string }>();
  if (!exam?.thumbnailKey) return new Response('Not Found', { status: 404 });

  if (exam.status !== 'published') {
    const staff = await apiStaff(request, 'manage_exams');
    if (isStaffResponse(staff)) return new Response('Not Found', { status: 404 });
  }
  return thumbnailResponse(request, exam.thumbnailKey);
}
