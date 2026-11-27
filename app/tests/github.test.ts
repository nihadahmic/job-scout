import { test } from "node:test";
import assert from "node:assert/strict";
import { ranToday } from "../src/lib/github.ts";

const now = new Date("2026-11-27T07:31:00Z");

test("a successful or running run today counts", () => {
  assert.equal(ranToday([{ created_at: "2026-11-27T07:30:05Z", conclusion: "success" }], now), true);
  assert.equal(ranToday([{ created_at: "2026-11-27T06:00:00Z", conclusion: null }], now), true);
});

test("yesterday's run or a failed one today doesn't count", () => {
  assert.equal(ranToday([{ created_at: "2026-11-26T19:53:46Z", conclusion: "success" }], now), false);
  assert.equal(ranToday([{ created_at: "2026-11-27T07:30:05Z", conclusion: "failure" }], now), false);
  assert.equal(ranToday([{ created_at: "2026-11-27T07:30:05Z", conclusion: "cancelled" }], now), false);
});
