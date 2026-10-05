import { useEffect, useRef, useState } from "react";
import { bridge, unwrap } from "../bridge";
import type { BrowserState, Session } from "../types";
import type { RevealEvent } from "../workspace-reveal";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Globe,
  Camera,
  Printer,
  Search,
  RefreshCw,
  X,
  MoreHorizontal,
  ExternalLink,
  Copy,
  Minus,
  Plus,
  RotateCcw,
  Code2,
  AlertCircle,
  Trash2,
} from "../icons";
import { IconButton } from "./Primitives";
import { Menu } from "./Dropdown";
import "../browser.css";

const empty: BrowserState = {
  url: "",
  title: "",
  loading: false,
  hasPage: false,
  error: "",
  canGoBack: false,
  canGoForward: false,
  zoom: 1,
  find: null,
};
function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
type Log = { level: string | number; message: string };
export function BrowserPanel({
  session,
  hidden,
  layoutKey,
  reveal,
  onError,
}: {
  session: Session;
  hidden: boolean;
  layoutKey: string;
  reveal?: RevealEvent;
  onError: (message: string) => void;
}) {
  const page = session.browser || empty;
  const root = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    addressInput = useRef<HTMLInputElement>(null),
    findInput = useRef<HTMLInputElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [address, setAddress] = useState(page.url),
    [editingAddress, setEditingAddress] = useState(false),
    [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false),
    [cover, setCover] = useState<string | null>(null),
    [findOpen, setFindOpen] = useState(false),
    [query, setQuery] = useState("");
  const [logsOpen, setLogsOpen] = useState(false),
    [logs, setLogs] = useState<Log[]>([]);
  const focusAfterMenu = useRef(false);
  const loading = page.loading || pending;
  const control = async (
    operation: string,
    args: Record<string, unknown> = {},
  ) => {
    try {
      return await unwrap(
        bridge.workspace(session.id, "previewControl", { operation, ...args }),
      );
    } catch (error) {
      onErrorRef.current((error as Error).message);
    }
  };
  const focusAddress = () => {
    addressInput.current?.focus();
    addressInput.current?.select();
  };
  const openFind = () => {
    if (!page.hasPage) return;
    focusAfterMenu.current = true;
    setFindOpen(true);
    requestAnimationFrame(() => findInput.current?.focus());
  };
  const closeFind = () => {
    setFindOpen(false);
    setQuery("");
    void control("find", { text: "" });
  };
  useEffect(() => {
    if (!editingAddress) setAddress(page.url);
  }, [page.url, editingAddress]);
  useEffect(() => {
    if (!findOpen || !page.hasPage || page.loading) return;
    const timer = setTimeout(() => void control("find", { text: query }), 160);
    return () => clearTimeout(timer);
  }, [query, findOpen, page.url, page.hasPage, page.loading]);
  useEffect(
    () =>
      bridge.onBrowserShortcut?.((event) => {
        if (event.sessionId !== session.id || hidden) return;
        if (event.action === "address") focusAddress();
        else openFind();
      }),
    [session.id, hidden, page.hasPage],
  );
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (hidden || !root.current?.contains(document.activeElement)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (["l", "f", "r", "+", "=", "-", "0"].includes(key)) {
        event.preventDefault();
        event.stopPropagation();
        if (key === "l") focusAddress();
        else if (key === "f") openFind();
        else if (key === "r") void control("reload");
        else
          void control("zoom", {
            factor: key === "0" ? 1 : page.zoom + (key === "-" ? -0.1 : 0.1),
          });
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [hidden, page.hasPage, page.zoom]);
  // Native views sit above the renderer. Freeze the page under menus/dialogs,
  // then restore the same live view without a blank flash or losing its position.
  useEffect(() => {
    let live = true,
      visible = false,
      boundsKey = "",
      revision = 0;
    const sync = () => {
      const overlay = !!document.querySelector(
        '.dropdown-content[data-state="open"], .dialog-overlay[data-state="open"]',
      );
      const r = surface.current?.getBoundingClientRect();
      const shouldShow =
        !hidden &&
        !overlay &&
        page.hasPage &&
        !page.error &&
        r &&
        r.width > 0 &&
        r.height > 0;
      if (!shouldShow) {
        if (!visible) return;
        visible = false;
        boundsKey = "";
        const request = ++revision;
        void unwrap(
          bridge.workspace(session.id, "previewHide", {
            snapshot: overlay && !hidden,
          }),
        )
          .then((value) => {
            if (live && request === revision) setCover(value?.snapshot || null);
          })
          .catch(() => {});
        return;
      }
      const key = [r.x, r.y, r.width, r.height].map(Math.round).join(":");
      if (visible && boundsKey === key) return;
      visible = true;
      boundsKey = key;
      const request = ++revision;
      void unwrap(
        bridge.workspace(session.id, "previewShow", {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }),
      )
        .then(() => {
          if (live && request === revision) setCover(null);
        })
        .catch((error) => {
          if (live) onErrorRef.current(error.message);
        });
    };
    const resize = new ResizeObserver(sync),
      overlays = new MutationObserver(sync);
    if (surface.current) resize.observe(surface.current);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    window.addEventListener("resize", sync);
    sync();
    return () => {
      live = false;
      revision++;
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener("resize", sync);
      void bridge.workspace(session.id, "previewHide");
    };
  }, [session.id, hidden, layoutKey, reveal?.id, page.hasPage, page.error]);
  async function navigate() {
    if (!address.trim()) return focusAddress();
    setPending(true);
    addressInput.current?.blur();
    try {
      await unwrap(
        bridge.workspace(session.id, "preview", {
          operation: "navigate",
          url: address,
        }),
      );
    } catch (error) {
      if (!(error as Error).message.includes("ERR_"))
        onErrorRef.current((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="browser-pane" ref={root}>
      <div className="browser-toolbar" aria-label="Навигация браузера">
        <div className="browser-navigation">
          <IconButton
            label="Назад"
            disabled={!page.canGoBack}
            onClick={() => void control("back")}
          >
            <ArrowLeft size={17} />
          </IconButton>
          <IconButton
            label="Вперёд"
            disabled={!page.canGoForward}
            onClick={() => void control("forward")}
          >
            <ArrowRight size={17} />
          </IconButton>
          <span className="browser-nav-divider" />
          <IconButton
            label={loading ? "Остановить загрузку" : "Обновить страницу"}
            disabled={!page.url && !loading}
            onClick={() => void control(loading ? "stop" : "reload")}
          >
            {loading ? <X size={16} /> : <RefreshCw size={16} />}
          </IconButton>
        </div>
        <form
          className={`browser-address ${editingAddress ? "is-editing" : ""} ${page.url ? "has-address" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            void navigate();
          }}
        >
          <Globe size={15} className="browser-address-icon" />
          <input
            ref={addressInput}
            aria-label="Адрес сайта"
            title={page.url || "Введите адрес сайта"}
            placeholder="Введите адрес сайта"
            spellCheck={false}
            autoComplete="off"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => {
              setEditingAddress(true);
              const input = event.currentTarget;
              requestAnimationFrame(() => input.select());
            }}
            onBlur={() => setEditingAddress(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setAddress(page.url);
                event.currentTarget.blur();
              }
            }}
          />
          {!editingAddress && page.url && (
            <span className="browser-address-label" aria-hidden="true">
              {host(page.url)}
            </span>
          )}
        </form>
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger asChild>
            <IconButton
              label="Меню браузера"
              className="icon-button browser-menu-trigger"
            >
              <MoreHorizontal size={20} active={menuOpen} />
            </IconButton>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="dropdown-content browser-menu"
              sideOffset={8}
              align="end"
              collisionPadding={10}
              onEscapeKeyDown={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => {
                if (focusAfterMenu.current) {
                  event.preventDefault();
                  focusAfterMenu.current = false;
                  requestAnimationFrame(() => findInput.current?.focus());
                }
              }}
            >
              <Menu.Item
                className="dropdown-item"
                disabled={!page.hasPage}
                onSelect={openFind}
              >
                <Search size={16} />
                <span>Поиск на странице</span>
              </Menu.Item>
              <div
                className="browser-zoom"
                role="group"
                aria-label="Масштаб страницы"
              >
                <span>Масштаб</span>
                <div>
                  <Menu.Item
                    asChild
                    disabled={page.zoom <= 0.5}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <IconButton
                      label="Уменьшить масштаб"
                      disabled={page.zoom <= 0.5}
                      onClick={() =>
                        void control("zoom", { factor: page.zoom - 0.1 })
                      }
                    >
                      <Minus size={14} />
                    </IconButton>
                  </Menu.Item>
                  <Menu.Item
                    asChild
                    onSelect={(event) => event.preventDefault()}
                  >
                    <button
                      className="browser-zoom-value"
                      title="Сбросить масштаб"
                      aria-label="Сбросить масштаб"
                      onClick={() => void control("zoom", { factor: 1 })}
                    >
                      {Math.round(page.zoom * 100)}%
                    </button>
                  </Menu.Item>
                  <Menu.Item
                    asChild
                    disabled={page.zoom >= 2}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <IconButton
                      label="Увеличить масштаб"
                      disabled={page.zoom >= 2}
                      onClick={() =>
                        void control("zoom", { factor: page.zoom + 0.1 })
                      }
                    >
                      <Plus size={14} />
                    </IconButton>
                  </Menu.Item>
                </div>
              </div>
              <Menu.Separator className="dropdown-separator" />
              <Menu.Item
                className="dropdown-item"
                disabled={!page.url}
                onSelect={() =>
                  void unwrap(bridge.copyText(page.url)).catch((e) =>
                    onError(e.message),
                  )
                }
              >
                <Copy size={16} />
                <span>Копировать ссылку</span>
              </Menu.Item>
              <Menu.Item
                className="dropdown-item"
                disabled={!page.hasPage}
                onSelect={() => void control("saveScreenshot")}
              >
                <Camera size={16} />
                <span>Сохранить скриншот</span>
              </Menu.Item>
              <Menu.Item
                className="dropdown-item"
                disabled={!page.hasPage}
                onSelect={() => void control("print")}
              >
                <Printer size={16} />
                <span>Печать</span>
              </Menu.Item>
              <Menu.Item
                className="dropdown-item"
                disabled={!page.url}
                onSelect={() => void control("external")}
              >
                <ExternalLink size={16} />
                <span>Открыть во внешнем браузере</span>
              </Menu.Item>
              <Menu.Separator className="dropdown-separator" />
              <Menu.CheckboxItem
                className="dropdown-item"
                checked={logsOpen}
                onCheckedChange={(open) => {
                  setLogsOpen(open);
                  if (open)
                    void control("logs").then((value) => setLogs(value || []));
                }}
              >
                <Code2 size={16} active={logsOpen} />
                <span>Консоль страницы</span>
              </Menu.CheckboxItem>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        {loading && (
          <div
            className="browser-progress"
            aria-label="Загрузка страницы"
            role="progressbar"
          />
        )}
      </div>
      {findOpen && (
        <form
          className="browser-find"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void control("find", { text: query, next: true });
          }}
        >
          <Search size={15} />
          <input
            ref={findInput}
            aria-label="Найти на странице"
            placeholder="Найти на странице"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeFind();
              } else if (event.key === "Enter" && event.shiftKey) {
                event.preventDefault();
                void control("find", {
                  text: query,
                  next: true,
                  forward: false,
                });
              }
            }}
          />
          <span className="browser-find-count" aria-live="polite">
            {query
              ? `${page.find?.active || 0} из ${page.find?.total || 0}`
              : ""}
          </span>
          <IconButton
            label="Предыдущее совпадение"
            disabled={!query}
            onClick={() =>
              void control("find", { text: query, next: true, forward: false })
            }
          >
            <ArrowUp size={14} />
          </IconButton>
          <IconButton
            label="Следующее совпадение"
            disabled={!query}
            onClick={() => void control("find", { text: query, next: true })}
          >
            <ArrowDown size={14} />
          </IconButton>
          <IconButton label="Закрыть поиск" onClick={closeFind}>
            <X size={14} />
          </IconButton>
        </form>
      )}
      <div
        className="browser-surface"
        ref={surface}
        aria-label={page.title || "Страница браузера"}
      >
        {cover && page.hasPage && !page.error && (
          <img className="browser-frozen" src={cover} alt="" />
        )}
        {(!page.hasPage || page.error) && (
          <div className={`browser-page-state ${page.error ? "is-error" : ""}`}>
            {page.error ? <AlertCircle size={32} /> : <Globe size={36} />}
            <h3>
              {page.error
                ? "Страница недоступна"
                : loading
                  ? "Открываем сайт"
                  : "Откройте сайт"}
            </h3>
            <p>
              {page.error ||
                (loading ? host(page.url) : "Введите адрес в строке сверху")}
            </p>
            {!loading &&
              (page.error ? (
                <button
                  className="secondary-button"
                  onClick={() => void control("reload")}
                >
                  <RotateCcw size={15} />
                  Попробовать снова
                </button>
              ) : (
                <button className="quiet-control" onClick={focusAddress}>
                  Ввести адрес
                  <ArrowRight size={15} />
                </button>
              ))}
          </div>
        )}
      </div>
      {logsOpen && (
        <section className="browser-console" aria-label="Консоль страницы">
          <header>
            <Code2 size={14} />
            <span>Консоль страницы</span>
            <IconButton
              label="Обновить консоль"
              onClick={() =>
                void control("logs").then((value) => setLogs(value || []))
              }
            >
              <RefreshCw size={14} />
            </IconButton>
            <IconButton
              label="Очистить консоль"
              onClick={() => void control("clearLogs").then(() => setLogs([]))}
            >
              <Trash2 size={14} />
            </IconButton>
            <IconButton
              label="Закрыть консоль"
              onClick={() => setLogsOpen(false)}
            >
              <X size={14} />
            </IconButton>
          </header>
          <div className="browser-console-output">
            {logs.length ? (
              logs.map((log, index) => (
                <div key={index} className={`browser-log level-${log.level}`}>
                  {log.message}
                </div>
              ))
            ) : (
              <p>Сообщений пока нет</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
