const crypto = require('crypto');
const { EventEmitter } = require('events');

// A small, dependency-free WebSocket server (RFC 6455) - just what the game
// needs: text messages, ping/pong, close. Used for the live channel of the
// island game (parties, invites, and relaying game state between players).

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 256 * 1024;

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode (server frames are never masked)
  return Buffer.concat([header, payload]);
}

class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentBytes = 0;
    this.closed = false;
    this.lastPong = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish());
    socket.on('end', () => this._finish());
    socket.on('error', () => this._finish());
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return this.close(1009);
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_MESSAGE_BYTES) return this.close(1009);
      if (!masked) return this.close(1002); // browsers always mask
      if (buf.length < offset + 4 + len) return;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = buf.subarray(offset + 4 + len);
      this._onFrame(fin, opcode, payload);
    }
  }

  _onFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      // close
      this.close(1000);
      return;
    }
    if (opcode === 0x9) {
      this._write(frame(0xa, payload)); // ping -> pong
      return;
    }
    if (opcode === 0xa) {
      this.lastPong = Date.now();
      return;
    }
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      this.fragments.push(payload);
      this.fragmentBytes += payload.length;
      if (this.fragmentBytes > MAX_MESSAGE_BYTES) return this.close(1009);
      if (!fin) return;
      const data = Buffer.concat(this.fragments).toString('utf8');
      this.fragments = [];
      this.fragmentBytes = 0;
      this.lastPong = Date.now(); // any message counts as "still here"
      this.emit('message', data);
    }
  }

  _write(buf) {
    if (this.closed || this.socket.destroyed) return;
    try {
      this.socket.write(buf);
    } catch (err) {
      this._finish();
    }
  }

  send(text) {
    this._write(frame(0x1, Buffer.from(text, 'utf8')));
  }

  ping() {
    this._write(frame(0x9, Buffer.alloc(0)));
  }

  close(code = 1000) {
    if (this.closed) return;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    this._write(frame(0x8, body));
    this.socket.end();
    this._finish();
  }

  terminate() {
    this.socket.destroy();
    this._finish();
  }
}

// Answer the HTTP "Upgrade: websocket" request and hand over a connection.
function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
  );
  const ws = new WsConnection(socket);
  if (head && head.length) ws._onData(head);
  return ws;
}

function rejectUpgrade(socket, status = 401, text = 'Unauthorized') {
  socket.write(`HTTP/1.1 ${status} ${text}\r\n\r\n`);
  socket.destroy();
}

module.exports = { acceptUpgrade, rejectUpgrade, WsConnection, MAX_MESSAGE_BYTES };
