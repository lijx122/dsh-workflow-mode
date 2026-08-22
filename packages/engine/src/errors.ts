/**
 * 变量总线错误。
 * 契约见 IMPLEMENTATION_PLAN.md「variable-context → engine」：
 * 直接引用未定义节点 / 节点未输出 / 循环引用时抛出，携带定位信息 path。
 */
export class WorkflowVarError extends Error {
  /** 失败引用的定位信息：未定义节点 → "{{#nodeId.prop}}"；循环引用 → 引用链 */
  readonly path: string;

  constructor(path: string, message?: string) {
    super(message ?? `变量引用解析失败: ${path}`);
    this.name = "WorkflowVarError";
    this.path = path;
    // target ES2022 下 Error 子类原型链正确，无需额外修复
  }
}
