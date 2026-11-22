import { randomUUID } from 'node:crypto';
import { ApiError } from '../../packages/contracts/style-analysis.mjs';

export function shopRpc({ fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  return async (name, args, accessToken) => {
    const id = randomUUID();
    try {
      const response = await fetchImpl('https://mcp.shop.com/', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: {
          name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'travel-ai-stylist', version: '0.1.0' },
            'io.modelcontextprotocol/clientCapabilities': {} }
        } })
      });
      if (response.status === 401) throw new ApiError(401, 'SHOP_SIGN_IN_REQUIRED', 'Connect Shop again to continue.');
      if (!response.ok) throw Error();
      const body = await response.json();
      if (body.jsonrpc !== '2.0' || body.id !== id || body.error || body.result?.isError || !body.result?.structuredContent) throw Error();
      return body.result.structuredContent;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Never expose upstream bodies, URLs, account records, or payment credentials.
      throw new ApiError(502, 'SHOP_UNAVAILABLE', 'Shop could not finish that request. Please check its status before trying again.', true);
    }
  };
}
