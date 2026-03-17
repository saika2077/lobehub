# Spotlight Window Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global-hotkey-invoked mini window to LobeChat Desktop for quick chat, commands, and search.

**Architecture:** Independent Vite MPA entry with minimal provider chain, hidden BrowserWindow with `keepAlive: true`, IPC-based show/hide/resize orchestration. DB as state source of truth, `store:invalidate` IPC broadcast for cross-window sync.

**Tech Stack:** Electron BrowserWindow, electron-vite MPA, React 19, Zustand, SWR, TRPC, antd-style

**Spec:** `docs/superpowers/specs/2026-03-17-spotlight-window-design.md`

---

## Chunk 1: Main Process — Window Definition & Lifecycle

### Task 1: Add spotlight identifier and shortcut config

**Files:**

- Modify: `apps/desktop/src/main/appBrowsers.ts`

- Modify: `apps/desktop/src/main/shortcuts/config.ts`

- [ ] **Step 1: Add spotlight to BrowsersIdentifiers and appBrowsers**

In `apps/desktop/src/main/appBrowsers.ts`, add `spotlight` to `BrowsersIdentifiers` and `appBrowsers`:

```typescript
// In BrowsersIdentifiers (line 5-8):
export const BrowsersIdentifiers = {
  app: 'app',
  devtools: 'devtools',
  spotlight: 'spotlight',
};

// In appBrowsers, add after devtools (line 34):
  spotlight: {
    fullscreenable: false,
    hasShadow: true,
    height: 56,
    identifier: 'spotlight',
    keepAlive: true,
    maximizable: false,
    minimizable: false,
    path: '/desktop/spotlight',
    resizable: false,
    showOnInit: false,
    skipTaskbar: true,
    width: 680,
  },
```

Note: Do NOT add `transparent`, `vibrancy`, or `visualEffectState` here — they are stripped by `Browser.createBrowserWindow()` (lines 117-123 of `Browser.ts`). Visual effects are handled by `WindowThemeManager.getPlatformConfig()`. The `frame: false` default is already set in `Browser.createBrowserWindow()` at line 135.

- [ ] **Step 2: Add spotlight shortcut to config**

In `apps/desktop/src/main/shortcuts/config.ts`:

```typescript
export const ShortcutActionEnum = {
  openSettings: 'openSettings',
  showApp: 'showApp',
  showSpotlight: 'showSpotlight',
} as const;

export const DEFAULT_SHORTCUTS_CONFIG: Record<ShortcutActionType, string> = {
  [ShortcutActionEnum.showApp]: 'Control+E',
  [ShortcutActionEnum.openSettings]: 'CommandOrControl+,',
  [ShortcutActionEnum.showSpotlight]: 'CommandOrControl+Shift+Space',
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/appBrowsers.ts apps/desktop/src/main/shortcuts/config.ts
git commit -m "feat(desktop): add spotlight window definition and shortcut config"
```

---

### Task 2: Extend Browser class — skipSplash, transparent bypass, showAt, whenReady

**Files:**

- Modify: `apps/desktop/src/main/core/browser/Browser.ts`

- [ ] **Step 1: Add `skipSplash` to BrowserWindowOpts interface**

At line 25-35 of `Browser.ts`, add `skipSplash` to the interface:

```typescript
export interface BrowserWindowOpts extends BrowserWindowConstructorOptions {
  devTools?: boolean;
  height?: number;
  identifier: string;
  keepAlive?: boolean;
  parentIdentifier?: string;
  path: string;
  showOnInit?: boolean;
  skipSplash?: boolean; // Skip splash.html, load route directly
  title?: string;
  width?: number;
}
```

- [ ] **Step 2: Add readyPromise infrastructure**

Add properties after line 44 (`private _browserWindow`):

```typescript
  private _readyResolve?: () => void;
  private _readyPromise: Promise<void>;
```

In the constructor (after line 68 `this.options = options`), initialize the promise:

```typescript
this._readyPromise = new Promise<void>((resolve) => {
  this._readyResolve = resolve;
});
```

Add public methods after `toggleVisible()` (line 327):

