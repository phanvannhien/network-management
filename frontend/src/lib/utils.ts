import { createCn } from 'cn/config'

/**
 * Class merger aware of the design-token font sizes (DESIGN.md §4): without this, `text-form`,
 * `text-table`, … would be taken for text colours and silently drop e.g. `text-primary-foreground`.
 */
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['table', 'form', 'tech', 'label', 'title'] }] } },
})
