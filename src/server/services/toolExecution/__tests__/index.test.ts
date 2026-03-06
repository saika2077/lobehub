import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolExecutionService } from '../index';
import { type ToolExecutionContext } from '../types';

// Use vi.hoisted for variables referenced inside vi.mock factories
const { mockCallCloudMcpEndpoint } = vi.hoisted(() => ({
  mockCallCloudMcpEndpoint: vi.fn(),
}));

vi.mock('@lobechat/utils', () => ({
  safeParseJSON: vi.fn((str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }),
}));

vi.mock('@/server/services/mcp/contentProcessor', () => ({
  contentBlocksToString: vi.fn((blocks: any[]) => {
    if (!blocks || blocks.length === 0) return '';
    return blocks.map((b: any) => b.text || '').join('\n\n');
  }),
}));

vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn().mockImplementation(() => ({
    callCloudMcpEndpoint: mockCallCloudMcpEndpoint,
  })),
}));

vi.mock('@/server/utils/truncateToolResult', () => ({
  DEFAULT_TOOL_RESULT_MAX_LENGTH: 25_000,
  truncateToolResult: vi.fn((content: string, maxLength?: number) => {
    const limit = maxLength ?? 25_000;
    if (!content || content.length <= limit) return content;
    const truncated = content.slice(0, limit);
    return truncated + `\n\n[Content truncated]`;
  }),
}));

const makeContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  toolManifestMap: {},
  ...overrides,
});

