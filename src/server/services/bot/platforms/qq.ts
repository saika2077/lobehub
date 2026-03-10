import debug from 'debug';

import type { PlatformBot } from '../types';

const log = debug('lobe-server:bot:gateway:qq');

export interface QQBotConfig {
  [key: string]: string | undefined;
  appId: string;
  appSecret: string;
}

export class QQ implements PlatformBot {
  readonly platform = 'qq';
  readonly applicationId: string;

  private config: QQBotConfig;

  constructor(config: QQBotConfig) {
    this.config = config;
    this.applicationId = config.appId;
  }

  async start(): Promise<void> {
    log('Starting QQBot appId=%s', this.applicationId);
    // QQ webhook is configured manually in the QQ Open Platform
    // No need to set webhook programmatically
    log(
      'QQBot appId=%s started (webhook must be configured in QQ Open Platform)',
      this.applicationId,
    );
  }

  async stop(): Promise<void> {
    log('Stopping QQBot appId=%s', this.applicationId);
    // No cleanup needed for QQ
  }
}
