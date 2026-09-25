// The relay server for Live Collab: carries edits and cursors between the people in a room. It keeps nothing on disk, and forgets a room
// when the last person leaves (each person's own copy of the note is the real thing). Run: npm run server   (PORT=1234 by default)
import http from "node:http";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const { setupWSConnection } = require("y-websocket/bin/utils");

const port = Number(process.env.PORT ?? 1234);
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Granite Live Collab relay\n");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
wss.on("connection", (ws, req) => setupWSConnection(ws, req));
server.on("upgrade", (req, socket, head) => {
  // The room is the URL path. A room id is 32 random letters and digits, so nobody can stumble onto one: refuse anything else.
  const room = (req.url ?? "").slice(1).split("?")[0];
  if (!/^[a-z0-9]{32}$/.test(room)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
server.listen(port, () => console.log(`Live Collab relay listening on port ${port}`));
