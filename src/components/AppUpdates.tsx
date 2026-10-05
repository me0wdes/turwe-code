import { useState } from 'react';
import type { AppUpdate } from '../types';
import { bridge, unwrap } from '../bridge';
import { ArrowDown, RefreshCw, X } from '../icons';
import '../updates.css';

export function UpdateNotice({ update, onError }: { update?: AppUpdate; onError: (message: string) => void }) {
  const [dismissed, setDismissed] = useState('');
  const [busy, setBusy] = useState(false);
  if (update?.status !== 'available' || dismissed === update.version) return null;
  return <div className="update-notice" role="status">
    <ArrowDown size={17} aria-hidden="true" />
    <span>Доступна Turwe Code {update.version}</span>
    <button className="text-button" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await unwrap(bridge.downloadUpdate()); }
      catch (error) { onError((error as Error).message); }
      finally { setBusy(false); }
    }}>Скачать</button>
    <button className="icon-button" aria-label="Напомнить об обновлении при следующем запуске" title="Позже" onClick={() => setDismissed(update.version || '')}><X size={15} /></button>
  </div>;
}

export function UpdateSettings({ update, preview }: { update?: AppUpdate; preview: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const available = update?.status === 'available';
  const text = preview ? 'Проверка доступна в установленном приложении.'
    : update?.status === 'checking' ? 'Проверяем GitHub Releases…'
    : update?.status === 'current' ? 'У вас последняя версия.'
    : update?.status === 'available' ? `Доступна версия ${update.version}. Скачайте её с GitHub и замените приложение.`
    : update?.status === 'unpublished' ? 'Первый выпуск ещё не опубликован.'
    : update?.status === 'unavailable' ? 'Новая версия пока недоступна для этого компьютера.'
    : update?.status === 'error' ? update.error
    : 'Приложение проверяет новые версии при запуске и каждые 6 часов.';
  return <div className="update-settings">
    <div><strong>Обновления приложения</strong><p aria-live="polite">{error || text}</p></div>
    <div className="update-settings-actions">
      {available && <button className="secondary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await unwrap(bridge.downloadUpdate()); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}><ArrowDown size={15} />Скачать {update.version}</button>}
      <button className="secondary-button" disabled={preview || busy || update?.status === 'checking'} onClick={async () => {
        setBusy(true); setError('');
        try { await unwrap(bridge.checkUpdates()); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}><RefreshCw size={15} />Проверить обновления</button>
    </div>
  </div>;
}
