/**
 * 执行器尚未实现的错误。
 * T5 用于 human/llm/subagent/plugin_tool stub 执行器。
 */
export class NotImplementedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NotImplementedError";
  }
}
