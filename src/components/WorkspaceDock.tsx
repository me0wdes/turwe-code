import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AppState, Session } from "../types";
import {
  workspaceTools,
  emptyLayout,
  readPanelLayout,
  dockPanel,
  dockSide,
  clamp,
  panelName,
  type PanelLayout,
  type WorkspaceTool,
  type DockSide,
} from "../workspace-panels";
import {
  Plus,
  Check,
  MoreHorizontal,
  Folder,
  Code2,
  FileText,
  Globe,
  Settings2,
  Sparkles,
  ListQueued,
  Grid2,
  RotateCcw,
} from "../icons";
import { Menu } from "./Dropdown";
import { IconButton } from "./Primitives";
import { Workbench } from "./Workbench";
import { fluid } from "../motion";
import type { RevealEvent } from "../workspace-reveal";
import "../workspace-dock.css";

const storageKey = "turwe-workspace-panels-v1";
export function useWorkspacePanels(scope: string) {
  const [layouts, setLayouts] = useState<Record<string, PanelLayout>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return Object.fromEntries(
        Object.entries(saved).map(([key, value]) => [
          key,
          readPanelLayout(value),
        ]),
      );
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layouts));
    } catch {
      /* Layout remains usable when storage is unavailable. */
    }
  }, [layouts]);
  const updateLayout = useCallback(
    (update: (current: PanelLayout) => PanelLayout) => {
      setLayouts((current) => {
        const before = current[scope] || emptyLayout;
        const next = update(before);
        return before === next ? current : { ...current, [scope]: next };
      });
    },
    [scope],
  );
  return [layouts[scope] || emptyLayout, updateLayout] as const;
}

const toolIcons = {
  files: Folder,
  terminal: Code2,
  changes: FileText,
  plan: ListQueued,
  preview: Globe,
  git: Code2,
  agents: Sparkles,
  rules: Settings2,
  mcp: Code2,
};
export function WorkspaceToolIcon({
  tool,
  active = false,
}: {
  tool: WorkspaceTool;
  active?: boolean;
}) {
  const Icon = toolIcons[tool];
  return <Icon size={16} active={active} />;
}

