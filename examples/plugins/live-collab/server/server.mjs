// The relay server for Live Collab, for people who run their own: passes encrypted edits and cursors between the people in a room. It keeps
// nothing on disk, cannot read what it carries (see room.mjs), and forgets a room when the last person leaves.
// Run: npm run server   (PORT=1234 by default)
import http from "node:http";
import { WebSocketServer } from "ws";
import { Room } from "./room.mjs";

const port = Number(process.env.PORT ?? 1234);
const rooms = new Map();
// Limits, so one person can't use up the server: each room may keep up to 4 MB (room.mjs), and one address may hold only so many connections.
const MAX_ROOMS = 1000;
const MAX_PER_ADDRESS = 20;
const perAddress = new Map();

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Granite Live Collab relay\n");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
wss.on("connection", (socket, req) => {
  const id = (req.url ?? "").slice(1).split("?")[0];
  const address = req.socket.remoteAddress ?? "";
  perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
  const room = rooms.get(id) ?? new Room();
  rooms.set(id, room);
  const peer = { send: (bytes) => socket.readyState === 1 && socket.send(bytes) };
  socket.on("close", () => {
    room.leave(peer);
    if (room.size === 0) rooms.delete(id);
    const left = (perAddress.get(address) ?? 1) - 1;
    if (left > 0) perAddress.set(address, left);
    else perAddress.delete(address);
  });
  if (!room.join(peer)) return socket.close();
  socket.on("message", (data, isBinary) => isBinary && room.message(peer, new Uint8Array(data)));
});
server.on("upgrade", (req, socket, head) => {
  const refuse = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
  };
  // The room is the URL path: 32 letters and digits (a hash of the room's secret), so nobody can stumble onto one. Refuse anything else.
  const room = (req.url ?? "").slice(1).split("?")[0];
  if (!/^[a-z0-9]{32}$/.test(room)) return refuse("400 Bad Request");
  if (!rooms.has(room) && rooms.size >= MAX_ROOMS) return refuse("503 Service Unavailable");
  if ((perAddress.get(req.socket.remoteAddress ?? "") ?? 0) >= MAX_PER_ADDRESS) return refuse("429 Too Many Requests");
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
server.listen(port, () => console.log(`Live Collab relay listening on port ${port}`));
