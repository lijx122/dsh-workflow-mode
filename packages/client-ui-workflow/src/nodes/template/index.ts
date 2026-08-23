/** 文本模板四件套组装：default/types/card/panel → 完整 NodeDefinition。 */
import type { NodeDefinition } from "../../types.js";
import { meta } from "./default.js";
import { TemplateCard } from "./card.js";
import { TemplatePanel } from "./panel.js";

const definition: NodeDefinition = {
  ...meta,
  CardComponent: TemplateCard,
  PanelComponent: TemplatePanel,
};

export default definition;
export { meta };
