import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AddedGame } from '../../../types/electron';

/** Game names are kept to this, as the server keeps them (packages/api/src/lib/profile.ts). */
const NAME_MAX = 100;

/**
 * Games added by hand in the desktop app. Picking happens in the app's own menu of running
 * programs, so this page never sees that list: only the games' names.
 */
export function AddedGames() {
  const { t } = useTranslation();
  const api = window.electronAPI;
  const [games, setGames] = useState<AddedGame[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    api?.getGames?.().then((list) => { if (live) setGames(list); }, () => {});
    return () => { live = false; };
  }, [api]);

  if (!api?.getGames || !api.addGame || !api.renameGame || !api.removeGame) return null;
  const { addGame, renameGame, removeGame } = api;

  const add = async () => {
    setAdding(true);
    try {
      const game = await addGame();
      if (game) setGames((list) => (list.some((g) => g.id === game.id) ? list : [...list, game]));
    } catch (err) {
      console.warn('[AddedGames] Adding failed:', err);
    } finally {
      setAdding(false);
    }
  };

  const rename = (game: AddedGame, name: string) => {
    const clean = name.trim();
    if (!clean || clean === game.name) return;
    renameGame(game.id, clean).then((ok) => {
      if (ok) setGames((list) => list.map((g) => (g.id === game.id ? { ...g, name: clean } : g)));
    }, (err) => console.warn('[AddedGames] Renaming failed:', err));
  };

  const remove = (game: AddedGame) => {
    removeGame(game.id).then(() => setGames((list) => list.filter((g) => g.id !== game.id)),
      (err) => console.warn('[AddedGames] Removing failed:', err));
  };

  return (
    <div className="settings-row settings-row-stacked">
      <div className="settings-row-label">{t('settings.games')}</div>
      {games.map((game) => (
        <div key={game.id} className="added-game">
          <input
            className="input"
            defaultValue={game.name}
            maxLength={NAME_MAX}
            aria-label={t('settings.gameName')}
            onBlur={(e) => rename(game, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <button className="accent-reset-btn" onClick={() => remove(game)}>{t('settings.remove')}</button>
        </div>
      ))}
      <div>
        <button className="avatar-upload-btn" onClick={add} disabled={adding}>{t('settings.addGame')}</button>
      </div>
    </div>
  );
}
