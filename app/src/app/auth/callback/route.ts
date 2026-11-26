import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing: exchange the code (PKCE) or verify the token hash, then go home. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  let error: { message: string } | null = null;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else {
    error = { message: "missing code" };
  }

  if (error) {
    const reason = /verifier/i.test(error.message) ? "browser" : "link";
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }
  return NextResponse.redirect(`${origin}/`);
}
