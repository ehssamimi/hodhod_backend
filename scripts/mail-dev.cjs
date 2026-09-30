// Local-only SMTP inbox. Does not forward messages or write them to disk.
const { SMTPServer } = require('smtp-server');
const { createServer } = require('node:http');
const messages = [];
const smtp = new SMTPServer({ disabledCommands: ['AUTH','STARTTLS'], size: 65536,
  onData(stream, session, callback) {
    let raw=''; stream.on('data', chunk => { raw += chunk.toString(); });
    stream.on('end', () => {
      if (stream.sizeExceeded) return callback(new Error('Message too large'));
      messages.unshift({ receivedAt:new Date().toISOString(),to:session.envelope.rcptTo.map(r=>r.address),raw });
      messages.splice(50); callback();
    });
  },
});
const http = createServer((req,res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'GET' || req.url !== '/') { res.statusCode=404; return res.end(); }
  res.end(JSON.stringify(messages,null,2));
});
smtp.listen(1025,'127.0.0.1', () => console.log('Local SMTP: 127.0.0.1:1025'));
http.listen(8025,'127.0.0.1', () => console.log('Local inbox: http://127.0.0.1:8025'));
function stop() { smtp.close(); http.close(); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
