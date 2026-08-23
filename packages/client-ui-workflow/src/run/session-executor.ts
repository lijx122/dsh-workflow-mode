/**
 * Session Executor (M3, design §5.1 / §10 P0-2 / P1-21).
 *
 * llm / subagent 节点经真实 DSH 会话执行：createSession({workspaceId,preset})
 * → addExempt(id) → 投递 prompt → 等 turn 结束回收文本为 outputs.text
 * → removeExempt(id)。输出同时携带 result 字段（llm 带 outputSchema 时为
 * 解析后的 JSON，否则与 text 同值），保持与 packages/engine 同名执行器的
 * 变量引用方言兼容（如 {{#node.result.riskLevel}}）。
 *
 * human 节点优先探测宿主 pendingInteraction 能力；不可用落回本地 paused 态，
 * 两态均由编排器产出 waiting_human 视觉信号。恢复统一走 approveHuman()。
 *
 * 依赖注入：sessions 句柄构造传参（不直接 import client runtime）；
 * createMockSessions() 供单测驱动全链路。
 */
import type { WorkflowNode } from '@dsh-workflow/schema';
import { addExempt, removeExempt } from '../preset-gate.js';

// ---------------- 会话句柄（防御性视图） ----------------

/** 单条消息的最小视图。 */
export interface ChatMessageLike {
  role?: unknown;
  content?: unknown;
}

/** 会话对象的最小防御视图（真实 DSH 会话的超集）。 */
export interface SessionLike {
  id?: unknown;
  prompt?: (input: unknown) => Promise<unknown>;
  chat?: { messages?: ChatMessageLike[] };
}

export interface CreateSessionArgs {
  workspaceId: string;
  preset: string;
}

/**
 * sessions 服务句柄：编排器经此创建/操作运行会话。
 * 真实实现由 client runtime inject('sessions') 提供；
 * 测试用 createMockSessions() 构造等价物。
 */
export interface SessionsHandle {
  createSession(args: CreateSessionArgs): Promise<SessionLike | undefined>;
}

// ---------------- pendingInteraction 探测（P1-21） ----------------

/**
 * 宿主人机审批能力探测结果。
 * 注：宿主交互响应通道本期未实证（对齐 P0-1 的证据标准），探测仅作能力上报；
 * 审批恢复统一走编排器 approveHuman() 本地 paused 闭环。
 */
export interface PendingInteractionProbe {
  available: boolean;
  /** 探得的宿主交互 id；仅 available=true 时存在。 */
  interactionId?: string;
}

interface InteractionCandidate {
  id?: unknown;
}

function findPendingInteraction(host: unknown): InteractionCandidate | undefined {
  if (host === null || typeof host !== 'object') return undefined;
  const buckets: unknown[] = [];
  try {
    buckets.push(
      (host as Record<string, unknown>)['pendingInteraction'],
      (host as Record<string, unknown>)['pendingInteractions'],
      (host as Record<string, unknown>)['interactions'],
    );
    const ui = (host as Record<string, unknown>)['ui'];
    if (ui !== null && typeof ui === 'object') {
      buckets.push(
        (ui as Record<string, unknown>)['pendingInteraction'],
        (ui as Record<string, unknown>)['pendingInteractions'],
      );
    }
  } catch {
    return undefined;
  }
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      const first = bucket.find(
        (it): it is InteractionCandidate => it !== null && typeof it === 'object',
      );
      if (first) return first;
    } else if (bucket !== null && typeof bucket === 'object') {
      return bucket as InteractionCandidate;
    }
  }
  return undefined;
}

/** 探测宿主 pendingInteraction 能力；任何异常一律视为不可用。 */
export function probePendingInteraction(host: unknown): PendingInteractionProbe {
  try {
    const found = findPendingInteraction(host);
    if (!found || typeof found.id !== 'string' || found.id.length === 0) {
      return { available: false };
    }
    return { available: true, interactionId: found.id };
  } catch {
    return { available: false };
  }
}

// ---------------- 回收文本 ----------------

/** 从会话聊天记录回收最后一轮 assistant 文本。 */
export function collectText(session: SessionLike | undefined): string {
  try {
    const messages = session?.chat?.messages;
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant') {
        const content = msg.content;
        if (typeof content === 'string') return content;
        if (content != null) return JSON.stringify(content);
        return '';
      }
    }
    return '';
  } catch (error) {
    console.error('[dsh-workflow] collectText failed:', error);
    return '';
  }
}

