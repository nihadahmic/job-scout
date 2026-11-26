"use client";

/** A GET form that applies itself when a chip, checkbox or select changes. Text fields wait for Enter. */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <form
      className={className}
      onChange={(e) => {
        const target = e.target as unknown as HTMLInputElement;
        if (target.type === "text" || target.type === "search") return;
        e.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
