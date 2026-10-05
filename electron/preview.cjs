const {
  normalizeBrowserUrl,
  zoomFactor,
  browserError,
} = require("./browser-address.cjs");
function createPreview({ getWindow, attachments, emit }) {
  const {
    WebContentsView,
    BrowserWindow,
    dialog,
    shell,
    app,
  } = require("electron");
  const views = new Map();
  let shown;
  const safeUrl = normalizeBrowserUrl;
  function status(session) {
    const item = views.get(session.id),
      wc = item?.view.webContents;
    return {
      url: item?.url || "",
      title: item?.title || "",
      loading: item?.loading || false,
      hasPage: item?.hasPage || false,
      error: item?.error || "",
      canGoBack: wc?.navigationHistory.canGoBack() || false,
      canGoForward: wc?.navigationHistory.canGoForward() || false,
      zoom: wc?.getZoomFactor() || 1,
      find: item?.find || null,
    };
  }
  function get(session) {
    let item = views.get(session.id);
    if (item) return item;
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        partition: "turwe-preview-" + session.id,
      },
    });
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
    view.setBorderRadius(12);
    view.setBackgroundColor("#181818");
    // A detached view has no capture surface. Park it in a hidden host so agent-only
    // browsing works before the user opens the preview panel.
    const host = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 1280,
      height: 800,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    host.contentView.addChildView(view);
    item = {
      view,
      host,
      logs: [],
      url: "",
      title: "",
      loading: false,
      hasPage: false,
      error: "",
      find: null,
    };
    views.set(session.id, item);
    view.webContents.session.setPermissionRequestHandler((_w, _p, callback) =>
      callback(false),
    );
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, url) => {
      try {
        safeUrl(url);
      } catch {
        event.preventDefault();
      }
    });
    view.webContents.on("will-redirect", (event, url) => {
      try {
        safeUrl(url);
      } catch {
        event.preventDefault();
      }
    });
    view.webContents.on("console-message", (details) => {
      item.logs.push({ level: details.level, message: details.message });
      item.logs = item.logs.slice(-100);
    });
    view.webContents.on("did-finish-load", () => {
      const url = view.webContents.getURL();
      if (!/^https?:\/\//i.test(url) || item.error) return;
      item.url = url;
      item.title = view.webContents.getTitle();
      item.hasPage = true;
      emit();
    });
    view.webContents.on(
      "did-start-navigation",
      (_event, url, inPlace, isMainFrame) => {
        if (!isMainFrame || inPlace || !/^https?:\/\//i.test(url)) return;
        item.url = url;
        item.error = "";
        item.loading = true;
        item.find = null;
        item.findRequest = null;
        emit();
      },
    );
    view.webContents.on("did-stop-loading", () => {
      item.loading = false;
      const committedUrl = view.webContents.getURL();
      if (item.hasPage && !item.error && /^https?:\/\//i.test(committedUrl))
        item.url = committedUrl;
      emit();
    });
    view.webContents.on(
      "did-fail-load",
      (_event, code, _description, url, isMainFrame) => {
        if (!isMainFrame || code === -3) return;
        item.error = browserError(code);
        item.url = /^https?:\/\//i.test(url) ? url : item.url;
        item.loading = false;
        item.hasPage = false;
        emit();
      },
    );
    view.webContents.on("page-title-updated", (_event, title) => {
      item.title = title;
      emit();
    });
    view.webContents.on("found-in-page", (_event, result) => {
      if (result.requestId !== item.findRequest) return;
      item.find = { active: result.activeMatchOrdinal, total: result.matches };
      emit();
    });
    view.webContents.on("before-input-event", (event, input) => {
      if (
        shown !== session.id ||
        input.type !== "keyDown" ||
        !(input.control || input.meta)
      )
        return;
      const key = input.key.toLowerCase();
      if (["l", "f"].includes(key)) {
        event.preventDefault();
        getWindow()?.webContents.focus();
        getWindow()?.webContents.send("turwe:browser-shortcut", {
          sessionId: session.id,
          action: key === "l" ? "address" : "find",
        });
      } else if (key === "r") {
        event.preventDefault();
        view.webContents.reload();
      } else if (["+", "=", "-", "0"].includes(key)) {
        event.preventDefault();
        view.webContents.setZoomFactor(
          zoomFactor(
            key === "0"
              ? 1
              : view.webContents.getZoomFactor() + (key === "-" ? -0.1 : 0.1),
          ),
        );
        emit();
      }
    });
    view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        item.url = url;
        emit();
      }
    });
    return item;
  }
  async function navigate(session, url) {
    const target = safeUrl(url);
    const item = get(session);
    item.url = target;
    item.error = "";
    item.loading = true;
    emit();
    await item.view.webContents.loadURL(target);
    item.url = item.view.webContents.getURL();
    return { url: item.url };
  }
  async function capture(item) {
    if (!item.hasPage) throw new Error("Сначала откройте страницу");
    let timer;
    try {
      const image = await Promise.race([
        item.view.webContents.capturePage(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Не удалось получить снимок страницы. Повторите попытку.",
                ),
              ),
            10000,
          );
        }),
      ]);
      if (image.isEmpty()) throw new Error("Страница ещё не отрисована");
      return image;
    } finally {
      clearTimeout(timer);
    }
  }
  async function control(session, args) {
    const item = get(session),
      wc = item.view.webContents;
    switch (args.operation) {
      case "back":
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case "forward":
        if (wc.navigationHistory.canGoForward())
          wc.navigationHistory.goForward();
        break;
      case "reload":
        if (item.url && (item.error || !item.hasPage))
          await navigate(session, item.url);
        else if (item.url) wc.reload();
        break;
      case "stop":
        wc.stop();
        item.loading = false;
        break;
      case "zoom":
        wc.setZoomFactor(zoomFactor(args.factor));
        break;
      case "find": {
        if (typeof args.text !== "string" || args.text.length > 2000)
          throw new Error("Слишком длинный поисковый запрос");
        if (!args.text) {
          wc.stopFindInPage("clearSelection");
          item.find = null;
          item.findRequest = null;
          break;
        }
        item.findRequest = wc.findInPage(args.text, {
          forward: args.forward !== false,
          // Electron uses true to start a search and false to continue it.
          findNext: args.next !== true,
        });
        break;
      }
      case "external":
        await shell.openExternal(safeUrl(item.url));
        break;
      case "print":
        if (!item.hasPage) throw new Error("Сначала откройте страницу");
        await new Promise((resolve) =>
          wc.print({ silent: false, printBackground: true }, (success) =>
            resolve(success),
          ),
        );
        break;
      case "saveScreenshot": {
        const image = await capture(item);
        const name = (item.title || "Страница")
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
          .slice(0, 100);
        const result = await dialog.showSaveDialog(getWindow(), {
          title: "Сохранить снимок страницы",
          defaultPath: require("node:path").join(
            app.getPath("pictures"),
            name + ".png",
          ),
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (!result.canceled && result.filePath)
          await require("node:fs/promises").writeFile(
            result.filePath,
            image.toPNG(),
          );
        return { saved: !result.canceled };
      }
      case "logs":
        return item.logs;
      case "clearLogs":
        item.logs = [];
        return [];
      default:
        throw new Error("Неизвестное действие браузера");
    }
    emit();
    return status(session);
  }
  async function action(session, args) {
    const item = get(session),
      wc = item.view.webContents;
    if (args.operation === "navigate") return navigate(session, args.url);
    if (args.operation === "logs") return item.logs;
    if (args.operation === "screenshot") {
      const img = await capture(item);
      const attachment = await attachments.importBytes({
        name: "preview.png",
        data: img.toPNG().toString("base64"),
      });
      return { text: "Скриншот текущей страницы", attachments: [attachment] };
    }
    if (args.operation === "inspect")
      return wc.executeJavaScript(
        `({title:document.title,url:location.href,text:document.body.innerText.slice(0,18000),elements:[...document.querySelectorAll('button,a,input,textarea,select,[role="button"]')].slice(0,120).map(e=>({tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,150),id:e.id,name:e.getAttribute('name'),type:e.getAttribute('type')}))})`,
      );
    if (
      !["click", "fill"].includes(args.operation) ||
      typeof args.selector !== "string" ||
      args.selector.length > 1000
    )
      throw new Error("Укажите поддерживаемое действие и CSS-селектор");
    return wc.executeJavaScript(
      `(()=>{const e=document.querySelector(${JSON.stringify(args.selector)});if(!e)throw new Error('Элемент не найден');${args.operation === "click" ? "e.click();" : `const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(String(args.value || "").slice(0, 32000))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));`}return {ok:true};})()`,
    );
  }
  function park() {
    if (shown) {
      const item = views.get(shown);
      getWindow()?.contentView.removeChildView(item.view);
      item.host.contentView.addChildView(item.view);
      const bounds = item.view.getBounds();
      item.view.setBounds({ ...bounds, x: 0, y: 0 });
      shown = null;
    }
  }
  return {
    url: (session) => views.get(session.id)?.url || "",
    status,
    control,
    navigate,
    action,
    show(session, bounds) {
      const win = getWindow();
      if (!win) return null;
      if (shown && shown !== session.id) park();
      const item = get(session);
      if (!item.hasPage || item.error) return status(session);
      if (shown !== session.id) {
        item.host.contentView.removeChildView(item.view);
        win.contentView.addChildView(item.view);
      }
      shown = session.id;
      const b = {};
      for (const k of ["x", "y", "width", "height"]) {
        if (!Number.isFinite(bounds?.[k]))
          throw new Error("Некорректный размер preview");
        b[k] = Math.max(0, Math.round(bounds[k]));
      }
      item.view.setBounds(b);
      return status(session);
    },
    async hide(session, { snapshot = false } = {}) {
      if (session && shown !== session.id) return null;
      const item = views.get(shown);
      const frame =
        snapshot && item?.hasPage ? capture(item).catch(() => null) : null;
      park();
      const image = await frame;
      return image ? { snapshot: image.toDataURL() } : null;
    },
    close() {
      for (const item of views.values()) {
        item.view.webContents.close();
        item.host.destroy();
      }
      views.clear();
      shown = null;
    },
  };
}
module.exports = { createPreview };