```typescript
  /**
   * Wait until renderer signals ready via IPC.
   * Resolves immediately if already ready. Times out after 3s.
   */
  async whenReady(timeoutMs = 3000): Promise<void> {
    await Promise.race([
      this._readyPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /**
   * Mark this window's renderer as ready. Called from IPC handler.
   */
  markReady(): void {
    this._readyResolve?.();
  }

  /**
   * Reset ready state (e.g. after crash + recreate).
   */
  resetReady(): void {
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }
```

- [ ] **Step 3: Add showAt(point) method**

Add after `whenReady`/`markReady`/`resetReady` methods:

```typescript
  /**
   * Show window at a specific screen coordinate.
   * Applies boundary correction to keep within display work area.
   */
  showAt(point: { x: number; y: number }): void {
    const display = screen.getDisplayNearestPoint(point);
    const { width, height } = this.browserWindow.getBounds();

    // Position below cursor, horizontally centered
    let x = Math.round(point.x - width / 2);
    let y = point.y + 8;

    // Boundary correction: stay within current display work area
    const bounds = display.workArea;
    x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));
    y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height));

    this.browserWindow.setPosition(x, y);
    this.browserWindow.show();
    this.browserWindow.focus();
  }
```

- [ ] **Step 4: Modify initiateContentLoading to respect skipSplash**

Replace `initiateContentLoading()` at lines 180-190:

```typescript
  private initiateContentLoading(): void {
    logger.debug(`[${this.identifier}] Initiating content loading sequence.`);

    if (this.options.skipSplash) {
      // Skip splash placeholder, load route directly
      this.loadUrl(this.options.path).catch((e) => {
        logger.error(
          `[${this.identifier}] Initial loadUrl error for path '${this.options.path}':`,
          e,
        );
      });
    } else {
      this.loadPlaceholder().then(() => {
        this.loadUrl(this.options.path).catch((e) => {
          logger.error(
            `[${this.identifier}] Initial loadUrl error for path '${this.options.path}':`,
            e,
          );
        });
      });
    }
  }
```

- [ ] **Step 5: Handle transparent bypass for spotlight in WindowThemeManager**

In `apps/desktop/src/main/core/browser/WindowThemeManager.ts`, modify `getPlatformConfig()` (line 119). The spotlight window needs `transparent: true` always (for borderless appearance), but the default `getPlatformConfig()` conditionally returns `transparent` based on liquid glass availability on macOS.

Add a constructor parameter to allow force-transparent:

