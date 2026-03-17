import '../initialize';

import { StyleProvider } from 'antd-style';
import { memo, type PropsWithChildren, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import SpotlightWindow from '@/features/Spotlight';
import AppTheme from '@/layout/GlobalProvider/AppTheme';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import QueryProvider from '@/layout/GlobalProvider/Query';
import Locale from '@/layout/SPAGlobalProvider/Locale';

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
    window.electronAPI?.invoke?.('spotlight:ready');
  }, []);

  return (
    <SpotlightProvider>
      <SpotlightWindow />
    </SpotlightProvider>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
