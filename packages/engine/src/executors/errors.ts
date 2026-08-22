/**
 * 执行器尚未实现的错误。
 * T5 用于 human/llm/subagent/plugin_tool stub 执行器（T6 全部换为真实实现，
 * 保留此类供 P1 桩复用）。
 */
export class NotImplementedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NotImplementedError";
  }
}

/**
 * host 服务未绑定错误（T6 注入模式）：
 * engine 包不直接 import DSH 运行时，服务经 Engine 构造函数 options.host 注入；
 * 执行器取用时缺失即以本错误失败，消息携带绑定指引。
 */
export function hostNotBound(service: string): Error {
  return new Error(
    `host service "${service}" not bound; bind via Engine constructor options.host`,
  );
}
