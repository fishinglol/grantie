// The relay server for Live Collab, for people who run their own: passes encrypted edits and cursors between the people in a room. It keeps
// nothing on disk, cannot read what it carries (see room.mjs), and forgets a room when the last person leaves.
// Run: npm run server   (PORT=1234 by default)
import http from "node:http";
import { WebSocketServer } from "ws";
import { Room } from "./room.mjs";

const port = Number(process.env.PORT ?? 1234);
const rooms = new Map();

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Granite Live Collab relay\n");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
wss.on("connection", (socket, req) => {
  const id = (req.url ?? "").slice(1).split("?")[0];
  const room = rooms.get(id) ?? new Room();
  rooms.set(id, room);
  const peer = { send: (bytes) => socket.readyState === 1 && socket.send(bytes) };
  if (!room.join(peer)) return socket.close();
  socket.on("message", (data, isBinary) => isBinary && room.message(peer, new Uint8Array(data)));
  socket.on("close", () => {
    room.leave(peer);
    if (room.size === 0) rooms.delete(id);
  });
});
server.on("upgrade", (req, socket, head) => {
  // The room is the URL path: 32 letters and digits (a hash of the room's secret), so nobody can stumble onto one. Refuse anything else.
  const room = (req.url ?? "").slice(1).split("?")[0];
  if (!/^[a-z0-9]{32}$/.test(room)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
server.listen(port, () => console.log(`Live Collab relay listening on port ${port}`));
