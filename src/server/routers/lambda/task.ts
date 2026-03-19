import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AiAgentService } from '@/server/services/aiAgent';

const taskProcedure = authedProcedure.use(serverDatabase);

// All procedures that take an id accept either raw id (task_xxx) or identifier (TASK-1)
// Resolution happens in the model layer via model.resolve()
const idInput = z.object({ id: z.string() });

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
const createSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  description: z.string().optional(),
  identifierPrefix: z.string().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
});

const updateSchema = z.object({
  assigneeAgentId: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  heartbeatInterval: z.number().min(1).optional(),
  heartbeatTimeout: z.number().min(1).nullable().optional(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
});

const listSchema = z.object({
  assigneeAgentId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  parentTaskId: z.string().nullable().optional(),
  status: z.string().optional(),
});

// Helper: build task prompt with handoff context from previous topics
async function buildTaskPrompt(
  task: Awaited<ReturnType<TaskModel['findById']>> & {},
  db: any,
  userId: string,
  extraPrompt?: string,
): Promise<string> {
  // Task header
  let prompt = task.description
    ? `## Task: ${task.name || task.identifier}\n\n${task.description}\n\n## Instruction\n\n${task.instruction}`
    : task.instruction;

  // Inject handoff from previous topics (query by metadata.taskId)
  if (task.totalTopics && task.totalTopics > 0) {
    try {
      const { sql: rawSql } = await import('drizzle-orm');
      const { topics } = await import('@/database/schemas');
      const { and, eq, desc } = await import('drizzle-orm');

      const prevTopics = await db
        .select({ metadata: topics.metadata, title: topics.title })
        .from(topics)
        .where(
          and(
            eq(topics.userId, userId),
            eq(topics.trigger, 'task'),
            rawSql`${topics.metadata}->>'taskId' = ${task.id}`,
          ),
        )
        .orderBy(desc(topics.createdAt))
        .limit(4);

      const handoffs = prevTopics
        .filter((t: any) => t.metadata?.handoff)
        .map((t: any, i: number) =>
          i === 0
            ? `### Previous Topic: ${t.title}\n${JSON.stringify(t.metadata.handoff, null, 2)}`
            : `- ${t.title}: ${t.metadata.handoff.summary || ''}`,
        );

      if (handoffs.length > 0) {
        prompt += `\n\n## Previous Context\n\n${handoffs.join('\n\n')}`;
      }
    } catch {
      // If topic query fails, continue without handoff
    }
  }

  if (extraPrompt) {
    prompt += `\n\n## Additional Context\n\n${extraPrompt}`;
  }

  return prompt;
}

// Helper: resolve id/identifier and throw if not found
async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

export const taskRouter = router({
  addDependency: taskProcedure
    .input(
      z.object({
        dependsOnId: z.string(),
        taskId: z.string(),
        type: z.enum(['blocks', 'relates']).default('blocks'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.addDependency(task.id, dep.id, input.type);
        return { message: 'Dependency added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add dependency',
        });
      }
    }),

  create: taskProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);

      // Resolve parentTaskId if it's an identifier
      const createData = { ...input };
      if (createData.parentTaskId) {
        const parent = await resolveOrThrow(model, createData.parentTaskId);
        createData.parentTaskId = parent.id;
      }

      const task = await model.create(createData);
      return { data: task, message: 'Task created', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:create]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create task',
      });
    }
  }),

  delete: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      await model.delete(task.id);
      return { message: 'Task deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete task',
      });
    }
  }),

  find: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      return { data: task, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find task',
      });
    }
  }),

  getDependencies: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      const deps = await model.getDependencies(task.id);
      return { data: deps, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getDependencies]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get dependencies',
      });
    }
  }),

  getPinnedDocuments: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      const docs = await model.getPinnedDocuments(task.id);
      return { data: docs, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getPinnedDocuments]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get documents',
      });
    }
  }),

  getSubtasks: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      const subtasks = await model.findSubtasks(task.id);
      return { data: subtasks, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getSubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get subtasks',
      });
    }
  }),

  getTaskTree: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      const tree = await model.getTaskTree(task.id);
      return { data: tree, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTaskTree]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task tree',
      });
    }
  }),

  heartbeat: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      await model.updateHeartbeat(task.id);
      return { message: 'Heartbeat updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:heartbeat]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update heartbeat',
      });
    }
  }),

  watchdog: taskProcedure.mutation(async ({ ctx }) => {
    try {
      const stuckTasks = await TaskModel.findStuckTasks(ctx.serverDB);
      const failed: string[] = [];

      for (const task of stuckTasks) {
        const model = new TaskModel(ctx.serverDB, task.createdByUserId);
        await model.updateStatus(task.id, 'failed', {
          completedAt: new Date(),
          error: 'Heartbeat timeout',
        });

        // Create error brief
        const briefModel = new BriefModel(ctx.serverDB, task.createdByUserId);
        await briefModel.create({
          agentId: task.assigneeAgentId || undefined,
          priority: 'urgent',
          summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
          taskId: task.id,
          title: `${task.identifier} heartbeat timeout`,
          type: 'error',
        });

        failed.push(task.identifier);
      }

      return {
        checked: stuckTasks.length,
        failed,
        message:
          failed.length > 0
            ? `${failed.length} stuck tasks marked as failed`
            : 'No stuck tasks found',
        success: true,
      };
    } catch (error) {
      console.error('[task:watchdog]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Watchdog check failed',
      });
    }
  }),

  list: taskProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const result = await model.list(input);
      return { data: result.tasks, success: true, total: result.total };
    } catch (error) {
      console.error('[task:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list tasks',
      });
    }
  }),

  run: taskProcedure
    .input(
      idInput.merge(
        z.object({
          prompt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, prompt: extraPrompt } = input;
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const task = await resolveOrThrow(model, id);

        // Ensure task has an assigned agent
        if (!task.assigneeAgentId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Task has no assigned agent. Use --agent when creating or edit the task.',
          });
        }

        // Build prompt with handoff context from previous topics
        const prompt = await buildTaskPrompt(task, ctx.serverDB, ctx.userId, extraPrompt);

        // Update task status to running if not already
        if (task.status === 'backlog' || task.status === 'paused') {
          await model.updateStatus(task.id, 'running', { startedAt: new Date() });
        }

        // Call AiAgentService.execAgent
        // assigneeAgentId can be either a raw agentId (agt_xxx) or a slug (inbox)
        const agentRef = task.assigneeAgentId!;
        const isSlug = !agentRef.startsWith('agt_');

        const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
        const result = await aiAgentService.execAgent({
          ...(isSlug ? { slug: agentRef } : { agentId: agentRef }),
          prompt,
          taskId: task.id,
          title: task.name || task.identifier,
          trigger: 'task',
          userInterventionConfig: { approvalMode: 'headless' },
        });

        // Update task topic count and current topic
        if (result.topicId) {
          await model.incrementTopicCount(task.id);
          await model.updateCurrentTopic(task.id, result.topicId);
        }

        // Update heartbeat
        await model.updateHeartbeat(task.id);

        return {
          ...result,
          taskId: task.id,
          taskIdentifier: task.identifier,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:run]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run task',
        });
      }
    }),

  pinDocument: taskProcedure
    .input(
      z.object({
        documentId: z.string(),
        pinnedBy: z.string().default('user'),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const task = await resolveOrThrow(model, input.taskId);
        await model.pinDocument(task.id, input.documentId, input.pinnedBy);
        return { message: 'Document pinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:pinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to pin document',
        });
      }
    }),

  removeDependency: taskProcedure
    .input(z.object({ dependsOnId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.removeDependency(task.id, dep.id);
        return { message: 'Dependency removed', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:removeDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove dependency',
        });
      }
    }),

  unpinDocument: taskProcedure
    .input(z.object({ documentId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const task = await resolveOrThrow(model, input.taskId);
        await model.unpinDocument(task.id, input.documentId);
        return { message: 'Document unpinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:unpinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to unpin document',
        });
      }
    }),

  getCheckpoint: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const task = await resolveOrThrow(model, input.id);
      const checkpoint = model.getCheckpointConfig(task);
      return { data: checkpoint, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getCheckpoint]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get checkpoint',
      });
    }
  }),

  updateCheckpoint: taskProcedure
    .input(
      idInput.merge(
        z.object({
          checkpoint: z.object({
            onAgentRequest: z.boolean().optional(),
            tasks: z
              .object({
                afterIds: z.array(z.string()).optional(),
                beforeIds: z.array(z.string()).optional(),
              })
              .optional(),
            topic: z
              .object({
                after: z.boolean().optional(),
                before: z.boolean().optional(),
              })
              .optional(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, checkpoint } = input;
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateCheckpointConfig(resolved.id, checkpoint);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getCheckpointConfig(task),
          message: 'Checkpoint updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateCheckpoint]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update checkpoint',
        });
      }
    }),

  update: taskProcedure.input(idInput.merge(updateSchema)).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    try {
      const model = new TaskModel(ctx.serverDB, ctx.userId);
      const resolved = await resolveOrThrow(model, id);
      const task = await model.update(resolved.id, data);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      return { data: task, message: 'Task updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:update]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update task',
      });
    }
  }),

  updateStatus: taskProcedure
    .input(
      z.object({
        error: z.string().optional(),
        id: z.string(),
        status: z.enum(['backlog', 'running', 'paused', 'completed', 'failed', 'canceled']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, status, error: errorMsg } = input;
      try {
        const model = new TaskModel(ctx.serverDB, ctx.userId);
        const resolved = await resolveOrThrow(model, id);

        const extra: Record<string, unknown> = {};
        if (status === 'running') extra.startedAt = new Date();
        if (status === 'completed' || status === 'failed' || status === 'canceled')
          extra.completedAt = new Date();
        if (errorMsg) extra.error = errorMsg;

        const task = await model.updateStatus(resolved.id, status, extra);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

        // On completion: check dependency unlocking + parent notification + checkpoints
        const unlocked: string[] = [];
        const paused: string[] = [];
        let allSubtasksDone = false;
        let checkpointTriggered = false;

        if (status === 'completed') {
          // 1. Check afterIds checkpoint on parent
          if (task.parentTaskId) {
            const parentTask = await model.findById(task.parentTaskId);
            if (parentTask && model.shouldPauseAfterComplete(parentTask, task.identifier)) {
              // Pause the parent task for review
              await model.updateStatus(parentTask.id, 'paused');
              checkpointTriggered = true;
            }

            // 2. Check if all sibling subtasks are done
            allSubtasksDone = await model.areAllSubtasksCompleted(task.parentTaskId);
          }

          // 3. Unlock tasks blocked by this one
          const unlockedTasks = await model.getUnlockedTasks(task.id);
          for (const ut of unlockedTasks) {
            // Check beforeIds checkpoint on parent before starting
            let shouldPause = false;
            if (ut.parentTaskId) {
              const parentTask = await model.findById(ut.parentTaskId);
              if (parentTask && model.shouldPauseBeforeStart(parentTask, ut.identifier)) {
                shouldPause = true;
              }
            }

            if (shouldPause) {
              await model.updateStatus(ut.id, 'paused');
              paused.push(ut.identifier);
            } else {
              await model.updateStatus(ut.id, 'running', { startedAt: new Date() });
              unlocked.push(ut.identifier);
            }
          }
        }

        return {
          data: task,
          message: `Task ${status}`,
          success: true,
          ...(unlocked.length > 0 && { unlocked }),
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId: task.parentTaskId }),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update status',
        });
      }
    }),
});
