const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const { OAuthError, OAUTH_ERRORS } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const { McpSafeError } = require('./mcp-oauth.cjs');

function figmaEndpoint(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.pathname.replace(/\/$/, '') !== '/mcp') return undefined;
    if (url.origin === 'https://mcp.figma.com') return 'remote';
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port === '3845') return 'desktop';
  } catch { /* Invalid configuration is handled at save time. */ }
}

// Only structured codes reach the UI/model. SDK errors can contain entire HTTP
// bodies, credentials, authorization codes or untrusted instructions.
function connectionFailure(error, config) {
  const phase = ['registration', 'token'].includes(error?.mcpPhase) ? error.mcpPhase
    : error instanceof OAuthError ? 'oauth' : 'connection';
  const status = error?.httpStatus ?? error?.code;
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const reportedCode = error && Object.hasOwn(error, 'mcpOAuthCode') ? error.mcpOAuthCode : error instanceof OAuthError ? error.errorCode : undefined;
  const oauthError = typeof reportedCode === 'string' && Object.hasOwn(OAUTH_ERRORS, reportedCode) ? reportedCode : undefined;
  const failure = (code, message) => ({
    message,
    diagnostic: { code, phase, ...(httpStatus ? { httpStatus } : {}), ...(oauthError ? { oauthError } : {}) },
  });
  if (error instanceof McpSafeError) return failure(error.code, error.message);
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return failure('MCP_CANCELLED', 'MCP operation cancelled.');

  const codes = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 3) return;
    if (typeof value.code === 'string') codes.add(value.code);
    visit(value.cause, depth + 1);
    if (value instanceof AggregateError) value.errors.forEach(item => visit(item, depth + 1));
  };
  visit(error);
  if (codes.has('ENOENT')) return failure('MCP_COMMAND_MISSING', 'Unable to start the MCP command. Check that it is installed and the command path is correct.');
  if (codes.has('ECONNREFUSED')) return failure('MCP_CONNECTION_REFUSED', figmaEndpoint(config?.url) === 'desktop'
    ? 'Локальный MCP-сервер Figma не принимает соединение. Откройте файл в Figma Desktop, включите Dev Mode и Enable desktop MCP server, затем повторите подключение.'
    : 'MCP-сервер не принимает соединение. Проверьте адрес и порт и убедитесь, что сервер запущен.');
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN')) return failure('MCP_DNS', 'Не удалось найти адрес MCP-сервера (DNS). Проверьте адрес, соединение и настройки сети.');
  if (codes.has('EACCES') || codes.has('EPERM')) return failure('MCP_NETWORK_ACCESS', 'Система заблокировала соединение с MCP-сервером. Проверьте сетевые ограничения приложения.');
  if (error?.code === -32001 || error?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].some(code => codes.has(code)))
    return failure('MCP_TIMEOUT', 'MCP server timed out. Check that it is running, then reconnect.');
  if (['ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].some(code => codes.has(code))) return failure('MCP_NETWORK', 'Соединение с MCP-сервером прервано или сеть недоступна. Проверьте соединение и повторите попытку.');
  if ([...codes].some(code => /CERT|TLS|SSL/.test(code))) return failure('MCP_TLS', 'Не удалось проверить защищённое соединение с MCP-сервером. Проверьте сертификат сервера и настройки сети.');

  const detail = [httpStatus && `HTTP ${httpStatus}`, oauthError].filter(Boolean).join(', ');
  const suffix = detail ? ` (${detail})` : '';
  if (httpStatus === 429) return failure('MCP_RATE_LIMIT', `Сервер ограничил частоту запросов${suffix}. Подождите перед повторной попыткой.`);
  if (httpStatus >= 500 || oauthError === 'temporarily_unavailable' || (oauthError === 'server_error' && !httpStatus)) return failure('MCP_SERVER_ERROR', `Сбой на стороне MCP/OAuth-сервера${suffix}. Повторите подключение позже.`);
  if (phase === 'registration') {
    if (figmaEndpoint(config?.url) === 'remote' && httpStatus === 403) return failure('MCP_REGISTRATION_REJECTED',
      'Figma отклонила регистрацию Turwe Code (OAuth, HTTP 403). Вход в аккаунт ещё не начался. Удалённый MCP доступен клиентам из каталога Figma; заявку для нового приложения подаёт его разработчик. Повторный вход эту ошибку не устранит.');
    return failure('MCP_REGISTRATION_REJECTED', `Сервер отклонил регистрацию OAuth-клиента${suffix}. Вход в аккаунт ещё не начался. Проверьте требования сервиса к MCP-клиентам.`);
  }
  if (phase === 'token') return failure('MCP_TOKEN_EXCHANGE', `Сервер не выдал токен доступа OAuth${suffix}. Повторите вход; если ошибка сохраняется, проверьте настройки OAuth у сервиса.`);
  if (error instanceof UnauthorizedError || httpStatus === 401 || httpStatus === 403 || error instanceof OAuthError)
    return failure('MCP_AUTH', `Не удалось подтвердить доступ к MCP-серверу${suffix}. Проверьте способ входа и разрешения аккаунта.`);
  if (httpStatus) return failure('MCP_HTTP', `MCP-сервер вернул HTTP ${httpStatus}. Проверьте адрес MCP и доступность сервера.`);
  return failure('MCP_CONNECTION_FAILED', config?.type === 'stdio'
    ? 'MCP connection or tool failed. Check the command, arguments, and required environment variables.'
    : 'Сервер не завершил подключение MCP. Точная причина не установлена; проверьте адрес, доступность сервера и способ входа.');
}

module.exports = { connectionFailure, figmaEndpoint };
