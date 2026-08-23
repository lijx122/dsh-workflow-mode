/**
 * PresetGate (M1, §2.2 / §10 P0-2 / P2-18).
 *
 * 订阅注入的 sessions 服务（sessions.list 快照 store），取当前活动会话
 * （snapshot.current → snapshot.byId[current]）的 agentPreset 字段：
 * - agentPreset 为可选字段；undefined / 缺席一律按非 workflow 处理；
 * - 模块级 exemptSessionIds：编排器创建的临时运行会话登记于此，
 *   门控计算时跳过（M3 session-executor 使用 addExempt/removeExempt）；
 * - 输出 { shouldShow, activeSessionId } 微型 store。
 *
 * 防御性约定：会话快照形状未知处全部可选链 + try/catch，绝不 throw——
 * 外部插件不得拖垮 GUI 启动。
 */

/** 视为工作流会话的预设 id。 */
export const WORKFLOW_AGENT_PRESET = 'workflow';

export interface PresetGateSnapshot {
  /** 当前活动会话是否应展示工作流入口/面板。 */
  shouldShow: boolean;
  /** 当前活动会话 id（无活动会话时为 undefined）。 */
  activeSessionId: string | undefined;
}

export interface PresetGateStore {
  getSnapshot(): PresetGateSnapshot;
  /** 返回退订函数。 */
  subscribe(listener: () => void): () => void;
  /** 释放对 sessions.list 的订阅并清空监听者。 */
  dispose(): void;
}

/** 会话摘要中本插件关心的字段（运行时真实形状的超集防御视图）。 */
interface SessionSummaryLike {
  agentPreset?: unknown;
}

interface SessionListSnapshotLike {
  current?: unknown;
  byId?: { [sessionId: string]: SessionSummaryLike | undefined };
}

interface ListStoreLike {
  getSnapshot?: () => unknown;
  subscribe?: (listener: () => void) => unknown;
}

interface SessionsServiceLike {
  list?: ListStoreLike | undefined;
}

/** 模块级豁免集合：编排器的临时运行会话不参与门控判定。 */
const exemptSessionIds = new Set<string>();

/** 活跃 gate 实例的重算钩子：豁免集合变更时即时生效。 */
const liveRefreshers = new Set<() => void>();

function pokeAll(): void {
  for (const refresh of [...liveRefreshers]) {
    try {
      refresh();
    } catch (error) {
      console.error('[dsh-workflow] preset-gate refresh error:', error);
    }
  }
}

/** 登记豁免会话（如编排器创建的临时运行会话）。空值安全。 */
export function addExempt(sessionId: string | undefined | null): void {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  exemptSessionIds.add(sessionId);
  pokeAll();
}

/** 移除豁免会话。 */
export function removeExempt(sessionId: string | undefined | null): void {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return;
  exemptSessionIds.delete(sessionId);
  pokeAll();
}

/** 查询豁免状态（测试与调试用）。 */
export function isExempt(sessionId: string | undefined | null): boolean {
  if (typeof sessionId !== 'string') return false;
  return exemptSessionIds.has(sessionId);
}

/**
 * 由 sessions 服务创建门控 store。sessions 形状未知时不抛错，
 * 退化为永远 shouldShow=false 的空门控。
 */
export function createPresetGate(sessions: unknown): PresetGateStore {
  const service = (sessions ?? undefined) as SessionsServiceLike | undefined;
  const list = service?.list;

  const readRaw =
    typeof list?.getSnapshot === 'function'
      ? (): unknown => list.getSnapshot!()
      : (): undefined => undefined;

  function compute(): PresetGateSnapshot {
    try {
      const raw = readRaw() as SessionListSnapshotLike | undefined | null;
      const current = raw?.current;
      if (typeof current !== 'string' || current.length === 0) {
        return { shouldShow: false, activeSessionId: undefined };
      }
      const summary = raw?.byId?.[current];
      // §10 P2-18：agentPreset 缺席/undefined 一律非 workflow。
      const preset = summary?.agentPreset;
      const shouldShow =
        preset === WORKFLOW_AGENT_PRESET && !exemptSessionIds.has(current);
      return { shouldShow, activeSessionId: current };
    } catch (error) {
      console.error('[dsh-workflow] preset-gate compute error:', error);
      return { shouldShow: false, activeSessionId: undefined };
    }
  }

  let snapshot = compute();
  const listeners = new Set<() => void>();

  function refresh(): void {
    const next = compute();
    if (
      next.shouldShow !== snapshot.shouldShow ||
      next.activeSessionId !== snapshot.activeSessionId
    ) {
      snapshot = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error('[dsh-workflow] preset-gate listener error:', error);
        }
      }
    }
  }

  let unsubscribe: (() => void) | undefined;
  try {
    const result = typeof list?.subscribe === 'function' ? list.subscribe!(refresh) : undefined;
    if (typeof result === 'function') unsubscribe = result as () => void;
  } catch (error) {
    console.error('[dsh-workflow] preset-gate subscribe error:', error);
  }

  liveRefreshers.add(refresh);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      liveRefreshers.delete(refresh);
      listeners.clear();
      try {
        unsubscribe?.();
      } catch (error) {
        console.error('[dsh-workflow] preset-gate unsubscribe error:', error);
      }
      unsubscribe = undefined;
    },
  };
}
