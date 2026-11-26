import type { NextConfig } from "next";

// NEXT_PUBLIC_* values are built into the JavaScript every visitor downloads. Refuse to
// build if the "publishable" variable holds a secret key (sb_secret_... or a
// service_role JWT), so a mix-up can't publish it.
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
function isSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!key.startsWith("eyJ") || !payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).role === "service_role";
  } catch {
    return false;
  }
}
if (isSecretKey(publishable)) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Use the publishable key " +
      "(sb_publishable_...) and delete this secret key in Supabase: it would have been public.",
  );
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