/** lenient JSON 提取：outputSchema 存在时尝试解析模型文本为对象，失败回退原文。 */
function extractResult(text: string, wantsJson: boolean): unknown {
  if (!wantsJson) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------- 执行入口 ----------------

export interface SessionNodeResult {
  outputs: Record<string, unknown>;
}

export interface RunSessionNodeOptions {
  node: WorkflowNode;
  prompt: string;
  systemPrompt?: string;
  workspaceId?: string;
  signal?: AbortSignal;
  onLog?(msg: string): void;
  /** human 断点的宿主能力探测来源（通常为 client ctx）。 */
  host?: unknown;
  /**
   * 本地 paused 态恢复器。返回的 promise 在 approveHuman()
   * 批准(approved)/驳回(rejected)或运行中止时落定。
   */
  localPause?: (request: { nodeId: string; prompt: string }) => Promise<'approved' | 'rejected'>;
}

class HumanTimeoutError extends Error {
  constructor(nodeId: string, timeoutMs: number) {
    super(`节点 "${nodeId}" 审批等待超时（${timeoutMs}ms）`);
    this.name = 'HumanTimeoutError';
  }
}

/**
 * 会话驱动执行统一入口（llm / subagent / human）。
 * AbortSignal 已中止时不再创建会话（✕ = 不派发新节点的执行侧防线）；
 * 已创建的 prompt 等待自然返回后正常回收（✕ 不打断在途回合）。
 */
export async function runSessionNode(
  sessions: SessionsHandle,
  options: RunSessionNodeOptions,
): Promise<SessionNodeResult> {
  const { node, prompt, signal, onLog } = options;

  if (node.type === 'human') {
    return runHumanNode(options);
  }

  if (signal?.aborted) {
    throw new Error(`节点 "${node.id}" 在派发前已被中止`);
  }

  const isSubagent = node.type === 'subagent';
  const workspaceId =
    options.workspaceId ?? (isSubagent ? `subagent:${node.id}` : 'workflow-run');
  const preset = isSubagent ? readPreset(node) : 'standard';

  let session: SessionLike | undefined;
  try {
    session = await sessions.createSession({ workspaceId, preset });
  } catch (error) {
    throw new Error(
      `节点 "${node.id}" 创建运行会话失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!session || typeof session.id !== 'string' || session.id.length === 0) {
    throw new Error(`节点 "${node.id}" 创建运行会话返回无效会话`);
  }

  // §10 P0-2 + REVISE P1-2：登记豁免；onLog 抛错不得影响豁免配对与回收
  try {
    addExempt(session.id);
    onLog?.(`[${node.id}] 运行会话 ${session.id} 已创建并登记豁免（workspace=${workspaceId}, preset=${preset}）`);
  } catch (error) {
    console.error('[dsh-workflow] addExempt/log error:', error);
  }

  try {
    const fullPrompt =
      options.systemPrompt && options.systemPrompt.length > 0
        ? `${options.systemPrompt}\n\n${prompt}`
        : prompt;
    if (typeof session.prompt !== 'function') {
      throw new Error('运行会话缺少 prompt() 方法');
    }
    await session.prompt(fullPrompt); // ✕ 后已发出的 prompt 自然等待返回
    let text = '';
    try {
      text = collectText(session);
    } catch (error) {
      console.error('[dsh-workflow] collectText error:', error);
    }
    try {
      onLog?.(`[${node.id}] 会话回合结束，回收 ${text.length} 字符`);
    } catch (error) {
      console.error('[dsh-workflow] onLog callback error:', error);
    }

    const outputs: Record<string, unknown> = { text };
    if (isSubagent) {
      outputs.result = text;
    } else {
      const schema = (node as { outputSchema?: unknown }).outputSchema;
      outputs.result = extractResult(text, schema !== undefined && schema !== null);
    }
    return { outputs };
  } finally {
    // REVISE P1-2：任何异常路径（含 prompt 抛错）都保证移除豁免
    removeExempt(session.id);
  }
}

function readPreset(node: WorkflowNode): string {
  const preset = (node as { preset?: unknown }).preset;
  return typeof preset === 'string' && preset.length > 0 ? preset : 'workflow';
}

export async function runHumanNode(options: RunSessionNodeOptions): Promise<SessionNodeResult> {
  const { node, host, onLog, signal } = options;
  const nodeId = node.id;
  const probe = probePendingInteraction(host);

  if (!options.localPause) {
    // 无恢复器：仅产出等待信号即返回（UI 侧自行决定如何呈现断点）
    onLog?.(`[${nodeId}] 宿主审批${probe.available ? '可用(host_interaction)' : '不可用(local_paused)'}，挂起等待`);
    return { outputs: { waiting: true, mode: probe.available ? 'host_interaction' : 'local_paused' } };
  }

  onLog?.(
    probe.available
      ? `[${nodeId}] 宿主 pendingInteraction 可用（interaction=${probe.interactionId}），进入断点等待`
      : `[${nodeId}] 宿主审批不可用，进入本地 paused 断点`,
  );

  const timeoutMs = (node as { timeoutMs?: number }).timeoutMs;
  const onTimeout = (node as { onTimeout?: 'abort' | 'proceed' }).onTimeout ?? 'abort';

  const waitPromise = options.localPause({ nodeId, prompt: String((node as { prompt?: unknown }).prompt ?? '') });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    if (!timeoutMs || timeoutMs <= 0) return;
    timer = setTimeout(() => reject(new HumanTimeoutError(nodeId, timeoutMs)), timeoutMs);
  });

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(new Error(`节点 "${nodeId}" 等待审批期间运行已中止`)); return; }
    onAbort = () => reject(new Error(`节点 "${nodeId}" 等待审批期间运行已中止`));
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    const decision = await Promise.race([waitPromise, timeoutPromise, abortPromise]);
    if (decision === 'rejected') {
      throw new Error(`节点 "${nodeId}" 审批被驳回`);
    }
    onLog?.(`[${nodeId}] 审批通过，继续执行`);
    return { outputs: { waiting: false, decision } };
  } catch (error) {
    if (error instanceof HumanTimeoutError && onTimeout === 'proceed') {
      onLog?.(`[${nodeId}] 审批超时，按 onTimeout=proceed 继续`);
      return { outputs: { waiting: false, decision: 'proceed', timedOut: true } };
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

// ---------------- Mock 句柄（单测用） ----------------

export interface MockSessionsHandle extends SessionsHandle {
  /** 已创建的 mock 会话记录（断言用）。 */
  created: Array<{ workspaceId: string; preset: string; sessionId: string }>;
  /** 每个会话收到的完整 prompt 列表。 */
  prompts: Map<string, string[]>;
  /** 设置下一轮回复文本（FIFO）。 */
  queueReply(reply: string): void;
  /** 让下一次 prompt 投递抛错一次。 */
  failNextPrompt(message: string): void;
}

/** 构造 mock sessions 句柄：同步 resolve 的假会话 + 可编程回复队列。 */
export function createMockSessions(): MockSessionsHandle {
  let seq = 0;
  const replies: string[] = [];
  const failures: string[] = [];
  const handle: MockSessionsHandle = {
    created: [],
    prompts: new Map(),
    queueReply(reply: string): void {
      replies.push(reply);
    },
    failNextPrompt(message: string): void {
      failures.push(message);
    },
    async createSession(args: CreateSessionArgs): Promise<SessionLike> {
      const sessionId = `mock-session-${++seq}`;
      handle.created.push({ workspaceId: args.workspaceId, preset: args.preset, sessionId });
      const messages: ChatMessageLike[] = [];
      return {
        id: sessionId,
        chat: { get messages() { return messages; } },
        async prompt(input: unknown) {
          const text = typeof input === 'string' ? input : JSON.stringify(input);
          const list = handle.prompts.get(sessionId) ?? [];
          list.push(text);
          handle.prompts.set(sessionId, list);
          const failure = failures.shift();
          if (failure !== undefined) throw new Error(failure);
          const reply = replies.length > 0 ? replies.shift()! : '';
          messages.push({ role: 'user', content: text });
          messages.push({ role: 'assistant', content: reply });
        },
      };
    },
  };
  return handle;
}
