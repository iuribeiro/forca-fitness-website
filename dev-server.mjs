import { createReadStream, readFileSync, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "5173", 10);
const root = resolve(import.meta.dirname);
const reloadClients = new Set();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const reloadScript = `
<script>
  const reloadEvents = new EventSource('/__reload');
  reloadEvents.addEventListener('reload', () => location.reload());
</script>`;

function filePathFor(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(root, relativePath);
  return filePath === root || filePath.startsWith(`${root}${sep}`) ? filePath : null;
}

const server = createServer((request, response) => {
  if (request.url === "/__reload") {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    response.write("retry: 250\n\n");
    reloadClients.add(response);
    request.on("close", () => reloadClients.delete(response));
    return;
  }

  const filePath = filePathFor(request.url ?? "/");
  if (!filePath) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    if (extname(filePath) === ".html") {
      const html = readFileSync(filePath, "utf8").replace("</body>", `${reloadScript}\n</body>`);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes[".html"],
      });
      response.end(html);
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    });
    createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

let reloadTimer;
watch(root, { recursive: true }, (_eventType, filename) => {
  if (!filename || filename.startsWith(".git") || filename === "dev-server.mjs") return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const client of reloadClients) client.write("event: reload\ndata: changed\n\n");
  }, 75);
});

server.listen(port, host, () => {
  console.log(`Força Fitness development server: http://${host}:${port}`);
  console.log("Watching files for changes. Press Ctrl+C to stop.");
});
