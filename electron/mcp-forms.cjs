const {
  AjvJsonSchemaValidator,
} = require("@modelcontextprotocol/sdk/validation/ajv-provider.js");
function validateForm(schema, content) {
  if (
    !content ||
    typeof content !== "object" ||
    Array.isArray(content) ||
    Buffer.byteLength(JSON.stringify(content)) > 64000
  )
    throw new Error("Некорректный ответ формы");
  const allowed = new Set(Object.keys(schema.properties || {}));
  if (Object.keys(content).some((key) => !allowed.has(key)))
    throw new Error("Форма содержит неизвестное поле");
  const result = new AjvJsonSchemaValidator().getValidator(schema)(content);
  if (!result.valid)
    throw new Error("Проверьте поля формы: " + result.errorMessage);
  return content;
}
module.exports = { validateForm };
