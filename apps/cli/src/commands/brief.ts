import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerBriefCommand(program: Command) {
  const brief = program.command('brief').description('Manage briefs (Agent reports)');

  // ── list ──────────────────────────────────────────────

  brief
    .command('list')
    .description('List briefs')
    .option('--unresolved', 'Only show unresolved briefs (default)')
    .option('--all', 'Show all briefs')
    .option('--type <type>', 'Filter by type (decision/result/insight/error)')
    .option('-L, --limit <n>', 'Page size', '50')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        all?: boolean;
        json?: string | boolean;
        limit?: string;
        type?: string;
        unresolved?: boolean;
      }) => {
        const client = await getTrpcClient();

        let items: any[];

        if (options.all) {
          const input: Record<string, any> = {};
          if (options.type) input.type = options.type;
          if (options.limit) input.limit = Number.parseInt(options.limit, 10);
          const result = await client.brief.list.query(input as any);
          items = result.data;
        } else {
          const result = await client.brief.listUnresolved.query();
          items = result.data;
        }

        if (options.json !== undefined) {
          outputJson(items, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        if (!items || items.length === 0) {
          log.info('No briefs found.');
          return;
        }

        const rows = items.map((b: any) => [
          typeBadge(b.type, b.priority),
          truncate(b.title, 40),
          truncate(b.summary, 50),
          b.taskId ? pc.dim(b.taskId) : b.cronJobId ? pc.dim(b.cronJobId) : '-',
          b.resolvedAt ? pc.green('resolved') : b.readAt ? pc.dim('read') : 'new',
          timeAgo(b.createdAt),
        ]);

        printTable(rows, ['TYPE', 'TITLE', 'SUMMARY', 'SOURCE', 'STATUS', 'CREATED']);
      },
    );

  // ── view ──────────────────────────────────────────────

  brief
    .command('view <id>')
    .description('View brief details')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.brief.find.query({ id });

      if (options.json !== undefined) {
        outputJson(result.data, typeof options.json === 'string' ? options.json : undefined);
        return;
      }

      const b = result.data;
      console.log(`\n${typeBadge(b.type, b.priority)} ${pc.bold(b.title)}`);
      console.log(`${b.summary}`);
      if (b.agentId) console.log(`${pc.dim('Agent:')} ${b.agentId}`);
      if (b.taskId) console.log(`${pc.dim('Task:')} ${b.taskId}`);
      if (b.cronJobId) console.log(`${pc.dim('CronJob:')} ${b.cronJobId}`);
      if (b.topicId) console.log(`${pc.dim('Topic:')} ${b.topicId}`);
      if (b.commentType) console.log(`${pc.dim('Comment:')} ${b.commentType}`);

      if (b.artifacts && (b.artifacts as string[]).length > 0) {
        console.log(`${pc.dim('Artifacts:')}`);
        for (const a of b.artifacts as string[]) {
          console.log(`  📎 ${a}`);
        }
      }

      if (b.actions && (b.actions as any[]).length > 0) {
        console.log(`${pc.dim('Actions:')}`);
        for (const a of b.actions as any[]) {
          console.log(`  [${a.label}] (${a.type})`);
        }
      }

      const status = b.resolvedAt
        ? pc.green('✓ resolved')
        : b.readAt
          ? pc.dim('read')
          : pc.yellow('new');
      console.log(`${pc.dim('Status:')} ${status}  ${pc.dim('Created:')} ${timeAgo(b.createdAt)}`);
      console.log();
    });

  // ── resolve ──────────────────────────────────────────────

  brief
    .command('resolve <id>')
    .description('Mark brief as resolved')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.brief.resolve.mutate({ id });
      log.info(`Brief ${pc.dim(id)} resolved.`);
    });

  // ── read ──────────────────────────────────────────────

  brief
    .command('read <id>')
    .description('Mark brief as read')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.brief.markRead.mutate({ id });
      log.info(`Brief ${pc.dim(id)} marked as read.`);
    });
}

function typeBadge(type: string, priority?: string): string {
  if (priority === 'urgent') {
    return pc.red('🔴');
  }

  switch (type) {
    case 'decision': {
      return pc.yellow('🟡');
    }
    case 'result': {
      return pc.green('✅');
    }
    case 'insight': {
      return '💬';
    }
    case 'error': {
      return pc.red('❌');
    }
    default: {
      return '·';
    }
  }
}
