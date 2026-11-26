"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Only existing accounts can sign in; this page never creates one.
        shouldCreateUser: false,
      },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold">Job Scout</h1>
      <p className="mb-6 text-sm text-zinc-500">Sign in with a link sent to your email.</p>
      {state === "sent" ? (
        <p className="rounded-md bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          If that address has an account, a sign-in link is on its way. Open it on this device.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
          <button type="submit" className="btn" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {state === "error" && <p className="text-sm text-rose-600">{message}</p>}
        </form>
      )}
    </main>
  );
}
