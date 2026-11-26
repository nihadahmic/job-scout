/**
 * Supabase settings from the environment. The URL is reduced to its origin, so a value
 * copied with a path ("https://x.supabase.co/rest/v1/") still works: the clients add
 * /auth/v1 and /rest/v1 themselves, and a doubled path fails with "Invalid path".
 */
export function supabaseEnv() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!rawUrl || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return { url: new URL(rawUrl).origin, key };
}