Actually, the simpler approach: the spotlight `BrowserWindowOpts` does NOT include `transparent` (it's stripped). Instead, we handle it in `Browser.createBrowserWindow()`. Add a special case right before the `return new BrowserWindow(...)` call.

In `Browser.ts`, modify `createBrowserWindow()`. After the spread of `themeManager.getPlatformConfig()` (line 150), add spotlight-specific overrides:

Replace lines 130-152 with:

```typescript
const platformConfig = this.themeManager.getPlatformConfig();

// Spotlight window: force transparent, no vibrancy (clean floating panel)
const spotlightOverrides =
  this.identifier === 'spotlight'
    ? { trafficLightPosition: undefined, transparent: true, vibrancy: undefined }
    : {};

return new BrowserWindow({
  ...rest,
  autoHideMenuBar: true,
  backgroundColor: '#00000000',
  darkTheme: this.themeManager.isDarkMode,
  frame: false,
  height: resolvedState.height,
  show: false,
  title,
  webPreferences: {
    backgroundThrottling: false,
    contextIsolation: true,
    preload: join(preloadDir, 'index.js'),
    sandbox: false,
    webviewTag: true,
  },
  width: resolvedState.width,
  x: resolvedState.x,
  y: resolvedState.y,
  ...platformConfig,
  ...spotlightOverrides,
});
```

- [ ] **Step 6: Add post-creation setup for spotlight (alwaysOnTop)**

In `setupWindow()` (line 154), add after `this.themeManager.attach(browserWindow)`:

```typescript
// Spotlight: float above all windows
if (this.identifier === 'spotlight') {
  browserWindow.setAlwaysOnTop(true, 'floating');
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/core/browser/Browser.ts apps/desktop/src/main/core/browser/WindowThemeManager.ts
git commit -m "feat(desktop): extend Browser class with showAt, whenReady, skipSplash, spotlight overrides"
```

---

### Task 3: Extend BrowserManager — broadcastToOtherWindows

**Files:**

- Modify: `apps/desktop/src/main/core/browser/BrowserManager.ts`

- [ ] **Step 1: Add broadcastToOtherWindows method**

After `broadcastToWindow` (line 61), add:

```typescript
/**
 * Broadcast event to all windows except the one matching excludeWebContents.
 */
broadcastToOtherWindows = <T extends MainBroadcastEventKey>(
  event: T,
  data: MainBroadcastParams<T>,
  excludeWebContents?: WebContents,
) => {
  logger.debug(`Broadcasting event ${event} to all windows except sender`);
  this.browsers.forEach((browser) => {
    if (excludeWebContents && browser.webContents === excludeWebContents) return;
    browser.broadcast(event, data);
  });
};
```

- [ ] **Step 2: Add getSpotlightWindow helper**

After `getMainWindow()` (line 36):

```typescript
  getSpotlightWindow() {
    return this.retrieveByIdentifier(BrowsersIdentifiers.spotlight);
  }
```

- [ ] **Step 3: Update initializeBrowsers to handle spotlight**

The spotlight window has `keepAlive: true` so it will already be initialized by the existing loop at line 203. However, the spotlight window should NOT be initialized before onboarding is complete. The existing condition at line 197 only checks `BrowsersIdentifiers.app`, but we need to ensure spotlight is also gated.

Actually, looking at the code again — `initializeBrowsers()` at line 193 iterates ALL `appBrowsers` and initializes any with `keepAlive: true`. This means spotlight will be auto-initialized alongside the main window. This is correct — we want it pre-created at startup.

But we should skip spotlight init if onboarding is not completed. Modify the loop:

```typescript
Object.values(appBrowsers).forEach((browser: BrowserWindowOpts) => {
  logger.debug(`Initializing browser: ${browser.identifier}`);

  // Dynamically determine initial path for main window
  if (browser.identifier === BrowsersIdentifiers.app) {
    const initialPath = isOnboardingCompleted ? '/' : '/desktop-onboarding';
    browser = { ...browser, path: initialPath };
    logger.debug(`Main window initial path: ${initialPath}`);
  }

  // Don't initialize spotlight until onboarding is done
  if (browser.identifier === BrowsersIdentifiers.spotlight && !isOnboardingCompleted) {
    return;
  }

  if (browser.keepAlive) {
    this.retrieveOrInitialize(browser);
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/core/browser/BrowserManager.ts
git commit -m "feat(desktop): add broadcastToOtherWindows and spotlight helpers to BrowserManager"
```

---

### Task 4: Modify RendererUrlManager for spotlight HTML resolution

**Files:**

- Modify: `apps/desktop/src/main/core/infrastructure/RendererUrlManager.ts`

- [ ] **Step 1: Add spotlight HTML constant and update resolveRendererFilePath**

At line 16, add the spotlight entry path:

```typescript
const SPA_ENTRY_HTML = join(rendererDir, 'apps', 'desktop', 'index.html');
const SPOTLIGHT_ENTRY_HTML = join(rendererDir, 'apps', 'desktop', 'spotlight.html');
```

Modify `resolveRendererFilePath` (lines 71-82):

```typescript
resolveRendererFilePath = async (url: URL): Promise<string | null> => {
  const pathname = url.pathname;

  // Static assets: direct file mapping
  if (pathname.startsWith('/assets/') || extname(pathname)) {
    const filePath = join(rendererDir, pathname);
    return pathExistsSync(filePath) ? filePath : null;
  }

  // Spotlight routes → spotlight.html
  if (pathname.startsWith('/desktop/spotlight')) {
    return SPOTLIGHT_ENTRY_HTML;
  }

  // All other routes fallback to index.html (SPA)
  return SPA_ENTRY_HTML;
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/core/infrastructure/RendererUrlManager.ts
git commit -m "feat(desktop): route spotlight paths to spotlight.html in RendererUrlManager"
```

---

### Task 5: Create SpotlightController

**Files:**

- Create: `apps/desktop/src/main/controllers/SpotlightCtr.ts`

- [ ] **Step 1: Create the controller**

```typescript
import { ipcMain, screen } from 'electron';

import { BrowsersIdentifiers } from '@/appBrowsers';

import { ControllerModule, IpcMethod, shortcut } from './index';

export default class SpotlightCtr extends ControllerModule {
  static override readonly groupName = 'spotlight';

  override async initialize() {
    // Listen for renderer ready signal
    ipcMain.on('spotlight:ready', () => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      spotlight?.markReady();
    });

    // Listen for renderer hide request
    ipcMain.on('spotlight:hide', () => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      spotlight?.hide();
    });

    // Listen for renderer resize request
    ipcMain.on('spotlight:resize', (_event, params: { height: number; width: number }) => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      if (!spotlight) return;

      const currentBounds = spotlight.browserWindow.getBounds();
      spotlight.browserWindow.setBounds(
        {
          height: params.height,
          width: params.width,
          x: currentBounds.x,
          y: currentBounds.y,
        },
        true, // animate on macOS
      );
    });

    // Setup blur handler for spotlight window
    this.setupBlurHandler();
  }

  @shortcut('showSpotlight')
  async toggleSpotlight() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (!spotlight) return;

    if (spotlight.browserWindow.isVisible()) {
      spotlight.hide();
      return;
    }

    // Wait for renderer to be ready
    await spotlight.whenReady();

    // Get cursor position and show at cursor
    const cursor = screen.getCursorScreenPoint();
    spotlight.showAt(cursor);

    // Notify renderer to focus input
    spotlight.broadcast('spotlightFocus' as any);
  }

  /**
   * Renderer calls this to resize the spotlight window (e.g. expand for results/chat)
   */
  @IpcMethod()
  async resize(params: { height: number; width: number }) {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (!spotlight) return;

    const currentBounds = spotlight.browserWindow.getBounds();
    spotlight.browserWindow.setBounds(
      {
        height: params.height,
        width: params.width,
        x: currentBounds.x,
        y: currentBounds.y,
      },
      true,
    );
  }

  /**
   * Renderer calls this to hide the spotlight window
   */
  @IpcMethod()
  async hide() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    spotlight?.hide();
  }

  private setupBlurHandler() {
    // Watch for spotlight window creation then attach blur listener
    const checkAndAttach = () => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      if (spotlight) {
        spotlight.browserWindow.on('blur', () => {
          if (spotlight.browserWindow.isVisible()) {
            spotlight.hide();
          }
        });
      }
    };

    // Attach after browsers are initialized (slight delay for initialization order)
    setTimeout(checkAndAttach, 1000);
  }
}
```

- [ ] **Step 2: Verify the controller auto-loads**

Controllers in `apps/desktop/src/main/controllers/` are loaded dynamically via `import.meta.glob` in `App.ts`. The new file `SpotlightCtr.ts` will be auto-discovered. No manual registration needed.

Run: `ls apps/desktop/src/main/controllers/` to verify file is present.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/controllers/SpotlightCtr.ts
git commit -m "feat(desktop): create SpotlightController with show/hide/resize IPC"
```

---

### Task 6: Register spotlight broadcast events in electron-client-ipc

**Files:**

- Modify: `packages/electron-client-ipc/src/events/` — add spotlight events

- [ ] **Step 1: Find and check existing event pattern**

Run: `ls packages/electron-client-ipc/src/events/`

Look at an existing event file (e.g. `navigation.ts`) to understand the pattern.

- [ ] **Step 2: Create spotlight event types**

Create `packages/electron-client-ipc/src/events/spotlight.ts`:

```typescript
export interface SpotlightBroadcastEvents {
  spotlightFocus: () => void;
}
```

- [ ] **Step 3: Register in events index**

In `packages/electron-client-ipc/src/events/index.ts`, add:

```typescript
import type { SpotlightBroadcastEvents } from './spotlight';

export interface MainBroadcastEvents
  extends
    AutoUpdateBroadcastEvents,
    NavigationBroadcastEvents,
    RemoteServerBroadcastEvents,
    SystemBroadcastEvents,
    ProtocolBroadcastEvents,
    SpotlightBroadcastEvents {}
```

- [ ] **Step 4: Commit**

```bash
git add packages/electron-client-ipc/src/events/spotlight.ts packages/electron-client-ipc/src/events/index.ts
git commit -m "feat(electron-client-ipc): add spotlight broadcast event types"
```

---

## Chunk 2: Vite MPA Entry & Renderer Shell

### Task 7: Create spotlight.html entry

**Files:**

- Create: `apps/desktop/spotlight.html`

- [ ] **Step 1: Create minimal HTML entry**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
      }
      #root {
        height: 100%;
      }
    </style>
  </head>
  <body>
    <script>
      (function () {
        var theme = 'system';
        try {
          theme = localStorage.getItem('theme') || 'system';
        } catch (_) {}
        var systemTheme =
          window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        var resolvedTheme = theme === 'system' ? systemTheme : theme;
        if (resolvedTheme === 'dark' || resolvedTheme === 'light') {
          document.documentElement.setAttribute('data-theme', resolvedTheme);
        }
        var locale = navigator.language || 'en-US';
        document.documentElement.lang = locale;
      })();
    </script>
    <div id="root"></div>
    <script>
      window.__SERVER_CONFIG__ = undefined;
    </script>
    <script type="module" src="../../src/spa/entry.spotlight.tsx"></script>
  </body>
</html>
```

No loading screen (no splash needed for spotlight — it starts hidden).

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/spotlight.html
git commit -m "feat(desktop): add spotlight.html MPA entry"
```

---

### Task 8: Modify electron.vite.config.ts for MPA

**Files:**

- Modify: `apps/desktop/electron.vite.config.ts`

- [ ] **Step 1: Add spotlight to rollup input**

Change line 101 from single input to multi-input:

```typescript
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          spotlight: resolve(__dirname, 'spotlight.html'),
        },
        output: sharedRollupOutput,
      },
    },
