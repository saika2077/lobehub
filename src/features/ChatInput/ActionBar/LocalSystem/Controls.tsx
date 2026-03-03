import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { LaptopMinimalCheckIcon, PowerOff } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  icon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  option: css`
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
  title: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface ToggleOption {
  description: string;
  icon: LucideIcon;
  label: string;
  value: boolean;
}

const ToggleItem = memo<ToggleOption>(({ value, description, icon, label }) => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const isEnabled = useAgentStore((s) =>
    chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s),
  );
  const isActive = value === isEnabled;

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      className={cx(styles.option, isActive && styles.active)}
      gap={12}
      onClick={async () => {
        if (value !== isEnabled) {
          await updateAgentChatConfig({ localSystem: { enabled: value } });
        }
      }}
    >
      <Center className={styles.icon} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1}>
        <div className={styles.title}>{label}</div>
        <div className={styles.description}>{description}</div>
      </Flexbox>
    </Flexbox>
  );
});

const Controls = memo(() => {
  const { t } = useTranslation('chat');

  const toggleOptions: ToggleOption[] = [
    {
      description: t('localSystem.off.desc'),
      icon: PowerOff,
      label: t('localSystem.off.title'),
      value: false,
    },
    {
      description: t('localSystem.on.desc'),
      icon: LaptopMinimalCheckIcon,
      label: t('localSystem.on.title'),
      value: true,
    },
  ];

  return (
    <Flexbox gap={4}>
      {toggleOptions.map((option) => (
        <ToggleItem {...option} key={String(option.value)} />
      ))}
    </Flexbox>
  );
});

export default Controls;
