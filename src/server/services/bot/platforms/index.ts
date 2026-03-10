import type { PlatformBotClass } from '../types';
import { Discord } from './discord';
import { Lark } from './lark';
import { QQ } from './qq';
import { Telegram } from './telegram';

export const platformBotRegistry: Record<string, PlatformBotClass> = {
  discord: Discord,
  feishu: Lark,
  lark: Lark,
  qq: QQ,
  telegram: Telegram,
};
