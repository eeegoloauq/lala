# Theming

Lala has five built-in themes: dark, light, AMOLED, Discord and Windows XP. A server can set
the default look with `theme:` in `config/lala.yaml` ([self-hosting](self-hosting.md#look)).
Each person can pick a theme, an accent color and their own CSS in Settings → Appearance.

## Your own CSS

CSS typed into Settings → Appearance → Your CSS applies over the theme on that device only.
It is stored in the browser and never sent anywhere. To undo it, clear the field.

The CSS variables are the stable interface. All of them are defined in
[`dark.css`](../packages/web/src/themes/dark.css), grouped by what they style, and the other
themes override them. Class names are internal and can change in any release, so CSS
that targets them may break after an update.

```css
/* A green accent and another font */
:root {
  --accent: #2fa86b;
  --text-accent: #5fd39a;
  --font-family: "Inter", system-ui, sans-serif;
}

/* A wider room list */
:root {
  --sidebar-width: 300px;
}

/* Square avatars and tiles */
:root {
  --avatar-radius: 6px;
  --tile-radius: 4px;
}
```

A server theme takes colors and sizes only, from a fixed list. It cannot carry CSS, so a server
cannot hide the BOT badge or the mark that a bot can hear the call.

## Adding a built-in theme

1. Add `packages/web/src/themes/<id>.css` with the tokens it changes under
   `[data-theme="<id>"]`. Prefer tokens; add selector rules only for what tokens can't express,
   as `winxp.css` does.
2. Import it in `themes/index.ts` and add its label key to `THEME_LABELS`.
3. Add the label to every file in `packages/web/src/locales/`.
4. Add the id to `ThemeId` in `packages/shared/index.d.ts` and to `THEME_IDS` in
   `packages/api/src/lib/config.ts`, so a server can use it as its default.
5. Check the room list, a call, chat, settings and menus at desktop and phone widths.
