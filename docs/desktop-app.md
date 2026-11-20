# Wololo

**Wololo** (`app/`) shows the runs of every terminal and project in one place:

- **Menu bar**: an icon with how many runs are waiting for you, and a menu to show the widget, open the window, the settings, or quit.
- **Widget**: a floating panel over every space and full-screen app, with the active runs, those waiting for you first. ⌘⇧L shows or hides it from any app.
- **Window**: opens when the app starts. A sidebar by project and a board of cards by status or by stage, or a grid of the active runs with their stages beside each card (as many per row as fit, or 1 to 6 chosen beside the view picker), with search.
- **Detail**: a run's stages, what it is doing or waiting on, items, agents, PR and CI, timeline, documents, screenshots and cost. **Ir a la terminal** (also on each widget row) brings the iTerm2 or Ghostty tab of its session to the front, or opens one in its directory and copies `/wololo resume <run>`.

It only reads the store, except **Descartar** in a run's detail: for a run no session holds anymore (paused or orphaned, no heartbeat for 90 s), it records `run.finished {outcome: cancelled}` and its snapshot, as the mod's cancel would, after a confirmation. The worktree, branch and files stay in place. The data directory is `WOLOLO_DATA_DIR`, else the one set in its settings, else `~/.claude/wololo`.

```sh
make app       # app/scripts/build-app.sh: app/dist/Wololo.app, signed ad hoc
make install   # app/scripts/build-app.sh --install: and copies it to ~/Applications
```

`--install` replaces an existing `~/Applications/Wololo.app` only if it is a Wololo build. The first **Ir a la terminal** asks for the Automation permission for each terminal; if it was denied, allow it in System Settings → Privacy & Security → Automation. Requires macOS 14 and Swift 5.9 or later.

To develop:

```sh
cd app && swift build && swift test           # WololoKit has the tests
scripts/sample-data.sh /tmp/wololo-sample     # a data directory with sample runs and a sample goal
WOLOLO_DATA_DIR=/tmp/wololo-sample .build/debug/WololoDesk
WOLOLO_DATA_DIR=/tmp/wololo-sample WOLOLO_DESK_GOALS_DIR=/tmp/wololo-sample-goals .build/debug/WololoDesk
```

