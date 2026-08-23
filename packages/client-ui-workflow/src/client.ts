/**
 * DSH Web GUI Client Plugin Entry for Workflow Studio (M1).
 *
 * 契约规范（docs/design/workflow-studio-design.md §2.3 / §10 P0-14 / P1-9）：
 * - package.json dsh.client.platform = "web"；bundle 入口对应 exports["./client"]；
 * - inject = ['sessions']：PresetGate 需要 sessions.list 快照 store；
 * - apply(ctx)：幂等 claim → ctx.effect 注册 release → theme/preset-gate/
 *   studio 装配；全程 try/catch 只 console.error 不 throw——外部插件
 *   不得拖垮 GUI 启动。
 */
import { claimWorkflowApply, releaseWorkflowApply } from './apply-guard.js';
import { createPresetGate, type PresetGateStore } from './preset-gate.js';
import { subscribeTheme } from './theme.js';
import {
  mountStudio,
  toggleWorkflowStudio,
  subscribeStudioOpen,
  type MountController,
} from './studio-mount.js';
import { createSidebarEntry, type SidebarEntryController } from './sidebar-entry.js';
import { WorkflowCanvas } from './canvas.js';

/** 宿主服务依赖（PresetGate 订阅 sessions.list，§10 P0-14）。 */
export const inject = ['sessions'];

export interface StudioRuntime {
  gate: PresetGateStore;
  studio: MountController;
  entry: SidebarEntryController;
  /** 全量卸载：退订门控/主题、移除入口、卸载工作台容器。 */
  dispose(): void;
}

let runtime: StudioRuntime | undefined;

/** 测试/调试辅助：当前装配好的运行时（未装配时为 undefined）。 */
export function currentStudioRuntime(): StudioRuntime | undefined {
  return runtime;
}

/**
 * Cordis Client apply entrypoint。
 */
export function apply(ctx: unknown): void {
  // 幂等守卫（§10 P1-9 成对实现）：claim 成功后经 ctx.effect 注册卸载释放，
  // 插件卸载/热重载后可再次 claim；重复 apply 直接 no-op。
  let claimed = false;
  try {
    claimed = claimWorkflowApply();
  } catch (error) {
    console.error('[dsh-workflow] apply guard failed:', error);
    return;
  }
  if (!claimed) return;

  try {
    const host = ctx as
      | { effect?: (fn: () => void, label?: string) => unknown; sessions?: unknown }
      | null
      | undefined;
    if (host && typeof host.effect === 'function') {
      // 必须传 disposer 函数引用（对齐 task-board 先例）：cordis 以回调返回值
      // 作为卸载释放器；写成 () => releaseWorkflowApply() 会注册即调用且返回
      // undefined，卸载/HMR 后 claim 永久泄漏无法重新 claim（§10 P1-9 违约）。
      host.effect(() => releaseWorkflowApply, '@dsh-workflow/client-ui-workflow: apply claim');
    }

    const gate = createPresetGate(host?.sessions);
    const studio = mountStudio();
    const entry = createSidebarEntry(toggleWorkflowStudio);

    let unsubscribeGate: (() => void) | undefined;
    let unsubscribeOpen: (() => void) | undefined;
    let unsubscribeThemeSync: (() => void) | undefined;

    const instance: StudioRuntime = {
      gate,
      studio,
      entry,
      dispose(): void {
        try {
          unsubscribeGate?.();
          unsubscribeOpen?.();
          unsubscribeThemeSync?.();
          entry.dispose();
          studio.dispose();
          gate.dispose();
        } catch (error) {
          console.error('[dsh-workflow] runtime dispose failed:', error);
        } finally {
          if (runtime === instance) runtime = undefined;
        }
      },
    };

    // 门控快照 → 入口可见性 / 高亮 / 工作台自动弹出与收起，单一同步出口。
    const syncUi = (): void => {
      try {
        const snap = gate.getSnapshot();
        entry.setVisible(snap.shouldShow);
        entry.setActive(studio.isOpen());
        studio.handleGate(snap);
      } catch (error) {
        console.error('[dsh-workflow] ui sync failed:', error);
      }
    };

    unsubscribeGate = gate.subscribe(syncUi);
    // 打开/关闭只影响入口高亮；开关逻辑已收口在 studio-mount 出口函数。
    unsubscribeOpen = subscribeStudioOpen(syncUi);
    // 主题 store 保持装配存活（tokens.css 由 CSS 层自动跟随宿主 body 属性；
    // JS 侧消费者在 M2 属性面板出现时经 getThemeSnapshot 接入）。
    unsubscribeThemeSync = subscribeTheme(() => {});

    runtime = instance;
    syncUi();

    // 卸载清理（§10.4「卸载还原属性并移除容器」的落地）：经 ctx.effect 注册
    // instance.dispose，插件 fiber 卸载/热重载时还原 html 属性并移除容器。
    if (host && typeof host.effect === 'function') {
      host.effect(() => instance.dispose, '@dsh-workflow/client-ui-workflow: ui dispose');
    }
  } catch (error) {
    console.error('[dsh-workflow] Client UI mounting error:', error);
  }
}

/* ---------------- 公共出口 ---------------- */

export { openStudio, closeWorkflowStudio, toggleWorkflowStudio, isStudioOpenNow } from './studio-mount.js';
export { addExempt, removeExempt, isExempt, WORKFLOW_AGENT_PRESET } from './preset-gate.js';
export { getThemeSnapshot, isDarkTheme } from './theme.js';

/**
 * Activation hook for test suites / custom callers.
 * 保留 WorkflowCanvas 具名导出（M2 迁移进 nodes/ 四件套体系前不删除）。
 */
export function activate(ctx?: { slots?: { register?: (def: unknown) => void } }): void {
  if (ctx && typeof ctx === 'object' && 'slots' in ctx && ctx.slots?.register) {
    ctx.slots.register({
      id: 'workflow-canvas',
      title: 'Workflow Canvas',
      icon: 'git-merge',
      component: WorkflowCanvas,
    });
  }
}

export { WorkflowCanvas };

export default {
  apply,
  activate,
  WorkflowCanvas,
};
