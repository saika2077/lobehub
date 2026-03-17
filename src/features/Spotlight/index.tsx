import { memo, useCallback, useState } from 'react';

import InputBox from './InputBox';
import { useStyles } from './style';

const SpotlightWindow = memo(() => {
  const { styles } = useStyles();
  const [inputValue, setInputValue] = useState('');

  const handleHide = useCallback(() => {
    window.electronAPI?.invoke?.('spotlight:hide');
  }, []);

  const handleSubmit = useCallback(
    (value: string) => {
      if (value.startsWith('>')) {
        // Command mode — TODO: implement
        console.info('Command:', value.slice(1).trim());
        handleHide();
      } else if (value.startsWith('@')) {
        // Search mode — TODO: implement
        console.info('Search:', value.slice(1).trim());
      } else {
        // Chat mode — TODO: implement
        console.info('Chat:', value);
      }
    },
    [handleHide],
  );

  return (
    <div className={styles.container}>
      <InputBox
        value={inputValue}
        onChange={setInputValue}
        onEscape={handleHide}
        onSubmit={handleSubmit}
      />
    </div>
  );
});

SpotlightWindow.displayName = 'SpotlightWindow';

export default SpotlightWindow;
