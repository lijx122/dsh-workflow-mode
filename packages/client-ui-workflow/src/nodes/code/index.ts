/** 代码执行四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { CodeCard } from "./card.js";
import { CodePanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: CodeCard,
  PanelComponent: CodePanel,
};

export default definition;
export { meta };
