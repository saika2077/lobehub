# Spotlight Window Design Spec

## Overview

A global-hotkey-invoked mini window for LobeChat Desktop, providing quick access to chat, commands, and search without switching to the main window.

## Requirements

- Global hotkey summons window at cursor position
- Single input box entry with smart routing: `>` commands, `@` search, plain text → chat
- Command/search mode: auto-hide after execution; chat mode: persist window
- Progressive rendering: lightweight input shell initially, full message components on demand
- Bi-directional session sharing with main window (DB as source of truth)
- Show latency < 100ms (pre-created hidden BrowserWindow)
- macOS first; Windows later

## Architecture

### Phased Approach

- **v1**: Pure Electron BrowserWindow (`skipTaskbar` + `alwaysOnTop('floating')` + `blur` hide)
- **v2**: Native NSPanel via Swift N-API addon for proper panel behavior + native drag

### Core Components

```
Electron Main Process
├── appBrowsers.ts          ← add 'spotlight' static browser definition
├── Browser                 ← extend with showAt(point) + whenReady()
├── BrowserManager          ← manages spotlight alongside existing windows
├── ShortcutManager         ← new spotlight shortcut registration
└── SpotlightController     ← IPC controller (show/hide/resize/invalidate)

Spotlight Renderer (independent MPA entry)
├── apps/desktop/spotlight.html       ← lightweight HTML entry
├── src/spa/entry.spotlight.tsx       ← minimal provider chain
└── src/routes/desktop/spotlight/     ← spotlight route components
```

### Window Definition (appBrowsers.ts)

```typescript
spotlight: {
  identifier: 'spotlight',
  path: '/desktop/spotlight',
  keepAlive: true,
  showOnInit: false,
  skipSplash: true,          // load spotlight route directly, no splash.html
  options: {
    width: 680,
    height: 56,           // input box only
    frame: false,
    transparent: true,    // NOTE: Browser class strips transparent in constructor,
                          // must bypass WindowThemeManager for spotlight identifier
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: true,
  }
}
```

**Post-creation setup** (in SpotlightController or Browser.retrieveOrInitialize):

```typescript
// alwaysOnTop with 'floating' level (not constructor option)
spotlightWindow.setAlwaysOnTop(true, 'floating');

// backgroundThrottling must be set via webPreferences, not top-level option.
// Browser class hardcodes backgroundThrottling: false in webPreferences;
// spotlight needs override: keep false to ensure < 100ms wake-up latency.
// (Throttling would delay renderer response when hidden)
```

### Lifecycle

```
App launch → create hidden spotlight BrowserWindow
          → load /desktop/spotlight route
          → renderer sends 'spotlight:ready' via IPC
          → readyPromise resolved
          → await hotkey

Hotkey pressed → await readyPromise (normally instant)
             → screen.getCursorScreenPoint()
             → showAt(cursorPoint) with boundary correction
             → focus input box

Command mode → execute → renderer ack → hide() + reset input + shrink to initial size
Chat mode → keep visible → dynamically expand window height
         → blur / Esc (empty input) / re-press hotkey → hide()

hide() → window hidden (not destroyed) → webContents preserved → await next invocation
```

### whenReady() Mechanism