export function AddPanelMenu({
  layout,
  onAdd,
  disabled,
}: {
  layout: PanelLayout;
  onAdd: (tool: WorkspaceTool) => void;
  disabled?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          label="Добавить панель"
          className="icon-button add-panel-button"
          disabled={disabled}
        >
          <Plus size={19} active={layout.panels.length > 0} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="dropdown-content panel-picker"
          align="end"
          sideOffset={7}
          collisionPadding={12}
        >
          <Menu.Label className="dropdown-label">Панели проекта</Menu.Label>
          {workspaceTools.map(([tool, name]) => {
            const opened = layout.panels.includes(tool);
            return (
              <Menu.Item
                key={tool}
                className="dropdown-item"
                disabled={opened || layout.panels.length === 2}
                onSelect={() => onAdd(tool)}
              >
                <WorkspaceToolIcon tool={tool} active={opened} />
                <span className="panel-menu-name">{name}</span>
                {opened && <Check size={14} />}
              </Menu.Item>
            );
          })}
          <Menu.Separator className="dropdown-separator" />
          <div className="dropdown-note">
            {layout.panels.length === 2
              ? "Открыты две панели. Закройте одну, чтобы добавить другую."
              : "До двух панелей одновременно. Перетаскивайте их за заголовок."}
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const snapLabels: Record<DockSide, string> = {
  left: "Слева",
  right: "Справа",
  top: "Сверху",
  bottom: "Снизу",
};
type Drag = { tool: WorkspaceTool; side: DockSide | null };
export function WorkspaceDock({
  state,
  session,
  layout,
  reveals,
  onLayout,
  hidden,
  suspended,
  onAdd,
  onError,
  onComment,
}: {
  state: AppState;
  session: Session;
  layout: PanelLayout;
  reveals: Partial<Record<WorkspaceTool, RevealEvent>>;
  onLayout: (update: (current: PanelLayout) => PanelLayout) => void;
  hidden: boolean;
  suspended: boolean;
  onAdd: (tool: WorkspaceTool) => void;
  onError: (message: string) => void;
  onComment: (text: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    tool: WorkspaceTool;
    active: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resizing, setResizing] = useState(false);
  const [bounds, setBounds] = useState({ max: 800, overlay: false });
  const [announcement, setAnnouncement] = useState("");
  const width = clamp(layout.width, 320, bounds.max);
  const axis = layout.axis === "columns" && width >= 660 ? "columns" : "rows";
  const two = layout.panels.length === 2;
  const allowColumns = bounds.max >= 660;

  useLayoutEffect(() => {
    const dock = root.current,
      body = dock?.parentElement;
    if (!dock || !body) return;
    const measure = () => {
      const sidebar = body.querySelector<HTMLElement>(".sidebar-rail");
      const sidebarWidth =
        sidebar && getComputedStyle(sidebar).position !== "absolute"
          ? sidebar.getBoundingClientRect().width
          : 0;
      const available = body.clientWidth - sidebarWidth;
      const overlay = available < 750;
      const max = Math.max(
        320,
        overlay ? Math.min(640, body.clientWidth - 48) : available - 400,
      );
      setBounds((previous) =>
        previous.max === max && previous.overlay === overlay
          ? previous
          : { max, overlay },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    const workspace = body.querySelector(".workspace");
    if (workspace) observer.observe(workspace);
    measure();
    return () => observer.disconnect();
  }, [suspended]);

  useEffect(() => {
    if (!drag && !resizing) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        gesture.current = null;
        setDrag(null);
        setResizing(false);
      }
    };
    const blur = () => {
      gesture.current = null;
      setDrag(null);
      setResizing(false);
    };
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", blur);
    };
  }, [!!drag, resizing]);

  function sideAt(event: ReactPointerEvent) {
    const rect = root.current!.getBoundingClientRect();
    return dockSide(
      (event.clientX - rect.x) / rect.width,
      (event.clientY - rect.y) / rect.height,
      allowColumns,
    );
  }
  function movePanel(tool: WorkspaceTool, side: DockSide) {
    onLayout((current) => dockPanel(current, tool, side));
    setAnnouncement(`${panelName(tool)}: ${snapLabels[side].toLowerCase()}`);
  }
  function startDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    tool: WorkspaceTool,
  ) {
    if (!two || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      tool,
      active: false,
    };
  }
  function dragMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    if (
      !start.active &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6
    )
      return;
    start.active = true;
    setDrag({ tool: start.tool, side: sideAt(event) });
  }
  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = gesture.current,
      side = sideAt(event);
    if (start?.active && side) movePanel(start.tool, side);
    gesture.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function endResize(event: ReactPointerEvent<HTMLElement>) {
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const panelMenu = (tool: WorkspaceTool) => (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton label={`Расположение: ${panelName(tool)}`}>
          <MoreHorizontal size={17} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="dropdown-content panel-layout-menu"
          align="end"
          sideOffset={7}
          collisionPadding={12}
        >
          <Menu.Label className="dropdown-label">
            Расположение панелей
          </Menu.Label>
          <Menu.Item
            className="dropdown-item"
            disabled={!two || !allowColumns}
            onSelect={() =>
              onLayout((current) => ({
                ...current,
                axis: "columns",
                width: Math.max(720, current.width),
              }))
            }
          >
            <Grid2 size={16} active={two && axis === "columns"} />
            Рядом
          </Menu.Item>
          <Menu.Item
            className="dropdown-item"
            disabled={!two}
            onSelect={() =>
              onLayout((current) => ({ ...current, axis: "rows" }))
            }
          >
            <Grid2
              size={16}
              active={two && axis === "rows"}
              className="layout-rows-icon"
            />
            Друг над другом
          </Menu.Item>
          <Menu.Item
            className="dropdown-item"
            disabled={!two}
            onSelect={() => {
              onLayout((current) => ({
                ...current,
                panels: [...current.panels].reverse(),
              }));
              setAnnouncement("Панели поменялись местами");
            }}
          >
            <RotateCcw size={16} />
            Поменять местами
          </Menu.Item>
          <Menu.Item
            className="dropdown-item"
            disabled={!two}
            onSelect={() => onLayout((current) => ({ ...current, split: 50 }))}
          >
            <Grid2 size={16} />
            Одинаковый размер
          </Menu.Item>
          {!two && (
            <div className="dropdown-note">
              Добавьте вторую панель через плюс над чатом.
            </div>
          )}
          {two && !allowColumns && (
            <div className="dropdown-note">
              Расширьте окно или скройте боковую колонку, чтобы расположить
              панели рядом.
            </div>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );

  return (
    <aside
      ref={root}
      className={`workspace-dock ${bounds.overlay ? "dock-overlay" : ""} ${drag ? "is-dragging" : ""} ${resizing ? "is-resizing" : ""}`}
      style={{ width, display: suspended ? "none" : undefined }}
      aria-label="Панели проекта"
      data-axis={axis}
      data-suspended={suspended || undefined}
    >
      <div
        className="dock-width-handle"
        role="separator"
        tabIndex={0}
        aria-label="Ширина панелей"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={bounds.max}
        aria-valuenow={Math.round(width)}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 320
                : event.key === "End"
                  ? bounds.max
                  : width + (event.key === "ArrowLeft" ? 24 : -24);
            onLayout((current) => ({
              ...current,
              width: clamp(next, 320, bounds.max),
            }));
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={(event) => {
          if (
            !resizing ||
            !event.currentTarget.hasPointerCapture(event.pointerId)
          )
            return;
          const right = root.current!.getBoundingClientRect().right;
          onLayout((current) => ({
            ...current,
            width: clamp(right - event.clientX, 320, bounds.max),
          }));
        }}
        onPointerUp={endResize}
        onLostPointerCapture={() => setResizing(false)}
      />
      <div
        className="dock-grid"
        style={
          two
            ? axis === "rows"
              ? {
                  gridTemplateRows: `minmax(0, ${layout.split}fr) 10px minmax(0, ${100 - layout.split}fr)`,
                }
              : {
                  gridTemplateColumns: `minmax(0, ${layout.split}fr) 10px minmax(0, ${100 - layout.split}fr)`,
                }
            : undefined
        }
      >
        {layout.panels.map((tool, index) => (
          <div
            key={tool}
            className="dock-slot"
            style={
              two
                ? axis === "rows"
                  ? { gridRow: index * 2 + 1, gridColumn: 1 }
                  : { gridColumn: index * 2 + 1, gridRow: 1 }
                : undefined
            }
            data-panel={tool}
          >
            <Workbench
              state={state}
              session={session}
              tab={tool}
              reveal={
                reveals[tool]?.sessionId === session.id
                  ? reveals[tool]
                  : undefined
              }
              onError={onError}
              onComment={onComment}
              hidden={hidden || suspended || !!drag || resizing}
              layoutKey={`${axis}:${layout.panels.join(":")}:${width}:${layout.split}`}
              title={
                <button
                  className="panel-drag-title"
                  type="button"
                  aria-label={`Переместить: ${panelName(tool)}`}
                  aria-disabled={!two}
                  tabIndex={two ? 0 : -1}
                  data-draggable={two}
                  title={
                    two
                      ? "Перетащите к краю панели, чтобы изменить расположение"
                      : panelName(tool)
                  }
                  onPointerDown={(event) => startDrag(event, tool)}
                  onPointerMove={dragMove}
                  onPointerUp={endDrag}
                  onLostPointerCapture={() => {
                    gesture.current = null;
                    setDrag(null);
                  }}
                >
                  <WorkspaceToolIcon tool={tool} />
                  <span>{panelName(tool)}</span>
                </button>
              }
              panelControls={
                <>
                  {bounds.overlay && index === 0 && !two && (
                    <AddPanelMenu layout={layout} onAdd={onAdd} />
                  )}
                  {panelMenu(tool)}
                </>
              }
              onClose={() => {
                onLayout((current) => ({
                  ...current,
                  panels: current.panels.filter((id) => id !== tool),
                }));
                setAnnouncement(`Закрыто: ${panelName(tool)}`);
                requestAnimationFrame(() =>
                  (
                    document.querySelector<HTMLButtonElement>(
                      ".workspace-dock .add-panel-button",
                    ) ||
                    document.querySelector<HTMLButtonElement>(
                      ".add-panel-button",
                    )
                  )?.focus(),
                );
              }}
            />
          </div>
        ))}
        {two && (
          <div
            className="dock-split-handle"
            style={
              axis === "rows"
                ? { gridRow: 2, gridColumn: 1 }
                : { gridColumn: 2, gridRow: 1 }
            }
            role="separator"
            tabIndex={0}
            aria-label="Размер двух панелей"
            aria-orientation={axis === "rows" ? "horizontal" : "vertical"}
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(layout.split)}
            onDoubleClick={() =>
              onLayout((current) => ({ ...current, split: 50 }))
            }
            onKeyDown={(event) => {
              const before = axis === "rows" ? "ArrowUp" : "ArrowLeft",
                after = axis === "rows" ? "ArrowDown" : "ArrowRight";
              if ([before, after, "Home", "End"].includes(event.key)) {
                event.preventDefault();
                onLayout((current) => ({
                  ...current,
                  split:
                    event.key === "Home"
                      ? 25
                      : event.key === "End"
                        ? 75
                        : clamp(
                            current.split + (event.key === before ? -5 : 5),
                            25,
                            75,
                          ),
                }));
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (
                !resizing ||
                !event.currentTarget.hasPointerCapture(event.pointerId)
              )
                return;
              const rect = root.current!.getBoundingClientRect();
              const part =
                axis === "rows"
                  ? (event.clientY - rect.y) / rect.height
                  : (event.clientX - rect.x) / rect.width;
              onLayout((current) => ({
                ...current,
                split: clamp(part * 100, 25, 75),
              }));
            }}
            onPointerUp={endResize}
            onLostPointerCapture={() => setResizing(false)}
          />
        )}
      </div>
      <AnimatePresence>
        {drag && (
          <motion.div
            className="dock-snap-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fluid.fast}
            aria-hidden="true"
          >
            {drag.side && (
              <div className={`dock-snap-preview snap-${drag.side}`} />
            )}
            {(allowColumns
              ? ["left", "right", "top", "bottom"]
              : ["top", "bottom"]
            ).map((side) => (
              <div
                key={side}
                className={`dock-snap-target target-${side} ${drag.side === side ? "active" : ""}`}
              >
                <Grid2
                  size={18}
                  className={
                    side === "top" || side === "bottom"
                      ? "layout-rows-icon"
                      : ""
                  }
                  active={drag.side === side}
                />
                {snapLabels[side as DockSide]}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </aside>
  );
}
