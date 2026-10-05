function normalizeBrowserUrl(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 8000 ||
    /[\s\u0000-\u001f]/.test(value.trim())
  )
    throw new Error("Введите адрес сайта, например example.com");
  let input = value.trim();
  const local = /^(localhost|127(?:\.\d+){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    input,
  );
  if (!/^[a-z][a-z\d+.-]*:/i.test(input) || local)
    input = (local ? "http://" : "https://") + input;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Проверьте адрес сайта");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  )
    throw new Error(
      "Браузер открывает только HTTP(S)-адреса без логина и пароля",
    );
  return url.href;
}
function zoomFactor(value) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Некорректный масштаб");
  return Math.round(Math.max(0.5, Math.min(2, value)) * 100) / 100;
}
function browserError(code) {
  if (code === -105) return "Сайт не найден. Проверьте адрес.";
  if (code === -102)
    return "Не удалось подключиться к сайту. Проверьте адрес и запущен ли сервер.";
  if (code === -106) return "Нет подключения к интернету.";
  if (code <= -200 && code > -300)
    return "Не удалось подтвердить защищённое соединение с сайтом.";
  return "Не удалось загрузить страницу. Проверьте соединение и попробуйте ещё раз.";
}
module.exports = { normalizeBrowserUrl, zoomFactor, browserError };
