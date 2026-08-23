import type { NodeExecutor, NodeOutput } from "../engine.js";
import type { ExecutionContext } from "../engine.js";
import type { JsonValue } from "../variable-context.js";
import type { HttpRequestNode } from "@dsh-workflow/schema";

/**
 * http_request：HTTP 请求节点。
 * 支持 GET/POST/PUT/DELETE 等请求，支持 URL/Header/Body 变量插值，
 * 自动尝试 JSON 解析（解析失败退化为原始文本），支持 signal 中止与 timeoutMs 超时。
 */
export const httpRequestExecutor: NodeExecutor = {
  type: "http_request",
  async execute(
    node: HttpRequestNode,
    _inputs: Record<string, NodeOutput[string]>,
    ctx: ExecutionContext,
  ): Promise<NodeOutput> {
    const rawUrl = node.url ?? "";
    const url = ctx.varCtx.interpolate(rawUrl);
    if (!url) {
      throw new Error(`http_request "${ctx.nodeId}": url 不能为空`);
    }

    const method = (node.method ?? "GET").toUpperCase();

    // 组装 headers 并插值
    const headers: Record<string, string> = {};
    if (node.headers && typeof node.headers === "object") {
      for (const [k, v] of Object.entries(node.headers)) {
        headers[k] = typeof v === "string" ? ctx.varCtx.interpolate(v) : String(v);
      }
    }

    // 处理 body
    let body: BodyInit | undefined = undefined;
    if (node.body !== undefined && node.body !== null && method !== "GET" && method !== "HEAD") {
      if (typeof node.body === "string") {
        body = ctx.varCtx.interpolate(node.body);
      } else {
        const jsonStr = JSON.stringify(node.body);
        body = ctx.varCtx.interpolate(jsonStr);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    // 设置 abort signal 与超时控制
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    if (ctx.signal.aborted) {
      controller.abort();
    } else {
      ctx.signal.addEventListener("abort", onParentAbort, { once: true });
    }

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (node.timeoutMs && node.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        controller.abort(new Error(`http_request "${ctx.nodeId}": 请求超时 (${node.timeoutMs}ms)`));
      }, node.timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const status = response.status;
      const ok = response.ok;
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });

      const text = await response.text();
      let data: JsonValue;
      try {
        data = JSON.parse(text) as JsonValue;
      } catch {
        data = text;
      }

      return {
        status,
        ok,
        data,
        headers: respHeaders as Record<string, JsonValue>,
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      ctx.signal.removeEventListener("abort", onParentAbort);
    }
  },
};