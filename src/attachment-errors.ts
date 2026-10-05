export function attachmentError(error: unknown, name?: string) {
  const raw = error instanceof Error ? error.message : String(error);
  let message = raw;
  if (/Invalid (PNG|JPEG|WebP|GIF|or damaged) image|Could not decode this attachment/i.test(raw))
    message = "Не удалось прочитать изображение. Файл повреждён или его формат не поддерживается.";
  else if (/dimensions|megapixels/i.test(raw)) message = "Изображение слишком большое: максимум 40 мегапикселей.";
  else if (/Unsupported file type/i.test(raw)) message = "Этот формат не поддерживается. Добавьте изображение, видео, PDF, DOCX или текстовый файл.";
  else if (/Attachment is empty/i.test(raw)) message = "Файл пустой. Выберите другой файл.";
  else if (/too large \(limit (\d+) MiB\)/i.test(raw)) message = `Файл слишком большой. Максимальный размер: ${raw.match(/limit (\d+)/i)?.[1]} МБ.`;
  else if (/ENOENT|EACCES|EPERM/i.test(raw)) message = "Файл недоступен. Проверьте, что он существует и открыт для чтения.";
  else if (/timed out/i.test(raw)) message = "Обработка заняла слишком много времени. Попробуйте меньший файл.";
  return `${name ? `${name}: ` : ""}${message}`;
}
