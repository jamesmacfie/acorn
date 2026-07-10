// The acorn MCP server ENTRY (docs/mcp.md): the build emits this module as out/main/mcp.js
// (electron.vite.config input `mcp`), which agents launch via ELECTRON_RUN_AS_NODE=1 <electron>
// out/main/mcp.js. A dedicated entry (instead of an argv-filename heuristic in server.ts) means
// importing the tool module for tests can never accidentally start — or fail to start — stdio.
import { main } from './server'

void main()
