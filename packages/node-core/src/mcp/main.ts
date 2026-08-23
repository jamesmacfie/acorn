// The acorn MCP server entry (docs/mcp.md): the build emits this module as mcp.js beside the node
// service, and agents launch it under the app's bundled Node. A dedicated entry, instead of an
// argv-filename heuristic in server.ts, means importing the tool module for tests can never
// accidentally start, or fail to start, stdio.
import { main } from './server'

void main()
