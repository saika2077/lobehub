import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const log = debug('task-review');

export interface ReviewCriterion {
  description?: string;
  name: string;
  threshold: number;
  weight?: number;
}

export interface ReviewJudge {
  model?: string;
  prompt?: string;
  provider?: string;
}

export interface ReviewConfig {
  autoRetry: boolean;
  criteria: ReviewCriterion[];
  enabled: boolean;
  judge: ReviewJudge;
  maxIterations: number;
}

export interface ReviewScore {
  criterion: string;
  feedback: string;
  passed: boolean;
  score: number;
  threshold: number;
}

export interface ReviewResult {
  iteration: number;
  overallScore: number;
  passed: boolean;
  scores: ReviewScore[];
  suggestions: string[];
  summary: string;
}

export class TaskReviewService {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async review(params: {
    content: string;
    criteria: ReviewCriterion[];
    iteration?: number;
    judge: ReviewJudge;
    taskName: string;
  }): Promise<ReviewResult> {
    const { content, criteria, judge, taskName, iteration = 1 } = params;

    // 1. Resolve model/provider — use defaults if not specified
    const { model, provider } = await this.resolveModelConfig(judge);

    log(
      'Starting review for task %s (iteration %d, model=%s, provider=%s)',
      taskName,
      iteration,
      model,
      provider,
    );

    // 2. Initialize ModelRuntime
    const modelRuntime = await initModelRuntimeFromDB(this.db, this.userId, provider);

    // 3. Build review prompt
    const reviewPrompt = judge.prompt || this.buildDefaultPrompt({ criteria, taskName });

    // 4. Call LLM for structured review
    const result = await (modelRuntime as any).generateObject({
      messages: [
        { content: reviewPrompt, role: 'system' },
        { content, role: 'user' },
      ],
      model,
      schema: {
        name: 'review_result',
        schema: {
          properties: {
            scores: {
              items: {
                properties: {
                  criterion: { type: 'string' },
                  feedback: { type: 'string' },
                  score: { type: 'number' },
                },
                required: ['criterion', 'score', 'feedback'],
                type: 'object',
              },
              type: 'array',
            },
            suggestions: { items: { type: 'string' }, type: 'array' },
            summary: { type: 'string' },
          },
          required: ['scores', 'summary', 'suggestions'],
          type: 'object',
        },
      },
    });

    // 4. Calculate pass/fail
    const scores: ReviewScore[] = (result.scores || []).map((s: any) => {
      const c = criteria.find((c) => c.name === s.criterion);
      const threshold = c?.threshold ?? 80;
      return {
        criterion: s.criterion,
        feedback: s.feedback,
        passed: s.score >= threshold,
        score: s.score,
        threshold,
      };
    });

    const weights = criteria.map((c) => c.weight ?? 1);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const overallScore =
      totalWeight > 0
        ? scores.reduce((sum, s, i) => sum + s.score * (weights[i] ?? 1), 0) / totalWeight
        : 0;

    const passed = scores.length > 0 && scores.every((s) => s.passed);

    log('Review complete: %s (score: %d, passed: %s)', taskName, Math.round(overallScore), passed);

    return {
      iteration,
      overallScore: Math.round(overallScore),
      passed,
      scores,
      suggestions: result.suggestions || [],
      summary: result.summary || '',
    };
  }

  /**
   * Resolve model/provider config — use user's system agent defaults if not specified
   */
  private async resolveModelConfig(
    judge: ReviewJudge,
  ): Promise<{ model: string; provider: string }> {
    if (judge.model && judge.provider) {
      return { model: judge.model, provider: judge.provider };
    }

    // Fall back to user's system agent config for 'topic' task type
    const userModel = new UserModel(this.db, this.userId);
    const settings = await userModel.getUserSettings();
    const systemAgent = settings?.systemAgent as Record<string, any> | undefined;
    const topicConfig = systemAgent?.topic;
    const defaults = DEFAULT_SYSTEM_AGENT_CONFIG.topic;

    return {
      model: judge.model || topicConfig?.model || defaults.model,
      provider: judge.provider || topicConfig?.provider || defaults.provider,
    };
  }

  private buildDefaultPrompt(params: { criteria: ReviewCriterion[]; taskName: string }): string {
    const criteriaText = params.criteria
      .map(
        (c, i) =>
          `${i + 1}. ${c.name} (通过标准: ≥ ${c.threshold}分)${c.description ? `: ${c.description}` : ''}`,
      )
      .join('\n');

    return `你是一个内容评审专家。请评审以下内容，对每个评审维度打分(0-100)并给出具体反馈。

## 任务: ${params.taskName}

## 评审维度
${criteriaText}

## 输出要求
对每个维度给出: criterion(维度名称), score(分数0-100), feedback(具体反馈)
以及: summary(评审总结), suggestions(改进建议列表)`;
  }
}
