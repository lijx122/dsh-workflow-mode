/**
 * Apply idempotency guard (M1, §10 P0-9 / P1-9).
 *
 * 与 task-board apply-guard 同款：客户端 bundle 的工厂可能在同一页面生命周期内
 * 被执行两次（重复注入 / HMR 重注），不设防会挂出双实例互相覆盖激活态。
 * 约定成对使用：claim 成功后必须经 ctx.effect(() => release) 注册卸载释放，
 * 使插件卸载/热重载后可再次 claim。
 */

let claimed = false;

/** 尝试获取唯一应用权：首个调用者得 true，后续调用者得 false（no-op）。 */
export function claimWorkflowApply(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}

/** 释放应用权（配合 ctx.effect 注册的卸载回调）。幂等。 */
export function releaseWorkflowApply(): void {
  claimed = false;
}

/** 测试辅助：当前是否已被占用。 */
export function isWorkflowApplyClaimed(): boolean {
  return claimed;
}