```

- [ ] **Step 2: Update dev server middleware to handle spotlight route**

Modify `electronDesktopHtmlPlugin()` (lines 20-32) to also handle `/desktop/spotlight`:

```typescript
function electronDesktopHtmlPlugin(): PluginOption {
  return {
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          req.url = '/apps/desktop/index.html';
        }
        // Spotlight routes serve spotlight.html
        if (req.url?.startsWith('/desktop/spotlight')) {
          req.url = '/apps/desktop/spotlight.html';
        }
        next();
      });
    },
    name: 'electron-desktop-html',
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron.vite.config.ts
git commit -m "feat(desktop): configure Vite MPA with spotlight entry"
```

---

### Task 9: Create entry.spotlight.tsx with minimal provider chain

**Files:**

- Create: `src/spa/entry.spotlight.tsx`

- [ ] **Step 1: Create minimal entry**

```typescript
import '../initialize';

import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import AppTheme from '@/layout/GlobalProvider/AppTheme';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import QueryProvider from '@/layout/GlobalProvider/Query';
import Locale from '@/layout/SPAGlobalProvider/Locale';

import SpotlightWindow from '@/features/Spotlight';

const SpotlightProvider = memo<PropsWithChildren>(({ children }) => {
  const locale = document.documentElement.lang || 'en-US';

  return (
    <Locale defaultLang={locale}>
      <NextThemeProvider>
        <AppTheme>
          <QueryProvider>
            <StyleProvider speedy={import.meta.env.PROD}>{children}</StyleProvider>
          </QueryProvider>
        </AppTheme>
      </NextThemeProvider>
    </Locale>
  );
});

