import path from 'path';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socketHandlers.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, '..', 'client')));

registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`Échecs vote — http://localhost:${PORT}`);
});