describe('ToolExecutionService', () => {
  let builtinToolsExecutor: any;
  let mcpService: any;
  let pluginGatewayService: any;
  let service: ToolExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();

    builtinToolsExecutor = { execute: vi.fn() };
    mcpService = { callTool: vi.fn() };
    pluginGatewayService = { execute: vi.fn() };

    service = new ToolExecutionService({
      builtinToolsExecutor,
      mcpService,
      pluginGatewayService,
    });
  });

  describe('executeTool', () => {
    describe('builtin type', () => {
      it('should route to builtinToolsExecutor and return result', async () => {
        const payload = {
          identifier: 'lobe-calculator',
          apiName: 'calculate',
          arguments: '{"expression":"1+1"}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockResolvedValue({ content: '2', success: true });

        const result = await service.executeTool(payload, makeContext());

        expect(builtinToolsExecutor.execute).toHaveBeenCalledWith(payload, expect.any(Object));
        expect(result.content).toBe('2');
        expect(result.success).toBe(true);
        expect(typeof result.executionTime).toBe('number');
        expect(result.executionTime).toBeGreaterThanOrEqual(0);
      });

      it('should preserve extra fields (e.g. state) from executor result', async () => {
        const payload = {
          identifier: 'lobe-tool',
          apiName: 'run',
          arguments: '{}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockResolvedValue({
          content: 'result',
          success: true,
          state: { key: 'value' },
        });

        const result = await service.executeTool(payload, makeContext());

        expect(result.state).toEqual({ key: 'value' });
      });

      it('should return error response when builtinToolsExecutor throws', async () => {
        const payload = {
          identifier: 'lobe-tool',
          apiName: 'run',
          arguments: '{}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockRejectedValue(new Error('Tool not found'));

        const result = await service.executeTool(payload, makeContext());

        expect(result.success).toBe(false);
        expect(result.content).toContain('Tool not found');
        expect(result.error).toBeDefined();
        expect(typeof result.executionTime).toBe('number');
      });
    });

    describe('plugin gateway (non-builtin, non-mcp) type', () => {
      it('should route to pluginGatewayService for default type', async () => {
        const payload = {
          identifier: 'custom-plugin',
          apiName: 'fetch',
          arguments: '{}',
          type: 'default',
        } as any;

        pluginGatewayService.execute.mockResolvedValue({ content: 'plugin result', success: true });

        const result = await service.executeTool(payload, makeContext());

        expect(pluginGatewayService.execute).toHaveBeenCalledWith(payload, expect.any(Object));
        expect(result.content).toBe('plugin result');
        expect(result.success).toBe(true);
      });

      it('should route standalone type to pluginGatewayService', async () => {
        const payload = {
          identifier: 'standalone-plugin',
          apiName: 'action',
          arguments: '{}',
          type: 'standalone',
        } as any;

        pluginGatewayService.execute.mockResolvedValue({ content: 'standalone', success: true });

        const result = await service.executeTool(payload, makeContext());

        expect(pluginGatewayService.execute).toHaveBeenCalled();
        expect(result.content).toBe('standalone');
      });

      it('should not call builtin or mcp executors for default type', async () => {
        const payload = {
          identifier: 'custom-plugin',
          apiName: 'run',
          arguments: '{}',
          type: 'default',
        } as any;

        pluginGatewayService.execute.mockResolvedValue({ content: 'ok', success: true });

        await service.executeTool(payload, makeContext());

        expect(builtinToolsExecutor.execute).not.toHaveBeenCalled();
        expect(mcpService.callTool).not.toHaveBeenCalled();
      });

      it('should return error response when pluginGatewayService throws', async () => {
        const payload = {
          identifier: 'failing-plugin',
          apiName: 'run',
          arguments: '{}',
          type: 'default',
        } as any;

        pluginGatewayService.execute.mockRejectedValue(new Error('Gateway error'));

        const result = await service.executeTool(payload, makeContext());

        expect(result.success).toBe(false);
        expect(result.content).toContain('Gateway error');
        expect(typeof result.executionTime).toBe('number');
      });
    });

    describe('mcp type', () => {
      it('should return MANIFEST_NOT_FOUND error when manifest is missing', async () => {
        const payload = {
          identifier: 'missing-mcp',
          apiName: 'tool',
          arguments: '{}',
          type: 'mcp',
        } as any;

        const result = await service.executeTool(payload, makeContext({ toolManifestMap: {} }));

        expect(result.success).toBe(false);
        expect(result.content).toContain('Manifest not found for tool: missing-mcp');
        expect(result.error?.code).toBe('MANIFEST_NOT_FOUND');
      });

      it('should return MCP_CONFIG_NOT_FOUND error when manifest has no mcpParams', async () => {
        const payload = {
          identifier: 'no-config-mcp',
          apiName: 'tool',
          arguments: '{}',
          type: 'mcp',
        } as any;

        const context = makeContext({
          toolManifestMap: {
            'no-config-mcp': { identifier: 'no-config-mcp' } as any,
          },
        });

        const result = await service.executeTool(payload, context);

        expect(result.success).toBe(false);
        expect(result.content).toContain('MCP configuration not found for tool: no-config-mcp');
        expect(result.error?.code).toBe('MCP_CONFIG_NOT_FOUND');
      });

      it('should call mcpService.callTool for stdio MCP type with string result', async () => {
        const payload = {
          identifier: 'stdio-mcp',
          apiName: 'my_tool',
          arguments: '{"key":"value"}',
          type: 'mcp',
        } as any;

        const mcpParams = { type: 'stdio', command: 'my-server' };
        const context = makeContext({
          toolManifestMap: {
            'stdio-mcp': { identifier: 'stdio-mcp', mcpParams } as any,
          },
        });

        mcpService.callTool.mockResolvedValue('tool output string');

        const result = await service.executeTool(payload, context);

        expect(mcpService.callTool).toHaveBeenCalledWith({
          argsStr: '{"key":"value"}',
          clientParams: mcpParams,
          toolName: 'my_tool',
        });
        expect(result.success).toBe(true);
        expect(result.content).toBe('tool output string');
      });

      it('should JSON.stringify object result from mcpService.callTool', async () => {
        const payload = {
          identifier: 'http-mcp',
          apiName: 'fetch',
          arguments: '{}',
          type: 'mcp',
        } as any;

        const mcpParams = { type: 'http', url: 'http://localhost' };
        const context = makeContext({
          toolManifestMap: {
            'http-mcp': { identifier: 'http-mcp', mcpParams } as any,
          },
        });

        const responseObj = { status: 'ok', data: [1, 2, 3] };
        mcpService.callTool.mockResolvedValue(responseObj);

        const result = await service.executeTool(payload, context);

        expect(result.success).toBe(true);
        expect(result.content).toBe(JSON.stringify(responseObj));
        expect(result.state).toEqual(responseObj);
      });

      it('should return MCP_EXECUTION_ERROR when mcpService.callTool throws', async () => {
        const payload = {
          identifier: 'erroring-mcp',
          apiName: 'fail',
          arguments: '{}',
          type: 'mcp',
        } as any;

        const mcpParams = { type: 'stdio', command: 'bad-server' };
        const context = makeContext({
          toolManifestMap: {
            'erroring-mcp': { identifier: 'erroring-mcp', mcpParams } as any,
          },
        });

        mcpService.callTool.mockRejectedValue(new Error('Connection refused'));

        const result = await service.executeTool(payload, context);

        expect(result.success).toBe(false);
        expect(result.content).toContain('Connection refused');
        expect(result.error?.code).toBe('MCP_EXECUTION_ERROR');
      });

      it('should route cloud MCP type to DiscoverService.callCloudMcpEndpoint', async () => {
        const payload = {
          identifier: 'cloud-mcp',
          apiName: 'search',
          arguments: '{"query":"test"}',
          type: 'mcp',
        } as any;

        const mcpParams = { type: 'cloud', endpoint: 'https://cloud.example.com' };
        const context = makeContext({
          toolManifestMap: {
            'cloud-mcp': { identifier: 'cloud-mcp', mcpParams } as any,
          },
          userId: 'user-123',
        });

        mockCallCloudMcpEndpoint.mockResolvedValue({
          content: [{ type: 'text', text: 'cloud result' }],
          isError: false,
        });

        const result = await service.executeTool(payload, context);

        expect(mockCallCloudMcpEndpoint).toHaveBeenCalledWith({
          apiParams: { query: 'test' },
          identifier: 'cloud-mcp',
          toolName: 'search',
        });
        expect(result.success).toBe(true);
        // cloud MCP should NOT call standard MCP service
        expect(mcpService.callTool).not.toHaveBeenCalled();
      });

      it('should return success=false when cloud MCP response has isError=true', async () => {
        const payload = {
          identifier: 'cloud-mcp-err',
          apiName: 'run',
          arguments: '{}',
          type: 'mcp',
        } as any;

        const mcpParams = { type: 'cloud' };
        const context = makeContext({
          toolManifestMap: {
            'cloud-mcp-err': { identifier: 'cloud-mcp-err', mcpParams } as any,
          },
          userId: 'user-456',
        });

        mockCallCloudMcpEndpoint.mockResolvedValue({
          content: [{ type: 'text', text: 'error occurred' }],
          isError: true,
        });

        const result = await service.executeTool(payload, context);

        expect(result.success).toBe(false);
      });

      it('should return CLOUD_MCP_EXECUTION_ERROR when cloud endpoint throws', async () => {
        const payload = {
          identifier: 'cloud-mcp-down',
          apiName: 'run',
          arguments: '{}',
          type: 'mcp',
        } as any;

        const mcpParams = { type: 'cloud' };
        const context = makeContext({
          toolManifestMap: {
            'cloud-mcp-down': { identifier: 'cloud-mcp-down', mcpParams } as any,
          },
          userId: 'user-789',
        });

        mockCallCloudMcpEndpoint.mockRejectedValue(new Error('Cloud service unavailable'));

        const result = await service.executeTool(payload, context);

        expect(result.success).toBe(false);
        expect(result.content).toContain('Cloud service unavailable');
        expect(result.error?.code).toBe('CLOUD_MCP_EXECUTION_ERROR');
      });
    });

    describe('result truncation', () => {
      it('should truncate content exceeding custom toolResultMaxLength', async () => {
        const longContent = 'a'.repeat(200);
        const payload = {
          identifier: 'lobe-tool',
          apiName: 'run',
          arguments: '{}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockResolvedValue({ content: longContent, success: true });

        const result = await service.executeTool(
          payload,
          makeContext({ toolResultMaxLength: 100 }),
        );

        expect(result.content.length).toBeLessThan(longContent.length);
        expect(result.content).toContain('[Content truncated]');
      });

      it('should not truncate content within the configured limit', async () => {
        const shortContent = 'short result';
        const payload = {
          identifier: 'lobe-tool',
          apiName: 'run',
          arguments: '{}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockResolvedValue({ content: shortContent, success: true });

        const result = await service.executeTool(payload, makeContext());

        expect(result.content).toBe(shortContent);
      });

      it('should truncate error message when it exceeds the default limit', async () => {
        // The catch block calls truncateToolResult(errorMessage) without a custom limit,
        // so it uses the default 25,000 char limit. Only very long errors are truncated.
        const longError = 'x'.repeat(26_000);
        const payload = {
          identifier: 'bad-plugin',
          apiName: 'run',
          arguments: '{}',
          type: 'default',
        } as any;

        pluginGatewayService.execute.mockRejectedValue(new Error(longError));

        const result = await service.executeTool(payload, makeContext());

        expect(result.success).toBe(false);
        expect(result.content).toContain('[Content truncated]');
      });
    });

    describe('executionTime', () => {
      it('should include numeric executionTime in successful response', async () => {
        const payload = {
          identifier: 'lobe-tool',
          apiName: 'run',
          arguments: '{}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockResolvedValue({ content: 'ok', success: true });

        const result = await service.executeTool(payload, makeContext());

        expect(typeof result.executionTime).toBe('number');
        expect(result.executionTime).toBeGreaterThanOrEqual(0);
      });

      it('should include numeric executionTime in error response', async () => {
        const payload = {
          identifier: 'fail-tool',
          apiName: 'run',
          arguments: '{}',
          type: 'builtin',
        } as any;

        builtinToolsExecutor.execute.mockRejectedValue(new Error('fail'));

        const result = await service.executeTool(payload, makeContext());

        expect(typeof result.executionTime).toBe('number');
        expect(result.executionTime).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