- Spotlight window skips the splash placeholder (no `splash.html`); loads spotlight route directly
- Renderer sends `spotlight:ready` IPC event after initial load completes
- Main process registers `ipcMain.once('spotlight:ready')` during window creation, resolving a stored `readyPromise`
- Hotkey handler awaits `readyPromise` before showing (normally instant after app startup)
- Timeout fallback (> 3s): show anyway, user may see brief loading state
- On renderer crash + recreate: `readyPromise` must be reset to a new pending promise; the recreated renderer will re-emit `spotlight:ready`
- After `show()`, main process sends `spotlight:focus` IPC to renderer to ensure DOM input focus (Electron's `show()` + `focus()` does not guarantee DOM focus lands on the input element)

## Renderer Design

### Independent MPA Entry (Vite)

New HTML + entry file, separate from main window renderer:

```
apps/desktop/
├── index.html           → main window
└── spotlight.html       → spotlight window (new)

src/spa/
├── entry.desktop.tsx    → main window entry
└── entry.spotlight.tsx  → spotlight entry (new)
```

**electron.vite.config.ts modification:**

```typescript
renderer: {
  build: {
    rollupOptions: {
      input: {
        main: resolve(ROOT_DIR, 'apps/desktop/index.html'),
        spotlight: resolve(ROOT_DIR, 'apps/desktop/spotlight.html'),
      }
    }
  }
}
```

**RendererUrlManager modification (production route resolution):**

The existing `resolveRendererFilePath` always falls back to the main `SPA_ENTRY_HTML` (`index.html`). For the spotlight window, paths starting with `/desktop/spotlight` must resolve to `spotlight.html` instead:

```typescript
// In RendererUrlManager.resolveRendererFilePath:
if (pathname.startsWith('/desktop/spotlight')) {
  return resolve(rendererDir, 'spotlight.html');
}
// existing fallback to index.html
```

Without this, the spotlight BrowserWindow would load the main app entry in production.

### Minimal Provider Chain (entry.spotlight.tsx)

```typescript
<Locale>
  <NextThemeProvider>
    <AppTheme>
      <StyleProvider>
        <SpotlightQueryProvider>   // SWR + TRPC only
          <SpotlightRouter />
        </SpotlightQueryProvider>
      </StyleProvider>
    </AppTheme>
  </NextThemeProvider>
</Locale>
```

**Excluded providers** (vs main window SPAGlobalProvider):

- StoreInitialization — no full store init needed
- AuthProvider — not needed; all BrowserWindow instances share the default Electron session (no `partition` set), so cookies and session storage are shared. TRPC client in spotlight inherits the same auth cookies automatically.
- ServerConfigStoreProvider — not required
- LazyMotion / DragUploadProvider / FaviconProvider — irrelevant
- ModalHost / ToastHost / ContextMenuHost — spotlight has no modals

**Auth assumption:** Spotlight renderer shares the default Electron session with main window. Auth cookies set by the main window are available to spotlight's TRPC/fetch calls without additional IPC.

### Progressive Rendering

**Immediate load (in spotlight bundle):**

- InputBox component
- CommandPalette result list (plain text)
- Lightweight inline Markdown renderer

**Dynamic import (on entering chat mode):**

- Full ChatItem / MessageRender components
- Code block syntax highlighting
- Image / file preview
- Related store slices (chat operation, etc.)

## State Synchronization

### Principle: DB as source of truth, no shared in-memory state

Each renderer has its own Zustand stores and SWR cache. Synchronization happens through DB + IPC invalidation.

```
Main Window Renderer          Electron Main Process          Spotlight Renderer
       │                              │                              │
       │──── write to DB ────────────→│                              │
       │                              │── store:invalidate ─────────→│
       │                              │   { keys, source }          │
       │                              │                              │── SWR revalidate
       │                              │                              │
       │                              │←── write to DB ──────────────│
       │←── store:invalidate ─────────│                              │
       │    { keys, source }          │                              │
       │── SWR revalidate             │                              │
```

**IPC events:**

**Prerequisite:** The `store:invalidate` event must be registered in `@lobechat/electron-client-ipc` package's `MainBroadcastEventKey` type definitions. The current `broadcastToAllWindows` method has no `excludeSender` parameter; it must be extended to accept an optional sender `webContents` to exclude.

```typescript
// After writing to DB, sender broadcasts via preload bridge
ipcRenderer.send('store:invalidate', {
  keys: ['chat/messages', 'chat/topics'],
  source: 'spotlight', // or 'main'
});

// Main process relays to all other windows (excludeSender added to API)
// In SpotlightController or a new StoreInvalidationController:
ipcMain.on('store:invalidate', (event, payload) => {
  browserManager.broadcastToOtherWindows(
    'store:invalidate',
    payload,
    event.sender, // exclude the sender's webContents
  );
});

// Receiver triggers SWR revalidation
ipcRenderer.on('store:invalidate', (_, { keys }) => {
  keys.forEach((key) => mutate(key));
});
```

**"Open in main window" action:**

- User clicks "expand in main window" from spotlight chat mode
- Main window navigates to corresponding topic (data already in DB)
- Spotlight hides

**Fallback:** SWR periodic revalidation (e.g., 30s interval) ensures eventual consistency if IPC events are lost.

## Window Behavior & Interaction

### Positioning

```typescript
const cursor = screen.getCursorScreenPoint();
const display = screen.getDisplayNearestPoint(cursor);
const { width, height } = spotlightWindow.getBounds();

// Below cursor, horizontally centered
let x = Math.round(cursor.x - width / 2);
let y = cursor.y + 8;

// Boundary correction: stay within current display work area
const bounds = display.workArea;
x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));

spotlightWindow.setPosition(x, y);
spotlightWindow.show();
```

### Dynamic Window Sizing

| State                  | Size      | Behavior                          |
| ---------------------- | --------- | --------------------------------- |
| Input box only         | 680 x 56  | Initial state                     |
| Command/search results | 680 x 320 | Expand downward (top anchored)    |
| Chat mode              | 680 x 480 | Expand downward, draggable height |

Size changes via renderer IPC → main process `setBounds()`. On macOS, `setBounds({ ...bounds }, { animate: true })` provides native animation; on Windows, animation is renderer-driven (CSS transition on inner container with instant `setSize()`). Top-left position anchored (expands downward only).

### Hide Logic

All Esc/blur handling is **renderer-side** (main process cannot inspect DOM state). Renderer sends `spotlight:hide` IPC to main process when hide is needed.

| Trigger                      | Behavior                                      | Handler       |
| ---------------------------- | --------------------------------------------- | ------------- |
| `blur` event (click outside) | Hide in both modes                            | Main          |
| `Esc` key                    | Input has content → clear; input empty → hide | Renderer      |
| Re-press hotkey              | Toggle: visible → hide, hidden → show         | Main          |
| Command executed             | Await renderer ack → hide                     | Renderer→Main |

### Post-hide Reset

- Command mode: clear input, shrink window to initial size
- Chat mode: retain current topic context (webContents preserved, Zustand store survives hide); next invocation resumes (configurable to reset)

### Multi-display Behavior

- Each show always positions at current cursor location, regardless of previous position
- If user is in chat mode and re-invokes hotkey after hide, window appears at new cursor position

### Input Smart Routing

```
User input → check prefix:
  > prefix   → Command mode (list available commands)
  @ prefix   → Search mode (search topics / agents / files)
  plain text → Chat mode (send to current or new topic)
```

**v1 scope:**

- Commands (`>`): new chat, switch agent, toggle dark mode, open settings
- Search (`@`): topics, agents
- Chat: send to current topic or create new topic

### Preload Script

The existing preload script (`src/preload/index.ts`) runs `setupRouteInterceptors()` which is designed for the main window's client-side routing. The spotlight window uses a separate MPA entry and simpler router. The spotlight window should use the same preload script (to preserve `window.electronAPI` for IPC), but route interception is harmless since spotlight routes are not in the interception config (`src/common/routes.ts`). No separate preload needed.

## Error Handling

| Scenario                                                | Handling                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Spotlight renderer crash                                | Main process listens `webContents.on('crashed')`, recreate window + reload          |
| `whenReady()` timeout (> 3s)                            | Degrade: show anyway, user may see brief loading state                              |
| Hotkey occupied by system                               | Registration failure → notify user, prompt to change shortcut                       |
| IPC `store:invalidate` lost                             | SWR periodic revalidation (30s) as fallback; IPC is not sole sync source            |
| Window position off-screen (external display unplugged) | Validate via `screen.getDisplayNearestPoint()` before show, correct to visible area |

## v2: NSPanel Native Addon (macOS)

**Scope:** Swift N-API addon (\~100-200 lines)

**Implementation:**

- Swift + C bridging header → expose C functions for N-API binding
- `getNativeWindowHandle()` → obtain `NSWindow` reference → convert to `NSPanel`
- Set `NSWindowCollectionBehaviorCanJoinAllSpaces` (exclude from Exposé)
- Set `NSNonactivatingPanelMask` (no focus stealing)
- Native drag handling (replace `-webkit-app-region: drag`)

**Bridge approach:** Swift code compiled as static library, C bridging header exposes functions consumed by N-API addon.

**Platform abstraction:**

```typescript
interface IPanelAdapter {
  convertToPanel(windowHandle: Buffer): void;
  setFloatingBehavior(windowHandle: Buffer, options: PanelOptions): void;
  enableNativeDrag(windowHandle: Buffer, region: DragRegion): void;
}

// macOS implementation (Swift N-API addon)
class MacOSPanelAdapter implements IPanelAdapter { ... }

// Windows implementation (future, C++ N-API addon)
class WindowsPanelAdapter implements IPanelAdapter { ... }
```

**Windows (future direction):**

- `WS_EX_TOOLWINDOW` — exclude from taskbar / Alt+Tab
- Native drag via `WM_NCHITTEST` interception
- Note: `WS_EX_NOACTIVATE` conflicts with input focus requirement; needs careful handling

## v1 Known Limitations (Accepted)

- Window appears in Mission Control / Exposé (resolved in v2)
- May briefly steal focus on show (resolved in v2)
- Drag uses `-webkit-app-region: drag` with known Electron quirks (resolved in v2)
