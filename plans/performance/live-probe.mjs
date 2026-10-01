import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WebDriverClient } from '../../apps/desktop/scripts/agent/webdriver.mjs'

const session = process.argv[2] ?? 'perf-baseline'
const action = process.argv[3] ?? 'info'
const manifest = JSON.parse(await readFile(resolve('.acorn/agent-dev', session, 'session.json'), 'utf8'))
if (manifest.status !== 'ready') throw new Error(`Session ${session} is not ready.`)
const driver = new WebDriverClient(manifest.webdriverEndpoint, manifest.webdriverSessionId)

if (action === 'info') {
  console.log(JSON.stringify(await driver.execute(`
    return {
      visible: document.visibilityState,
      focused: document.hasFocus(),
      elements: document.querySelectorAll('*').length,
      marks: performance.getEntriesByType('mark').map(({ name, startTime }) => ({ name, startTime })),
      measures: performance.getEntriesByType('measure').length,
      xterms: document.querySelectorAll('.xterm').length
    };
  `), null, 2))
} else if (action === 'seed') {
  const projectPath = process.argv[4]
  if (!projectPath?.startsWith('/tmp/')) throw new Error('Seed requires a disposable non-Git project under /tmp/.')
  console.log(JSON.stringify(await driver.execute(`
    return (async () => {
      const fleet = await window.acorn.fleetList();
      const node = fleet.nodes.find(node => node.local) ?? fleet.nodes[0];
      if (!node) throw new Error('No Node is available.');
      const request = async (path, method = 'GET', body) => {
        const reply = await window.acorn.nodeFetch(node.nodeId, {
          requestId: crypto.randomUUID(), path, method,
          ...(body ? { headers: { 'content-type': 'application/json' }, body: { kind: 'bytes', bytes: new TextEncoder().encode(JSON.stringify(body)) } } : {})
        });
        const result = JSON.parse(new TextDecoder().decode(reply.body));
        if (reply.status >= 400) throw new Error(path + ': ' + JSON.stringify(result));
        return result;
      };
      const projects = await request('/v1/core/projects');
      let project = projects.projects.find(project => project.path === arguments[0]);
      if (!project) project = (await request('/v1/core/projects', 'POST', { path: arguments[0], name: 'Performance fixture' })).project;
      let tasks = (await request('/v1/core/tasks')).filter(task => task.projectId === project.id);
      for (let index = tasks.length; index < 6; index++) {
        await request('/v1/core/tasks', 'POST', { projectId: project.id, origin: 'local', title: 'Performance task ' + (index + 1), skipSetup: true });
      }
      tasks = (await request('/v1/core/tasks')).filter(task => task.projectId === project.id);
      return { projectId: project.id, tasks: tasks.map(({ id, title }) => ({ id, title })) };
    })();
  `, [projectPath]), null, 2))
} else if (action === 'snapshot') {
  console.log(JSON.stringify(await driver.snapshot(), null, 2))
} else {
  throw new Error(`Unknown action: ${action}`)
}
