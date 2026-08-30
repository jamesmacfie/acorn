// The acorn MCP server entry (docs/mcp.md): the build emits this module as mcp.js beside the node
// service, and agents launch it under the app's bundled Node. A dedicated entry, instead of an
// argv-filename heuristic in node-core's server.ts, means importing the tool module for tests can
// never accidentally start, or fail to start, stdio.
//
// It lives here, with the other two entries, because the app that builds an executable owns it;
// node-core keeps the library half.
import { main } from '@acorn/node-core/mcp/server.ts'

void main()
