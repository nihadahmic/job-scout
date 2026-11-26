import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUMNS = ["applied_day", "company", "title", "status", "source", "category", "replied_at", "interviewed", "offered", "url"] as const;

function cell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** All applications as CSV, for spreadsheets and the case study. */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select(COLUMNS.join(","))
    .order("applied_at", { ascending: true })
    .limit(10000);
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="applications.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
