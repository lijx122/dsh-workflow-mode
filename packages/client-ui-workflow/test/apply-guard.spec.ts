import { beforeEach, describe, expect, it } from "vitest";
import { claimWorkflowApply, isWorkflowApplyClaimed, releaseWorkflowApply } from "../src/apply-guard.js";

describe("apply guard", () => {
  beforeEach(() => {
    releaseWorkflowApply();
  });

  it("grants the claim exactly once until released", () => {
    expect(claimWorkflowApply()).toBe(true);
    expect(claimWorkflowApply()).toBe(false);
    expect(isWorkflowApplyClaimed()).toBe(true);
  });

  it("releases idempotently so a rebuilt bundle can claim again", () => {
    claimWorkflowApply();
    releaseWorkflowApply();
    releaseWorkflowApply(); // 幂等
    expect(isWorkflowApplyClaimed()).toBe(false);
    expect(claimWorkflowApply()).toBe(true);
    releaseWorkflowApply();
  });
});
