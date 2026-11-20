// MCP tool schemas, copied verbatim from docs/spec/30-relay-server.md section 8.5.
// The functions (Python) keep their own copy in sieve/tools.py; these are for the web app, the extension and tests.
import MCP_TOOL_RESULT_SCHEMA from './mcp-tool-result.json';
import MCP_LADDER_INPUT_SCHEMA from './mcp-ladder-input.json';
import MCP_CHECK_INPUT_SCHEMA from './mcp-check-input.json';

export { MCP_TOOL_RESULT_SCHEMA, MCP_LADDER_INPUT_SCHEMA, MCP_CHECK_INPUT_SCHEMA };
