import { CvManager } from "@/components/CvManager";
import { Nav } from "@/components/Nav";
import { FactsForm, PreferencesForm, WritingForm } from "@/components/ProfileForms";
import { withDefaults } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const [{ data: auth }, { data, error }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profile").select("*").maybeSingle(),
  ]);
  const profile = withDefaults(data);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Nav active="/profile" />
      <p className="mb-5 text-sm text-zinc-500">
        Your search settings and the material drafts are written from. Each section saves on its own.
        {profile.updated_at && ` Last saved ${new Date(profile.updated_at).toLocaleString("en-GB", { timeZone: "Europe/Sarajevo" })}.`}
      </p>
      {error && <p className="mb-4 text-sm text-rose-600">{error.message}</p>}
      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Search preferences</h2>
          <PreferencesForm profile={profile} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Application facts</h2>
          <FactsForm profile={profile} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Experience and writing</h2>
          <WritingForm profile={profile} />
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">CV</h2>
          {auth.user && <CvManager userId={auth.user.id} current={profile.current_cv} />}
        </section>
      </div>
    </main>
  );
}
