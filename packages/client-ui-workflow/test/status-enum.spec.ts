import { describe, it, expect } from "vitest";
import { NODE_STATUSES, normalizeStatus, STATUS_META } from "../src/types.js";

describe("状态枚举（§10.8）", () => {
  it("全量六态与顺序固定", () => {
    expect([...NODE_STATUSES]).toEqual([
      "pending", "running", "completed", "failed", "skipped", "waiting_human",
    ]);
  });

  it("normalizeStatus：success 迁移为 completed，未知回落 pending", () => {
    expect(normalizeStatus("success")).toBe("completed");
    expect(normalizeStatus("completed")).toBe("completed");
    expect(normalizeStatus("running")).toBe("running");
    expect(normalizeStatus("waiting_human")).toBe("waiting_human");
    expect(normalizeStatus("skipped")).toBe("skipped");
    expect(normalizeStatus(undefined)).toBe("pending");
    expect(normalizeStatus("whatever")).toBe("pending");
    expect(normalizeStatus(42)).toBe("pending");
  });

  it("STATUS_META 覆盖全部状态", () => {
    for (const s of NODE_STATUSES) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STATUS_META)).toHaveLength(NODE_STATUSES.length);
  });
});
