import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addExempt,
  createPresetGate,
  isExempt,
  removeExempt,
  WORKFLOW_AGENT_PRESET,
} from "../src/preset-gate.js";

/** 可手动推快照的 sessions.list 测试替身（形状对齐 SnapshotStore）。 */
function fakeListStore(initial: unknown) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: unknown) {
      snapshot = next;
      for (const l of [...listeners]) l();
    },
  };
}

const listWith = (preset: string | undefined, current = "sess-1") =>
  fakeListStore({
    ids: [current],
    byId: { [current]: { id: current, agentPreset: preset, blank: false, running: false, updatedAt: 1 } },
    current,
    phase: "ready",
  });

describe("createPresetGate", () => {
  beforeEach(() => {
    removeExempt("run-session");
  });

  it("treats undefined / absent agentPreset as non-workflow (§10 P2-18)", () => {
    const gate = createPresetGate({ list: listWith(undefined) });
    expect(gate.getSnapshot().shouldShow).toBe(false);
    expect(gate.getSnapshot().activeSessionId).toBe("sess-1");

    // 缺席字段：summary 上根本没有 agentPreset 键。
    const store = fakeListStore({
      ids: ["s2"],
      byId: { s2: { id: "s2" } },
      current: "s2",
      phase: "ready",
    });
    const gate2 = createPresetGate({ list: store });
    expect(gate2.getSnapshot().shouldShow).toBe(false);
    gate.dispose();
    gate2.dispose();
  });

  it("shows only when active session preset is workflow", () => {
    const store = listWith("standard");
    const gate = createPresetGate({ list: store });
    expect(gate.getSnapshot().shouldShow).toBe(false);

    store.publish({
      ids: ["s1"],
      byId: { s1: { id: "s1", agentPreset: WORKFLOW_AGENT_PRESET } },
      current: "s1",
      phase: "ready",
    });
    expect(gate.getSnapshot().shouldShow).toBe(true);
    gate.dispose();
  });

  it("skips exempted orchestrator run sessions (§10 P0-2)", () => {
    const store = listWith(WORKFLOW_AGENT_PRESET, "run-session");
    const gate = createPresetGate({ list: store });
    expect(gate.getSnapshot().shouldShow).toBe(true);

    addExempt("run-session");
    expect(gate.getSnapshot().shouldShow).toBe(false);
    expect(isExempt("run-session")).toBe(true);

    removeExempt("run-session");
    expect(gate.getSnapshot().shouldShow).toBe(true);
    gate.dispose();
  });

  it("reacts to snapshot changes via subscribe", () => {
    const store = listWith(undefined);
    const gate = createPresetGate({ list: store });
    const seen: boolean[] = [];
    const off = gate.subscribe(() => seen.push(gate.getSnapshot().shouldShow));

    store.publish({
      ids: ["s1"],
      byId: { s1: { id: "s1", agentPreset: "workflow" } },
      current: "s1",
      phase: "ready",
    });
    expect(seen).toEqual([true]);
    off();
    gate.dispose();
  });

  it("never throws on malformed snapshots (defensive §2.2)", () => {
    const gate1 = createPresetGate(undefined);
    expect(gate1.getSnapshot()).toEqual({ shouldShow: false, activeSessionId: undefined });

    const gate2 = createPresetGate({ list: { getSnapshot: () => ({ byId: null, current: 42 }) } });
    expect(gate2.getSnapshot().shouldShow).toBe(false);

    const throwing = fakeListStore(null);
    (throwing as { getSnapshot: () => unknown }).getSnapshot = () => {
      throw new Error("boom");
    };
    const gate3 = createPresetGate({ list: throwing });
    expect(gate3.getSnapshot().shouldShow).toBe(false);
    gate1.dispose();
    gate2.dispose();
    gate3.dispose();
  });

  it("handles no active session (current undefined)", () => {
    const store = fakeListStore({ ids: [], byId: {}, current: undefined, phase: "pending" });
    const gate = createPresetGate({ list: store });
    expect(gate.getSnapshot()).toEqual({ shouldShow: false, activeSessionId: undefined });
    gate.dispose();
  });
});
