import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { NewTask, TaskItem } from '../schemas/task';
import { taskDependencies, taskDocuments, tasks } from '../schemas/task';
import type { LobeChatDatabase } from '../type';

export class TaskModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  // ========== CRUD ==========

  async create(
    data: Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'> & {
      identifierPrefix?: string;
    },
  ): Promise<TaskItem> {
    const { identifierPrefix = 'TASK', ...rest } = data;

    // Get next seq for this user
    const seqResult = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
      .from(tasks)
      .where(eq(tasks.createdByUserId, this.userId));

    const nextSeq = Number(seqResult[0].maxSeq) + 1;
    const identifier = `${identifierPrefix}-${nextSeq}`;

    const result = await this.db
      .insert(tasks)
      .values({
        ...rest,
        createdByUserId: this.userId,
        identifier,
        seq: nextSeq,
      } as NewTask)
      .returning();

    return result[0];
  }

  async findById(id: string): Promise<TaskItem | null> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.createdByUserId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  // Resolve id or identifier (e.g. 'TASK-1') to a task
  async resolve(idOrIdentifier: string): Promise<TaskItem | null> {
    if (idOrIdentifier.startsWith('task_')) return this.findById(idOrIdentifier);
    return this.findByIdentifier(idOrIdentifier.toUpperCase());
  }

  async findByIdentifier(identifier: string): Promise<TaskItem | null> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.identifier, identifier), eq(tasks.createdByUserId, this.userId)))
      .limit(1);

    return result[0] || null;
  }

  async update(
    id: string,
    data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
  ): Promise<TaskItem | null> {
    const result = await this.db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.createdByUserId, this.userId)))
      .returning();

    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.createdByUserId, this.userId)))
      .returning();

    return result.length > 0;
  }

  // ========== Query ==========

  async list(options?: {
    assigneeAgentId?: string;
    limit?: number;
    offset?: number;
    parentTaskId?: string | null;
    status?: string;
  }): Promise<{ tasks: TaskItem[]; total: number }> {
    const { status, parentTaskId, assigneeAgentId, limit = 50, offset = 0 } = options || {};

    const conditions = [eq(tasks.createdByUserId, this.userId)];

    if (status) conditions.push(eq(tasks.status, status));
    if (assigneeAgentId) conditions.push(eq(tasks.assigneeAgentId, assigneeAgentId));

    if (parentTaskId === null) {
      conditions.push(sql`${tasks.parentTaskId} IS NULL`);
    } else if (parentTaskId) {
      conditions.push(eq(tasks.parentTaskId, parentTaskId));
    }

    const where = and(...conditions);

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(where);

    const taskList = await this.db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.createdAt))
      .limit(limit)
      .offset(offset);

    return { tasks: taskList, total: Number(countResult[0].count) };
  }

  async findSubtasks(parentTaskId: string): Promise<TaskItem[]> {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, parentTaskId), eq(tasks.createdByUserId, this.userId)))
      .orderBy(tasks.seq);
  }

  // Recursive query to get full task tree
  async getTaskTree(rootTaskId: string): Promise<TaskItem[]> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT * FROM tasks WHERE id = ${rootTaskId} AND created_by_user_id = ${this.userId}
        UNION ALL
        SELECT t.* FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT * FROM task_tree
    `);

    return result.rows as TaskItem[];
  }

  // ========== Status ==========

  async updateStatus(
    id: string,
    status: string,
    extra?: { completedAt?: Date; error?: string; startedAt?: Date },
  ): Promise<TaskItem | null> {
    return this.update(id, { status, ...extra });
  }

  async batchUpdateStatus(ids: string[], status: string): Promise<number> {
    const result = await this.db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(inArray(tasks.id, ids), eq(tasks.createdByUserId, this.userId)))
      .returning();

    return result.length;
  }

  // ========== Heartbeat ==========

  async updateHeartbeat(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  // Find stuck tasks (running but heartbeat timed out)
  static async findStuckTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'running'),
          sql`${tasks.lastHeartbeatAt} < now() - (${tasks.heartbeatTimeout} || ' seconds')::interval`,
        ),
      );
  }

  // ========== Dependencies ==========

  async addDependency(taskId: string, dependsOnId: string, type: string = 'blocks'): Promise<void> {
    await this.db
      .insert(taskDependencies)
      .values({ dependsOnId, taskId, type })
      .onConflictDoNothing();
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    await this.db
      .delete(taskDependencies)
      .where(
        and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnId, dependsOnId)),
      );
  }

  async getDependencies(taskId: string) {
    return this.db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  }

  async getDependents(taskId: string) {
    return this.db.select().from(taskDependencies).where(eq(taskDependencies.dependsOnId, taskId));
  }

  // Check if all dependencies of a task are completed
  async areAllDependenciesCompleted(taskId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*) as pending_count
      FROM task_dependencies d
      JOIN tasks t ON d.depends_on_id = t.id
      WHERE d.task_id = ${taskId}
        AND d.type = 'blocks'
        AND t.status != 'completed'
    `);

    return Number((result.rows[0] as any).pending_count) === 0;
  }

  // ========== Documents (MVP Workspace) ==========

  async pinDocument(taskId: string, documentId: string, pinnedBy: string = 'agent'): Promise<void> {
    await this.db
      .insert(taskDocuments)
      .values({ documentId, pinnedBy, taskId })
      .onConflictDoNothing();
  }

  async unpinDocument(taskId: string, documentId: string): Promise<void> {
    await this.db
      .delete(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.documentId, documentId)));
  }

  async getPinnedDocuments(taskId: string) {
    return this.db
      .select()
      .from(taskDocuments)
      .where(eq(taskDocuments.taskId, taskId))
      .orderBy(taskDocuments.createdAt);
  }

  // Get all pinned docs from a task tree (recursive)
  async getTreePinnedDocuments(rootTaskId: string) {
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT id FROM tasks WHERE id = ${rootTaskId}
        UNION ALL
        SELECT t.id FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT td.*, tt.id as source_task_id
      FROM task_documents td
      JOIN task_tree tt ON td.task_id = tt.id
      ORDER BY td.created_at
    `);

    return result.rows;
  }

  // ========== Topic Management ==========

  async incrementTopicCount(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        totalTopics: sql`${tasks.totalTopics} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));
  }

  async updateCurrentTopic(id: string, topicId: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ currentTopicId: topicId, updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }
}