The goals are kept in `~/Library/Application Support/Wololo Desk/Goals` (the folder keeps the app's former name), or in `WOLOLO_DESK_GOALS_DIR` when it is set. On the sample data (a data directory with the `.wololo-sample` marker) the sample goal is shown but nothing is written to your own goals, so edits are not kept; to try edits on it, point `WOLOLO_DESK_GOALS_DIR` at a throwaway folder, as in the last line.

To check the UI without screen recording, `WOLOLO_DESK_SNAPSHOT=<png>` draws what `WOLOLO_DESK_OPEN` asks for (`window`, `widget`, `settings`, `run:<id>[:timeline|documents|screenshots|cost]`, `planning`, `new-project` (Planificación with the "Nuevo proyecto" sheet) or `goal:<id>`, with `WOLOLO_DESK_NODE=<node id>` selecting a node on that goal) and quits, without writing settings or goals and without reading your goals (only those in `WOLOLO_DESK_GOALS_DIR`, if set, and the data directory's copy); `WOLOLO_DESK_SEARCH`, `WOLOLO_DESK_PROJECT` and `WOLOLO_DESK_COLUMNS` (`status`, `stage` or `grid`) set the board's filters, and `WOLOLO_DESK_THEME` and `WOLOLO_DESK_THEMES_DIR` the theme (see **Themes**). The sample runs' times are relative to when `sample-data.sh` ran, so run it again right before a snapshot.

## Themes

A theme changes how Wololo looks (colors, fonts, textures, frames, separators, icons, the shape of the progress bar) and the names of the columns and sidebar sections. It never changes the layout: positions, sizes and which sections exist stay the same in every theme. It is picked in **Ajustes → Apariencia → Tema**, applies at once to the window, the detail, the widget, Settings and the toasts, and is kept for the next launch; a saved theme that is gone or broken by then gives Actual.

- **Actual**: the look from before themes, with system fonts, a continuous progress bar and round dots. The default.
- **AoE**: the Age of Empires look: a dark texture, a double rod between the sidebar and the board, a braided band, Cinzel headings, a bar of 8 gold blocks, hoods and gems, and period names (Resisting, Converting, Idle, Unit ready; Buildings).

Your own themes are the folders of `~/Library/Application Support/Wololo Desk/Themes/`, each with a `theme.json` and the files it names: `Themes/<folder>/theme.json`. The folder's name is the theme's key, and `actual` and `aoe` are reserved. **Abrir carpeta de temas** opens that folder, creating it if needed. **Duplicar el tema elegido como tema propio** copies the theme in use, files included, into `<key>-copia` and switches to it, which is the easiest starting point. **Recargar temas** reads the folder again after you edit a theme; nothing reloads on its own.

`theme.json` is version 1. Every key but `version` is optional, and what a theme leaves out comes from Actual, so a theme can be a single color:

```json
{ "version": 1, "name": "Violeta", "colors": { "surface": "#3a2a4a" } }
```

| Key | What |
|---|---|
| `version` | `1`, the only version understood |
| `name`, `author`, `id` | the name Settings shows (by default, the folder's), and who made it; the key is always the folder's name |
| `colors.ground`, `sidebar`, `surface`, `surfaceHover`, `field` | backgrounds: window, sidebar, cards, a hovered card, fields |
| `colors.border`, `borderHover`, `divider`, `cardDivider`, `rowDivider` | borders and dividers |
| `colors.title`, `heading`, `text`, `secondary`, `muted`, `faint`, `pendingMark`, `agent` | text, from strongest to faintest, pending marks and agents |
| `colors.accent`, `focus`, `selection` | links, toggles and the logo; the focus ring and the selected card; the selection |
| `colors.widget`, `widgetBorder`, `widgetHover` | the widget |
| `colors.status.<status>` | `color`, `badge`, `badgeText`, `activity` and `hood` for `waiting`, `permission`, `blocked`, `stalled`, `running`, `agents`, `tests`, `ci`, `pausing`, `paused`, `review`, `orphaned`, `done`, `failed` or `cancelled`; `hood` overrides the column's |
| `colors.columns.<column>` | `icon`, `title` and `hood` (the cards' hood; the icon's color if unset) for `waiting`, `working`, `review`, `onHold` (the section under the board) or `finished` |
| `colors.bar` | `fill`, `"status"` (the column's color) or a color, and `track` |
| `colors.ci` | `pending`, `passing`, `failing`, `none` |
| `fonts.display`, `body`, `mono` | `family` (empty is the system font), `file` (a font file in the theme's folder, loaded for the app only), `weight` (CSS-style: 400 regular, 700 bold; 1 to 1000) and `tracking` (in em, like CSS `letter-spacing`) |
| `images.background` | `file`, a texture tiled behind everything, and its `size` |
| `images.divider` | `file`, the vertical divider between the sidebar and the board, and its `width` |
| `images.frame` | `file`, a 9-slice frame for cards, the counters box and the segmented control, with its `slice` (in pixels of the file, like CSS `border-image-slice`) and its drawn `width` |
| `images.band` | `file`, the horizontal band under the board's header and over the archive, and its `height` |
| `shapes.radius` | the cards' corner radius (Actual's is 10); the other radii scale with it, and 0 squares them all |
| `shapes.bar`, `bullet` | `continuous` or `blocks` (one per stage); `dot` or `gem` |
| `shapes.statusIcon` | the card's status icon: `dot`, `hood` or `image:<file>` |
| `shapes.columnIcons.<column>`, `projectIcon` | `dot`, `symbol:<SF Symbol>`, `builtin:<name>` (AoE's `resisting`, `converting`, `researching`, `idle`, `unitReady`, `castle`) or `image:<file>` |
| `texts.columns.<column>` | `title` and `subtitle` (an empty one removes the base's); `onHold`'s title names the section under the board |
| `texts.waitingSection`, `projectsSection`, `all`, `boardTitle`, `counterWorking`, `counterWaiting`, `archive`, `empty` | the sidebar's sections, the board's title and counters, the archive and the empty column |

Colors are `#rrggbb` or `#rrggbbaa`, sizes are in points, and files are paths inside the theme's folder. Statuses, stages and what the runs say cannot be renamed. `Resources/Themes/aoe/theme.json` in `app/Sources/WololoDesk` is a complete example.

A theme is untrusted input, and is checked before use:

- **Unusable**: invalid JSON, a version other than 1, a malformed color, an unknown value (a status, a bar shape, an icon), an image without its file or size, or a path that leaves the theme's folder (absolute, `~`, `..`, or a symlink pointing out). The picker shows it disabled, and Settings says why under **No se pueden elegir**.
- **Warning**: a file that is not there, an image that does not load, a font that is not available. The theme is used without it (no texture, the system font) and Settings says what is missing.

Neither breaks the app. For one launch, `WOLOLO_DESK_THEME=<key>` uses that theme without saving it, and `WOLOLO_DESK_THEMES_DIR=<dir>` reads your themes from `<dir>` instead of Application Support (duplicates go there too).

The fonts AoE uses ship inside the app, so they need not be installed: Cinzel, Source Sans 3 and JetBrains Mono, all under the SIL Open Font License 1.1. Each licence is next to its font in `app/Sources/WololoDesk/Resources/Fonts` (`OFL-Cinzel.txt`, `OFL-SourceSans3.txt`, `OFL-JetBrainsMono.txt`) and in the `.app`'s resource bundle.
