import type { ThemeId } from "../electron/themes.mjs";

export type MessageStatus =
  | "queued"
  | "connecting"
  | "streaming"
  | "working"
  | "approval"
  | "question"
  | "complete"
  | "stopped"
  | "error";
export interface Attachment {
  path: string;
  content?: string;
  size: number;
  id?: string;
  name?: string;
  mime?: string;
  kind?: "image" | "video" | "document";
  note?: string;
  preview?: string;
}
export interface ToolCall {
  id: string;
  name: string;
  label?: string;
  connectorName?: string;
  toolName?: string;
  arguments: string;
  status:
    | "queued"
    | "approval"
    | "question"
    | "running"
    | "complete"
    | "error"
    | "denied"
    | "stopped";
  result?: string;
  attachments?: Attachment[];
  approvalReason?: string;
  questions?: AgentQuestion[];
  response?: QuestionResponse;
  agentIds?: string[];
  setup?: ChatSetup;
  reveal?: WorkspaceReveal;
}
export interface WorkspaceReveal {
  panel: "preview" | "files" | "changes" | "terminal";
  url?: string;
  path?: string;
  processId?: string;
}
export interface ChatSetup {
  kind: "connector" | "skill" | "install";
  title: string;
  description?: string;
  status: string;
  connectorId?: string;
  skillId?: string;
  scope?: string;
  source?: string;
  endpoint?: string;
  auth?: string;
  helpUrl?: string;
  toolCount?: number;
  error?: string;
  alternative?: "figma-desktop";
}
export type PermissionMode = "ask" | "auto" | "bypass" | "plan";
export type Effort = "auto" | "low" | "medium" | "high";
export interface AgentQuestion {
  id: string;
  question: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
}
export interface QuestionAnswer {
  id: string;
  selected: string[];
  text: string;
}
export interface QuestionResponse {
  answers: QuestionAnswer[];
  skipped?: boolean;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: MessageStatus;
  model?: string;
  effort?: Effort;
  error?: string;
  createdAt: string;
  steering?: boolean;
  steeringOrder?: number;
  supersededBy?: string;
  attachments?: Attachment[];
  toolRounds?: { content: string; calls: ToolCall[] }[];
  finalContent?: string;
  agents?: AgentRun[];
  skills?: {
    id: string;
    name: string;
    instructions: string;
    references: { path: string; content: string }[];
  }[];
}
export interface Session {
  previewUrl?: string;
  browser?: BrowserState;
  effort?: Effort;
  worktreePath?: string;
  contextFill?: number;
  plan?: { text: string; status: string };
  tasks?: { id: string; title: string; status: string; note?: string }[];
  queuedInputs?: Message[];
  compaction?: { summary: string; createdAt: string; throughId: string };
  parentSessionId?: string;
  autoFixCi?: boolean;
  id: string;
  projectId: string | null;
  title: string;
  draft: string;
  draftAttachments?: Attachment[];
  model: string;
  permissionMode: PermissionMode;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}
export interface AgentRun extends Session {
  rootSessionId: string;
  parentAgentId: string | null;
  depth: number;
  task: string;
  finishedAt?: string;
}
export interface Project {
  memory?: string;
  permissionRules?: {
    tool: string;
    pattern: string;
    action: "allow" | "ask" | "deny";
  }[];
  id: string;
  name: string;
  path: string;
  createdAt: string;
  skillIds?: string[];
}
export interface ModelOption {
  id: string;
  name: string;
}
export interface ModelLibrary {
  models: ModelOption[];
  defaultModel: string;
}
export interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  body: string;
  argumentHint: string;
  manualOnly: boolean;
  userInvocable: boolean;
  unsupported: string[];
  projectId: string | null;
  updatedAt: string;
  references: { path: string; content: string }[];
}
export interface Settings {
  effort?: Effort;
  lspServers?: {
    id: string;
    command: string;
    args: string[];
    extensions: string[];
    languageId?: string;
  }[];
  theme: ThemeId;
  baseUrl: string;
  model: string;
  sounds: boolean;
  volume: number;
  motion: boolean;
  subagents?: boolean;
}
export interface McpField {
  type: string;
  title?: string;
  description?: string;
  enum?: string[];
  enumNames?: string[];
  oneOf?: { const: string; title: string }[];
  items?: { enum?: string[]; anyOf?: { const: string; title: string }[] };
  default?: string | number | boolean | string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
}
export interface McpFormData {
  id: string;
  sessionId: string;
  connectorName: string;
  message: string;
  schema: { properties: Record<string, McpField>; required?: string[] };
}
export interface AppState {
  update?: AppUpdate;
  agentProfiles?: {
    id: string;
    name: string;
    prompt: string;
    allowedTools: string[];
    memory: string;
  }[];
  processes?: {
    id: string;
    sessionId: string;
    rootSessionId: string;
    command: string;
    output: string;
    status: string;
    exitCode?: number;
    terminal?: boolean;
  }[];
  mcpForms?: McpFormData[];
  models: ModelOption[];
  modelLibraries: Record<string, ModelLibrary>;
  version: number;
  projects: Project[];
  skills: Skill[];
  sessions: Session[];
  settings: Settings;
  hasKey: boolean;
  warning: string;
  platform: string;
  connectors: Connector[];
}
export interface Connector {
  id: string;
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  envKeys: string[];
  auth: "none" | "oauth" | "bearer";
  enabled: boolean;
  status: "disconnected" | "connecting" | "authorizing" | "connected" | "error";
  toolCount: number;
  error?: string;
  hasSecret: boolean;
}
export type ConnectorInput = Partial<
  Pick<Connector, "id" | "url" | "command" | "args" | "cwd" | "auth">
