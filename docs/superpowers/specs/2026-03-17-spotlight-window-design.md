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
  options: {
    width: 680,
    height: 56,           // input box only
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,    // level: 'floating'
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: true,
    backgroundThrottling: true,  // throttle when hidden (differs from main window)
  }
}
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

- Renderer sends `spotlight:ready` IPC event after initial load completes
- Main process holds a `readyPromise`; hotkey handler awaits it before showing
- Timeout fallback (> 3s): show anyway, user may see brief loading state

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
- AuthProvider — auth state obtained via IPC from main window
- ServerConfigStoreProvider — not required
- LazyMotion / DragUploadProvider / FaviconProvider — irrelevant
- ModalHost / ToastHost / ContextMenuHost — spotlight has no modals

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

```typescript
// After writing to DB, sender broadcasts
ipcRenderer.send('store:invalidate', {
  keys: ['chat/messages', 'chat/topics'],
  source: 'spotlight', // or 'main'
});

// Main process relays to all other windows
browserManager.broadcastToAllWindows('store:invalidate', payload, excludeSender);

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

Size changes via renderer IPC → main process `setSize()` with animation transition. Top-left position anchored (expands downward only).

### Hide Logic

| Trigger                      | Behavior                                      |
| ---------------------------- | --------------------------------------------- |
| `blur` event (click outside) | Hide in both modes                            |
| `Esc` key                    | Input has content → clear; input empty → hide |
| Re-press hotkey              | Toggle: visible → hide, hidden → show         |
| Command executed             | Await renderer ack → hide                     |

### Post-hide Reset

- Command mode: clear input, shrink window to initial size
- Chat mode: retain current topic context; next invocation resumes (configurable to reset)

### Input Smart Routing

```
User input → check prefix:
  > prefix   → Command mode (list available commands)
  @ prefix   → Search mode (search topics / agents / files)
  plain text → Chat mode (send to current or new topic)
```

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