SpotlightProvider.displayName = 'SpotlightProvider';

const App = () => {
  useEffect(() => {
    // Signal to main process that renderer is ready
    window.electronAPI?.invoke('spotlight:ready');
  }, []);

  return (
    <SpotlightProvider>
      <SpotlightWindow />
    </SpotlightProvider>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
```

Note: `window.electronAPI?.invoke` is exposed by the existing preload script. Check `apps/desktop/src/preload/electronApi.ts` for the exact API. If `invoke` is only for request-response, use `ipcRenderer.send` via the preload bridge instead:

```typescript
window.electron?.ipcRenderer.send('spotlight:ready');
```

Verify which API is available by checking the preload script.

- [ ] **Step 2: Commit**

```bash
git add src/spa/entry.spotlight.tsx
git commit -m "feat(spotlight): create entry.spotlight.tsx with minimal provider chain"
```

---

### Task 10: Create Spotlight feature module — basic shell

**Files:**

- Create: `src/features/Spotlight/index.tsx`

- Create: `src/features/Spotlight/InputBox.tsx`

- Create: `src/features/Spotlight/style.ts`

- [ ] **Step 1: Create the style file**

```typescript
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    height: 100vh;
    border-radius: 12px;
    overflow: hidden;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    -webkit-app-region: drag;
  `,
  inputArea: css`
    display: flex;
    align-items: center;
    padding: 8px 16px;
    gap: 8px;
    -webkit-app-region: no-drag;
  `,
  input: css`
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
    color: ${token.colorText};
    &::placeholder {
      color: ${token.colorTextQuaternary};
    }
  `,
}));
```

- [ ] **Step 2: Create InputBox component**

```typescript
import { useRef, useEffect, type ChangeEvent, type KeyboardEvent } from 'react';

import { useStyles } from './style';

interface InputBoxProps {
  onChange: (value: string) => void;
  onEscape: () => void;
  onSubmit: (value: string) => void;
  value: string;
}

const InputBox = ({ value, onChange, onSubmit, onEscape }: InputBoxProps) => {
  const { styles } = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for focus signal from main process
  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus();
    };

    window.electron?.ipcRenderer.on('spotlightFocus', handler);
    return () => {
      window.electron?.ipcRenderer.removeListener('spotlightFocus', handler);
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (value) {
        onChange('');
      } else {
        onEscape();
      }
      return;
    }
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
    }
  };

  return (
    <div className={styles.inputArea}>
      <input
        ref={inputRef}
        autoFocus
        className={styles.input}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type to chat, > for commands, @ for search..."
        value={value}
      />
    </div>
  );
};

export default InputBox;
```

- [ ] **Step 3: Create main Spotlight component**

```typescript
import { memo, useCallback, useState } from 'react';

import InputBox from './InputBox';
import { useStyles } from './style';

const SpotlightWindow = memo(() => {
  const { styles } = useStyles();
  const [inputValue, setInputValue] = useState('');

  const handleHide = useCallback(() => {
    window.electron?.ipcRenderer.send('spotlight:hide');
  }, []);

  const handleSubmit = useCallback((value: string) => {
    if (value.startsWith('>')) {
      // Command mode — TODO: implement
      console.log('Command:', value.slice(1).trim());
      handleHide();
    } else if (value.startsWith('@')) {
      // Search mode — TODO: implement
      console.log('Search:', value.slice(1).trim());
    } else {
      // Chat mode — TODO: implement
      console.log('Chat:', value);
    }
  }, [handleHide]);

  return (
    <div className={styles.container}>
      <InputBox
        onChange={setInputValue}
        onEscape={handleHide}
        onSubmit={handleSubmit}
        value={inputValue}
      />
    </div>
  );
});

SpotlightWindow.displayName = 'SpotlightWindow';

export default SpotlightWindow;
```

- [ ] **Step 4: Commit**

```bash
git add src/features/Spotlight/
git commit -m "feat(spotlight): create Spotlight feature module with InputBox shell"
```

---

## Chunk 3: Integration & End-to-End Verification

### Task 11: Update appBrowsers with skipSplash flag

**Files:**

- Modify: `apps/desktop/src/main/appBrowsers.ts`

- [ ] **Step 1: Add skipSplash to spotlight definition**

The `skipSplash` field was added to `BrowserWindowOpts` in Task 2. Now set it in the spotlight config:

```typescript
  spotlight: {
    fullscreenable: false,
    hasShadow: true,
    height: 56,
    identifier: 'spotlight',
    keepAlive: true,
    maximizable: false,
    minimizable: false,
    path: '/desktop/spotlight',
    resizable: false,
    showOnInit: false,
    skipSplash: true,
    skipTaskbar: true,
    width: 680,
  },
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/appBrowsers.ts
git commit -m "feat(desktop): add skipSplash flag to spotlight browser definition"
```

---

### Task 12: Verify IPC ready signal works with preload bridge

**Files:**

- Read: `apps/desktop/src/preload/electronApi.ts`

- Read: `apps/desktop/src/preload/invoke.ts`

- Possibly modify: `src/spa/entry.spotlight.tsx`

- [ ] **Step 1: Check preload API surface**

Read `apps/desktop/src/preload/electronApi.ts` and `apps/desktop/src/preload/invoke.ts` to confirm how `window.electronAPI` and `window.electron` expose IPC.

The standard `@electron-toolkit/preload` exposes `window.electron.ipcRenderer.send(channel, ...args)`. Use this for fire-and-forget IPC:

```typescript
// In entry.spotlight.tsx, signal ready:
window.electron?.ipcRenderer.send('spotlight:ready');

// In InputBox.tsx, request hide:
window.electron?.ipcRenderer.send('spotlight:hide');
```

If the preload uses a custom wrapper (e.g. `window.electronAPI.invoke`), adjust accordingly.

- [ ] **Step 2: Update entry.spotlight.tsx if needed**

Ensure the ready signal uses the correct preload API.

- [ ] **Step 3: Commit if changes made**

```bash
git add src/spa/entry.spotlight.tsx
git commit -m "fix(spotlight): use correct preload IPC API for ready signal"
```

---

### Task 13: Manual integration test

- [ ] **Step 1: Start dev environment**

```bash
cd apps/desktop && bun run dev
```

- [ ] **Step 2: Verify spotlight window is created (hidden) on startup**

Check electron logs for:

- `Creating Browser instance: spotlight`

- `Initiating content loading sequence` (without splash)

- [ ] **Step 3: Press shortcut (Cmd+Shift+Space) to invoke spotlight**

Verify:

- Window appears at cursor position

- Input box is focused

- Typing works

- [ ] **Step 4: Test hide behaviors**

- Press Esc with empty input → window hides

- Type something, press Esc → input clears, press Esc again → window hides

- Click outside window → window hides

- Press shortcut again → window toggles

- [ ] **Step 5: Fix any issues found**

---

### Task 14: Add crash recovery handler

**Files:**

- Modify: `apps/desktop/src/main/controllers/SpotlightCtr.ts`

- [ ] **Step 1: Add webContents crash handler in initialize()**

Add to `SpotlightCtr.initialize()`:

```typescript
// Setup crash recovery
const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
if (spotlight) {
  spotlight.browserWindow.webContents.on('crashed', () => {
    console.error('[SpotlightCtr] Spotlight renderer crashed, recreating...');
    spotlight.resetReady();
    spotlight.destroy();
    // Re-retrieve will create a new window
    this.app.browserManager.retrieveByIdentifier(BrowsersIdentifiers.spotlight);
  });
}
```

Note: This should be set up after `initializeBrowsers()` has run. If `initialize()` runs before browsers are created, defer with a listener or move to a post-init hook.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/controllers/SpotlightCtr.ts
git commit -m "feat(desktop): add crash recovery for spotlight renderer"
```

---

## Chunk 4: Store Invalidation & Cross-Window Sync (deferred to future task)

> **Note:** The `store:invalidate` IPC broadcast mechanism and full cross-window state sync is a distinct feature that builds on top of the spotlight shell. It should be implemented when the spotlight chat mode is built out. For now, the spotlight shell (input box + show/hide lifecycle) works independently.
>
> When implementing chat mode in the spotlight:
>
> 1. Add `store:invalidate` event to `electron-client-ipc` types
> 2. Create invalidation handler in `SpotlightCtr` or a shared `StoreInvalidationController`
> 3. Wire SWR `mutate()` on the renderer side to listen for invalidation events
> 4. Implement progressive rendering with dynamic imports for chat components

---

## Summary

| Task | Description                          | Files                               |
| ---- | ------------------------------------ | ----------------------------------- |
| 1    | Window definition + shortcut config  | `appBrowsers.ts`, `config.ts`       |
| 2    | Browser class extensions             | `Browser.ts`                        |
| 3    | BrowserManager extensions            | `BrowserManager.ts`                 |
| 4    | RendererUrlManager spotlight routing | `RendererUrlManager.ts`             |
| 5    | SpotlightController                  | `SpotlightCtr.ts` (new)             |
| 6    | Broadcast event types                | `electron-client-ipc/events/`       |
| 7    | spotlight.html                       | `apps/desktop/spotlight.html` (new) |
| 8    | Vite MPA config                      | `electron.vite.config.ts`           |
| 9    | entry.spotlight.tsx                  | `src/spa/entry.spotlight.tsx` (new) |
| 10   | Spotlight feature module             | `src/features/Spotlight/` (new)     |
| 11   | skipSplash integration               | `appBrowsers.ts`                    |
| 12   | Preload IPC verification             | `entry.spotlight.tsx`               |
| 13   | Manual integration test              | —                                   |
| 14   | Crash recovery                       | `SpotlightCtr.ts`                   |
