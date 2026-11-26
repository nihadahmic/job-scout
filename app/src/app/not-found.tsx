import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-zinc-500">That job doesn't exist, or this account can't see it.</p>
      <Link href="/" className="btn mt-6 inline-block">
        Back to the backlog
      </Link>
    </main>
  );
}