> & {
  name: string;
  type: "http" | "stdio";
  bearerToken?: string;
  env?: Record<string, string>;
};
export interface GithubInspection {
  url: string;
  repo: string;
  ref: string;
  revision: string;
  candidates: { path: string; name: string }[];
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export type SettingsInput = Partial<Omit<Settings, "model">> & {
  key?: string;
  clearKey?: boolean;
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface AppUpdate {
  status: "idle" | "checking" | "current" | "available" | "unpublished" | "unavailable" | "error";
  currentVersion: string;
  version?: string;
  downloadUrl?: string;
  releaseUrl: string;
  checkedAt?: number;
  error?: string;
}
export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  hasPage: boolean;
  error: string;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  find: { active: number; total: number } | null;
}
export interface DesktopBridge {
  onBrowserShortcut?(callback: (value: { sessionId: string; action: "address" | "find" }) => void): () => void;
  workspace(
    id: string,
    operation: string,
    args?: Record<string, unknown>,
  ): Promise<Result<any>>;
  mcpForm(
    id: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): Promise<Result<null>>;
  bootstrap(): Promise<Result<AppState>>;
  checkUpdates(): Promise<Result<AppUpdate>>;
  downloadUpdate(): Promise<Result<null>>;
  chooseProject(): Promise<Result<Project | null>>;
  openProjectFolder(id: string): Promise<Result<null>>;
  createSession(projectId?: string | null): Promise<Result<string>>;
  updateSession(
    id: string,
    patch: Partial<
      Pick<
        Session,
        | "title"
        | "draft"
        | "model"
        | "archived"
        | "projectId"
        | "permissionMode"
        | "effort"
      >
    >,
  ): Promise<Result<null>>;
  deleteSession(id: string): Promise<Result<AppState>>;
  send(
    id: string,
    content: string,
    files: Attachment[],
  ): Promise<Result<string>>;
  updateQueuedInput(
    id: string,
    messageId: string,
    content: string,
  ): Promise<Result<null>>;
  removeQueuedInput(id: string, messageId: string): Promise<Result<null>>;
  steerQueuedInput(id: string, messageId: string): Promise<Result<null>>;
  resumeQueue(id: string): Promise<Result<string>>;
  chooseAttachments(kind: "media" | "files"): Promise<Result<Attachment[]>>;
  pasteAttachment(): Promise<Result<Attachment[]>>;
  importAttachment(input: {
    name: string;
    data: string;
  }): Promise<Result<Attachment>>;
  attachmentPreview(id: string): Promise<Result<string | null>>;
  draftAttachments(id: string, files: Attachment[]): Promise<Result<null>>;
  approveTool(
    id: string,
    callId: string,
    allowed: boolean,
    agentId?: string,
  ): Promise<Result<null>>;
  answerQuestion(
    id: string,
    callId: string,
    response: QuestionResponse,
    agentId?: string,
  ): Promise<Result<null>>;
  branch(
    id: string,
    messageId: string,
    content?: string,
  ): Promise<Result<string>>;
  exportSession(id: string): Promise<Result<boolean>>;
  retry(id: string): Promise<Result<string>>;
  stop(id: string): Promise<Result<null>>;
  stopAgent(id: string, agentId: string): Promise<Result<null>>;
  listFiles(id: string, relative: string): Promise<Result<FileEntry[]>>;
  readFile(id: string, relative: string): Promise<Result<Attachment>>;
  saveSettings(input: SettingsInput): Promise<Result<AppState>>;
  getModels(): Promise<Result<{ baseUrl: string; models: ModelOption[] }>>;
  addModel(
    baseUrl: string,
    model: { id: string; name?: string },
  ): Promise<Result<AppState>>;
  removeModel(baseUrl: string, id: string): Promise<Result<AppState>>;
  setDefaultModel(baseUrl: string, id: string): Promise<Result<AppState>>;
  saveSkill(input: {
    id?: string;
    source: string;
    projectId?: string | null;
  }): Promise<Result<string>>;
  deleteSkill(id: string): Promise<Result<null>>;
  assignSkill(
    projectId: string,
    skillId: string,
    enabled: boolean,
  ): Promise<Result<null>>;
  importSkill(projectId: string | null): Promise<Result<string | null>>;
  discoverSkills(
    projectId: string,
  ): Promise<Result<{ imported: string[]; errors: string[] }>>;
  inspectGithub(url: string): Promise<Result<GithubInspection>>;
  installGithub(input: {
    url: string;
    skillPath?: string;
    projectId: string | null;
  }): Promise<
    Result<{
      skillId: string;
      name: string;
      unsupported: string[];
      sourceUrl: string;
    }>
  >;
  saveConnector(input: ConnectorInput): Promise<Result<Connector>>;
  connectConnector(id: string): Promise<Result<Connector>>;
  reopenConnectorAuthorization(id: string): Promise<Result<null>>;
  disconnectConnector(id: string): Promise<Result<Connector>>;
  removeConnector(id: string): Promise<Result<null>>;
  copyText(text: string): Promise<Result<null>>;
  windowAction(
    action: "minimize" | "maximize" | "close",
  ): Promise<Result<null>>;
  onState(callback: (state: AppState) => void): () => void;
}
declare global {
  interface Window {
    turwe?: DesktopBridge;
  }
}
