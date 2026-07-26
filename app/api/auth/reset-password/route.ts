import { verifyStoredCode } from "../../../lib/email-verification.ts";
import { updateStudentPassword } from "../../../lib/native-auth.ts";

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isStrongPassword(password: string): boolean {
  return password.length >= 8;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as {
      email?: string;
      code?: string;
      new_password?: string;
    };

    const email = body.email?.trim().toLowerCase();
    const code = body.code?.trim();
    const newPassword = body.new_password;

    if (!email || !email.includes("@")) {
      return jsonResponse({ error: "البريد الإلكتروني غير صحيح" }, 400);
    }
    if (!code || code.length !== 6) {
      return jsonResponse({ error: "كود التحقق يجب أن يتكون من 6 أرقام" }, 400);
    }
    if (!newPassword || !isStrongPassword(newPassword)) {
      return jsonResponse({ error: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل" }, 400);
    }

    const result = await verifyStoredCode(email, code);
    if (result === "expired") {
      return jsonResponse({ error: "انتهت صلاحية كود التحقق. اطلب كوداً جديداً." }, 400);
    }
    if (result === "locked") {
      return jsonResponse({ error: "تم تجاوز عدد المحاولات المسموحة للكود." }, 400);
    }
    if (result !== "verified" && result !== "already_verified") {
      return jsonResponse({ error: "كود التحقق غير صحيح. تأكد من الرقم المكتوب." }, 400);
    }

    const updated = await updateStudentPassword(email, newPassword);
    if (!updated) {
      return jsonResponse({ error: "لم نتمكن من العثور على الحساب لربطه." }, 400);
    }

    return jsonResponse({
      ok: true,
      message: "تم تحديث كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResponse({
      error: `تعذر تغيير كلمة المرور: ${msg}`,
    }, 400);
  }
}
