// Local-only SMTP inbox. Does not forward messages or write them to disk.
require('dotenv/config');
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
// Windows reserves some low ports (netsh interface ipv4 show excludedportrange protocol=tcp); override when 1025 is taken.
const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
const inboxPort = Number(process.env.MAIL_DEV_INBOX_PORT ?? 8025);
smtp.listen(smtpPort,'127.0.0.1', () => console.log('Local SMTP: 127.0.0.1:'+smtpPort));
http.listen(inboxPort,'127.0.0.1', () => console.log('Local inbox: http://127.0.0.1:'+inboxPort));
function stop() { smtp.close(); http.close(); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
