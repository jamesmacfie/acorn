import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

// An isolated page for child-webview acceptance. Reports contain only this fixture's synthetic
// state. Main-document requests are counted separately from activity and application data reads.
export function previewFixture() {
  const documents = []
  const activity = []
  const dataReads = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    response.setHeader('Cache-Control', 'no-store')
    if (url.pathname === '/__report') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ documents, activity, dataReads }))
      return
    }
    if (url.pathname === '/activity') {
      let body = ''
      for await (const chunk of request) body += chunk
      activity.push({ at: Date.now(), ...JSON.parse(body) })
      response.end('ok')
      return
    }
    if (url.pathname === '/data') {
      dataReads.push(Date.now())
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(Array.from({ length: 1500 }, (_, id) => ({ id, name: `Project ${id}`, value: id * 13 }))))
      return
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return }
    documents.push({ at: Date.now(), path: url.pathname, query: url.search })
    if (url.pathname === '/redirect') { response.writeHead(302, { Location: `/nested${url.search}` }).end(); return }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html><head><title>Preview retention fixture</title>
      <style>body{font:18px system-ui;padding:24px;background:#fafafa;color:#222}input{font:inherit;padding:8px}a{margin-right:24px}table{width:100%}td{padding:8px;border-bottom:1px solid #ccc}.scroll{height:240px;overflow:auto;margin-top:24px}</style></head>
      <body><h1>Preview retention fixture</h1><p>Document: <output id="incarnation"></output></p>
      <label>Unsaved form <input id="form" placeholder="Type an unsaved value"></label>
      <p><a href="/nested">Nested route</a><a href="/redirect">Redirect</a><a href="/development">Development dashboard</a></p>
      <div class="scroll" id="scroll"><table id="rows"></table></div>
      <script>
      const incarnation = crypto.randomUUID(); document.querySelector('#incarnation').textContent = incarnation;
      const report = () => fetch('/activity', {method:'POST',body:JSON.stringify({incarnation,path:location.pathname,form:document.querySelector('#form').value,scroll:document.querySelector('#scroll').scrollTop,hidden:document.hidden})});
      const draw = rows => document.querySelector('#rows').innerHTML = rows.map(row => '<tr><td>'+row.name+'</td><td>'+row.value+'</td></tr>').join('');
      draw(Array.from({length:1500},(_,id)=>({name:'Project '+id,value:id*13})));
      if(location.pathname==='/development') {
        setInterval(async()=>draw(await (await fetch('/data')).json()),1000);
      }
      if(new URLSearchParams(location.search).has('seedState')) { document.querySelector('#form').value='unsaved fixture text'; document.querySelector('#scroll').scrollTop=333; }
      report(); setInterval(report,1000); document.addEventListener('visibilitychange',report);
      </script></body></html>`)
  })
  return { server, documents, activity, dataReads }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = previewFixture()
  fixture.server.listen(0, '127.0.0.1', () => {
    console.log(JSON.stringify({ url: `http://localhost:${fixture.server.address().port}` }))
  })
}
