import { clearStudentSessionCookie } from "../../lib/student-session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": clearStudentSessionCookie(secure),
      "cache-control": "no-store",
    },
  });
}
