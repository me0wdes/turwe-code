export const workspaceTools = [
  ["files", "Файлы и редактор"],
  ["terminal", "Терминал"],
  ["changes", "Изменения"],
  ["plan", "План и память"],
  ["preview", "Браузер"],
  ["git", "Git и проверки"],
  ["agents", "Профили агентов"],
  ["rules", "Доступ и LSP"],
  ["mcp", "Ресурсы MCP"],
] as const;

export type WorkspaceTool = (typeof workspaceTools)[number][0];
export type PanelAxis = "rows" | "columns";
export type DockSide = "left" | "right" | "top" | "bottom";
export type PanelLayout = {
  panels: WorkspaceTool[];
  axis: PanelAxis;
  width: number;
  split: number;
};
export const emptyLayout: PanelLayout = {
  panels: [],
  axis: "rows",
  width: 560,
  split: 50,
};
export const panelName = (tool: WorkspaceTool) =>
  workspaceTools.find(([id]) => id === tool)![1];
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function readPanelLayout(value: unknown): PanelLayout {
  const item = value as Partial<PanelLayout> | null;
  return {
    panels: Array.isArray(item?.panels)
      ? [
          ...new Set(
            item.panels.filter((id) =>
              workspaceTools.some(([tool]) => tool === id),
            ),
          ),
        ].slice(0, 2)
      : [],
    axis: item?.axis === "columns" ? "columns" : "rows",
    width:
      typeof item?.width === "number" && Number.isFinite(item.width)
        ? clamp(item.width, 320, 1600)
        : 560,
    split:
      typeof item?.split === "number" && Number.isFinite(item.split)
        ? clamp(item.split, 25, 75)
        : 50,
  };
}

export function addPanel(
  layout: PanelLayout,
  tool: WorkspaceTool,
): PanelLayout {
  if (layout.panels.length === 2 || layout.panels.includes(tool)) return layout;
  return { ...layout, panels: [...layout.panels, tool] };
}

export function revealPanel(
  layout: PanelLayout,
  tool: WorkspaceTool,
): PanelLayout {
  if (layout.panels.includes(tool)) return layout;
  if (layout.panels.length < 2) return addPanel(layout, tool);
  // Keep the file editor mounted, including any unsaved draft.
  const replace = layout.panels[1] === "files" ? 0 : 1;
  return {
    ...layout,
    panels: layout.panels.map((panel, index) =>
      index === replace ? tool : panel,
    ),
  };
}

export function dockPanel(
  layout: PanelLayout,
  tool: WorkspaceTool,
  side: DockSide,
): PanelLayout {
  if (layout.panels.length !== 2 || !layout.panels.includes(tool))
    return layout;
  const other = layout.panels.find((id) => id !== tool)!;
  const axis = side === "left" || side === "right" ? "columns" : "rows";
  return {
    ...layout,
    panels: side === "left" || side === "top" ? [tool, other] : [other, tool],
    axis,
    width: axis === "columns" ? Math.max(720, layout.width) : layout.width,
    split: 50,
  };
}

// Relative pointer coordinates make edge snapping independent of the dock's size.
export function dockSide(
  x: number,
  y: number,
  allowColumns = true,
): DockSide | null {
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (allowColumns && Math.min(x, 1 - x) < Math.min(y, 1 - y))
    return x < 0.5 ? "left" : "right";
  return y < 0.5 ? "top" : "bottom";
}
