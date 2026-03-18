import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TaskModel } from '@/database/models/task';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

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
        return { data: task, message: `Task ${status}`, success: true };
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
