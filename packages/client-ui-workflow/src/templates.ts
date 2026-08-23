import type { WorkflowDSL } from "./types.js";

export const SAMPLE_WORKFLOWS: Record<string, WorkflowDSL> = {
  triage: {
    version: "dsh.workflow.v1",
    name: "智能工单分流与自动回复 (Customer Triage)",
    nodes: [
      {
        id: "start_1",
        type: "start",
        name: "接收工单输入",
        inputs: {
          ticket: { type: "string", default: "生产数据库出现连接超时，紧急求助！用户级别：VIP" },
          user_tier: { type: "string", default: "VIP" }
        }
      },
      {
        id: "intent_llm",
        type: "llm",
        name: "意图与严重度分析",
        prompt: "分析工单意图与等级：{{#start_1.ticket}}。输出 JSON: { category: 'incident', severity: 'high' }"
      },
      {
        id: "check_vip",
        type: "if_else",
        name: "是否 VIP 紧急工单",
        condition: "user_tier == 'VIP'"
      },
      {
        id: "vip_agent",
        type: "subagent",
        name: "VIP 专家诊断 Agent",
        prompt: "作为 SRE 专家排查此工单：{{#start_1.ticket}}"
      },
      {
        id: "standard_reply",
        type: "template",
        name: "标准工单回复模版",
        template: "您好，我们已收到您提交的工单，系统正在为您处理排队中。"
      },
      {
        id: "end_1",
        type: "end",
        name: "工单处理完毕",
        outputs: {
          final_response: "{{#vip_agent.result}}"
        }
      }
    ],
    edges: [
      { id: "e1", source: "start_1", target: "intent_llm" },
      { id: "e2", source: "intent_llm", target: "check_vip" },
      { id: "e3", source: "check_vip", target: "vip_agent", branch: "true" },
      { id: "e4", source: "check_vip", target: "standard_reply", branch: "false" },
      { id: "e5", source: "vip_agent", target: "end_1" },
      { id: "e6", source: "standard_reply", target: "end_1" }
    ]
  },

  summarizer: {
    version: "dsh.workflow.v1",
    name: "多智能体内容研究与提炼 (Research & Summarize)",
    nodes: [
      {
        id: "start_1",
        type: "start",
        name: "输入长篇文献/文章",
        inputs: {
          url: { type: "string", default: "https://example.com/ai-agents-report.pdf" },
          target_lang: { type: "string", default: "zh-CN" }
        }
      },
      {
        id: "preprocess_code",
        type: "code",
        name: "文本清洗与分块",
        code: "return { chunks: ['Section 1: DAG Architecture', 'Section 2: Agent Tooling'] };"
      },
      {
        id: "summarize_llm",
        type: "llm",
        name: "核心论点萃取 (LLM)",
        prompt: "萃取分块核心信息：{{#preprocess_code.chunks}}"
      },
      {
        id: "translate_llm",
        type: "llm",
        name: "目标语言精译",
        prompt: "将摘要翻译为 {{#start_1.target_lang}}：{{#summarize_llm.text}}"
      },
      {
        id: "end_1",
        type: "end",
        name: "输出终稿报告",
        outputs: {
          report: "{{#translate_llm.text}}"
        }
      }
    ],
    edges: [
      { id: "e1", source: "start_1", target: "preprocess_code" },
      { id: "e2", source: "preprocess_code", target: "summarize_llm" },
      { id: "e3", source: "summarize_llm", target: "translate_llm" },
      { id: "e4", source: "translate_llm", target: "end_1" }
    ]
  },

  code_review: {
    version: "dsh.workflow.v1",
    name: "代码审计与自动补丁生成 (Code Review & Auto-Fix)",
    nodes: [
      {
        id: "start_1",
        type: "start",
        name: "传入待审 Git 变更",
        inputs: {
          diff: { type: "string", default: "git diff HEAD~1" },
          branch: { type: "string", default: "master" }
        }
      },
      {
        id: "audit_code",
        type: "code",
        name: "AST 安全规则检测",
        code: "return { riskScore: 85, issues: ['Unchecked prompt injection in persona'] };"
      },
      {
        id: "fix_agent",
        type: "subagent",
        name: "代码重构与修复 Agent",
        prompt: "针对检测出的安全问题生成补丁代码：{{#audit_code.issues}}"
      },
      {
        id: "end_1",
        type: "end",
        name: "生成 PR 与报告",
        outputs: {
          patch: "{{#fix_agent.result}}"
        }
      }
    ],
    edges: [
      { id: "e1", source: "start_1", target: "audit_code" },
      { id: "e2", source: "audit_code", target: "fix_agent" },
      { id: "e3", source: "fix_agent", target: "end_1" }
    ]
  }
};
