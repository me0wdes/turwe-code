const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) =>
  ipcRenderer.invoke("turwe:invoke", method, ...args);
contextBridge.exposeInMainWorld(
  "turwe",
  Object.freeze({
    bootstrap: () => invoke("bootstrap"),
    checkUpdates: () => invoke("checkUpdates"),
    downloadUpdate: () => invoke("downloadUpdate"),
    workspace: (id, operation, args) =>
      invoke("workspace", id, operation, args),
    mcpForm: (id, action, content) => invoke("mcpForm", id, action, content),
    chooseProject: () => invoke("chooseProject"),
    openProjectFolder: (id) => invoke("openProjectFolder", id),
    createSession: (projectId) => invoke("createSession", projectId),
    updateSession: (id, patch) => invoke("updateSession", id, patch),
    deleteSession: (id) => invoke("deleteSession", id),
    send: (id, content, files) => invoke("send", id, content, files),
    updateQueuedInput: (id, messageId, content) =>
      invoke("updateQueuedInput", id, messageId, content),
    removeQueuedInput: (id, messageId) =>
      invoke("removeQueuedInput", id, messageId),
    steerQueuedInput: (id, messageId) =>
      invoke("steerQueuedInput", id, messageId),
    resumeQueue: (id) => invoke("resumeQueue", id),
    chooseAttachments: (kind) => invoke("chooseAttachments", kind),
    pasteAttachment: () => invoke("pasteAttachment"),
    importAttachment: (input) => invoke("importAttachment", input),
    attachmentPreview: (id) => invoke("attachmentPreview", id),
    draftAttachments: (id, files) => invoke("draftAttachments", id, files),
    approveTool: (id, callId, allowed, agentId, remember) =>
      invoke("approveTool", id, callId, allowed, agentId, remember),
    answerQuestion: (id, callId, response, agentId) =>
      invoke("answerQuestion", id, callId, response, agentId),
    branch: (id, messageId, content) =>
      invoke("branch", id, messageId, content),
    exportSession: (id) => invoke("exportSession", id),
    inspectGithub: (url) => invoke("inspectGithub", url),
    installGithub: (input) => invoke("installGithub", input),
    saveConnector: (input) => invoke("saveConnector", input),
    connectConnector: (id) => invoke("connectConnector", id),
    reopenConnectorAuthorization: (id) => invoke("reopenConnectorAuthorization", id),
    disconnectConnector: (id) => invoke("disconnectConnector", id),
    removeConnector: (id) => invoke("removeConnector", id),
    retry: (id) => invoke("retry", id),
    stop: (id) => invoke("stop", id),
    stopAgent: (id, agentId) => invoke("stopAgent", id, agentId),
    listFiles: (id, relative) => invoke("listFiles", id, relative),
    readFile: (id, relative) => invoke("readFile", id, relative),
    saveSettings: (settings) => invoke("saveSettings", settings),
    getModels: () => invoke("getModels"),
    addModel: (baseUrl, model) => invoke("addModel", baseUrl, model),
    removeModel: (baseUrl, id) => invoke("removeModel", baseUrl, id),
    setDefaultModel: (baseUrl, id) => invoke("setDefaultModel", baseUrl, id),
    saveSkill: (input) => invoke("saveSkill", input),
    deleteSkill: (id) => invoke("deleteSkill", id),
    assignSkill: (projectId, skillId, enabled) =>
      invoke("assignSkill", projectId, skillId, enabled),
    importSkill: (projectId) => invoke("importSkill", projectId),
    discoverSkills: (projectId) => invoke("discoverSkills", projectId),
    windowAction: (action) => invoke("windowAction", action),
    copyText: (text) => invoke("copyText", text),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("turwe:state", listener);
      return () => ipcRenderer.removeListener("turwe:state", listener);
    },
    onBrowserShortcut: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("turwe:browser-shortcut", listener);
      return () => ipcRenderer.removeListener("turwe:browser-shortcut", listener);
    },
  }),
);
