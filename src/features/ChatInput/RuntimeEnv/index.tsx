import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Popover, Skeleton, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  ChevronDownIcon,
  CloudIcon,
  LaptopIcon,
  LaptopMinimalCheckIcon,
  SquircleDashed,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useUpdateAgentConfig } from '../hooks/useUpdateAgentConfig';
import WorkingDirectoryContent from './WorkingDirectoryContent';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  bar: css`
    padding-block: 0;
    padding-inline: 4px;
  `,
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  cloudDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  modeOption: css`
    cursor: pointer;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  modeOptionActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  modeOptionDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  modeOptionIcon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  modeOptionTitle: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

const RuntimeEnv = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tPlugin } = useTranslation('plugin');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [dirPopoverOpen, setDirPopoverOpen] = useState(false);

  const [isLoading, isEnabled] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s),
  ]);

  // Get working directory
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s) : undefined,
  );
  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory;

  // Only show on desktop
  if (!isDesktop) return null;

  // Skeleton placeholder to prevent layout jump during loading
  if (!agentId || isLoading) {
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 64, width: 64 }} />
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 100, width: 100 }} />
      </Flexbox>
    );
  }

  const isLocal = isEnabled;

  const displayName = effectiveWorkingDirectory
    ? effectiveWorkingDirectory.split('/').findLast(Boolean) || effectiveWorkingDirectory
    : tPlugin('localSystem.workingDirectory.notSet');

  const modeContent = (
    <Flexbox gap={4} style={{ minWidth: 280 }}>
      {/* Local mode option */}
      <Flexbox
        horizontal
        align={'flex-start'}
        className={cx(styles.modeOption, isLocal && styles.modeOptionActive)}
        gap={12}
        onClick={async () => {
          if (!isLocal) {
            await updateAgentChatConfig({ localSystem: { enabled: true } });
          }
        }}
      >
        <Flexbox
          align={'center'}
          className={styles.modeOptionIcon}
          flex={'none'}
          height={32}
          justify={'center'}
          width={32}
        >
          <Icon icon={LaptopMinimalCheckIcon} />
        </Flexbox>
        <Flexbox flex={1}>
          <div className={styles.modeOptionTitle}>{t('runtimeEnv.mode.local')}</div>
          <div className={styles.modeOptionDesc}>{t('runtimeEnv.mode.localDesc')}</div>
        </Flexbox>
      </Flexbox>
      {/* Cloud mode option */}
      <Flexbox
        horizontal
        align={'flex-start'}
        className={cx(styles.modeOption, !isLocal && styles.modeOptionActive)}
        gap={12}
        onClick={async () => {
          if (isLocal) {
            await updateAgentChatConfig({ localSystem: { enabled: false } });
          }
        }}
      >
        <Flexbox
          align={'center'}
          className={styles.modeOptionIcon}
          flex={'none'}
          height={32}
          justify={'center'}
          width={32}
        >
          <Icon icon={CloudIcon} />
        </Flexbox>
        <Flexbox flex={1}>
          <div className={styles.modeOptionTitle}>{t('runtimeEnv.mode.cloud')}</div>
          <div className={styles.modeOptionDesc}>{t('runtimeEnv.mode.cloudDesc')}</div>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      {/* Left: Mode selector */}
      <Popover
        content={modeContent}
        placement="top"
        styles={{ content: { padding: 4 } }}
        trigger="click"
      >
        <div className={styles.button}>
          <Icon icon={isLocal ? LaptopIcon : CloudIcon} size={14} />
          <span>{isLocal ? t('runtimeEnv.mode.local') : t('runtimeEnv.mode.cloud')}</span>
          <Icon icon={ChevronDownIcon} size={12} />
        </div>
      </Popover>

      {/* Right: Working directory (local mode) or cloud description (cloud mode) */}
      {isLocal ? (
        <Popover
          open={dirPopoverOpen}
          placement="topRight"
          trigger="click"
          content={
            <WorkingDirectoryContent agentId={agentId} onClose={() => setDirPopoverOpen(false)} />
          }
          onOpenChange={setDirPopoverOpen}
        >
          <div>
            {dirPopoverOpen ? (
              <div className={styles.button}>
                <Icon icon={effectiveWorkingDirectory ? LaptopIcon : SquircleDashed} size={14} />
                <span>{displayName}</span>
                <Icon icon={ChevronDownIcon} size={12} />
              </div>
            ) : (
              <Tooltip
                title={effectiveWorkingDirectory || tPlugin('localSystem.workingDirectory.notSet')}
              >
                <div className={styles.button}>
                  <Icon icon={effectiveWorkingDirectory ? LaptopIcon : SquircleDashed} size={14} />
                  <span>{displayName}</span>
                  <Icon icon={ChevronDownIcon} size={12} />
                </div>
              </Tooltip>
            )}
          </div>
        </Popover>
      ) : (
        <span className={styles.cloudDesc}>{t('runtimeEnv.mode.cloudDesc')}</span>
      )}
    </Flexbox>
  );
});

RuntimeEnv.displayName = 'RuntimeEnv';

export default RuntimeEnv;
