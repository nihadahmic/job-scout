import Link from "next/link";
import { signOut } from "@/app/actions";

const LINKS = [
  { href: "/", label: "Backlog" },
  { href: "/insights", label: "Insights" },
  { href: "/runs", label: "Runs" },
];

export function Nav({ active }: { active: "/" | "/insights" | "/runs" | "" }) {
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-1 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
      <span className="mr-3 font-semibold">Job Scout</span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-3 py-1.5 ${
            active === l.href
              ? "bg-zinc-100 font-medium dark:bg-zinc-800"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          {l.label}
        </Link>
      ))}
      <form action={signOut} className="ml-auto">
        <button className="btn-ghost">Sign out</button>
      </form>
    </nav>
  );
}
