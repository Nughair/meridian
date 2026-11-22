import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'game') + path.sep
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}
const port = Number(process.env.PORT) || 4173

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'
  const file = path.normalize(path.join(root, rel))
  if (!file.startsWith(root)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  try {
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mica running at http://127.0.0.1:${port}`)
})
