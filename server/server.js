import path from 'path';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socketHandlers.js';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// Configuration CORS ultra-permissive
app.use(cors({
  origin: '*', // Accepter toutes les origines
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 204,
  preflightContinue: true
}));

const io = new Server(server, {
  cors: { 
    origin: '*', // Accepter toutes les origines
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin'],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, '..', 'client')));

registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`Échecs vote — http://localhost:${PORT}`);
});
