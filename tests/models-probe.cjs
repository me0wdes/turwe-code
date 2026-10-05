// Read-only diagnostic: use the saved credential, output only provider model metadata.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createCredentials } = require('../electron/credentials.cjs');
const { getModels, safeError } = require('../electron/api.cjs');
app.setName('Turwe Code');
app.whenReady().then(async () => {
  const dir = path.join(app.getPath('appData'), 'Turwe Code');
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')).settings;
  const key = createCredentials(dir, safeStorage).get(settings.baseUrl);
  let result;
  try { result = { checkedAt: new Date().toISOString(), endpoint: settings.baseUrl, models: await getModels({baseUrl: settings.baseUrl, key}) }; }
  catch (error) { result = { checkedAt: new Date().toISOString(), error: safeError(error, key) }; }
  fs.writeFileSync(process.env.TURWE_MODELS_OUTPUT, JSON.stringify(result, null, 2));
  app.quit();
}).catch(() => app.exit(1));
