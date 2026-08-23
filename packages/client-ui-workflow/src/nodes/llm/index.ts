/** LLM 推理四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { LlmCard } from "./card.js";
import { LlmPanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: LlmCard,
  PanelComponent: LlmPanel,
};

export default definition;
export { meta };
