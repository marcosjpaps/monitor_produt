const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-auth-test-'));
process.env.DATABASE_URL = '';
process.env.POSTGRES_URL = '';
process.env.DB_PATH = path.join(tmp, 'auth-test.sqlite');
process.env.APP_SECRET_KEY = 'segredo-para-testes-de-sessao-assinada-123456789';
process.env.APP_ADMIN_EMAIL = 'teste@example.com';
const handler = require('../api/talhoes');

function response() {
  return { code: 200, data: null,
    setHeader() {},
    status(n) { this.code = n; return this; },
    json(v) { this.data = v; return this; },
    end() { return this; }
  };
}
function cookie(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.APP_SECRET_KEY).update(body).digest('base64url');
  return 'agromonitor_session=' + body + '.' + signature;
}

test('talhões nega usuário sem sessão e token adulterado', async () => {
  const r1 = response(); await handler({method:'GET',headers:{}},r1); assert.equal(r1.code,401);
  const r2 = response(); await handler({method:'GET',headers:{cookie:'agromonitor_session=invalido'}},r2); assert.equal(r2.code,401);
});
test('token assinado libera HEAD e protege mutações de origem externa', async () => {
  const now = Math.floor(Date.now()/1000);
  const auth = cookie({sub:'teste@example.com',iat:now,exp:now+3600});
  const r1 = response(); await handler({method:'HEAD',headers:{cookie:auth}},r1); assert.equal(r1.code,200);
  const r2 = response(); await handler({method:'POST',headers:{cookie:auth,origin:'https://externo.example',host:'monitor.example'}},r2); assert.equal(r2.code,403);
  const expired = cookie({sub:'teste@example.com',iat:now-8000,exp:now-10});
  const r3 = response(); await handler({method:'HEAD',headers:{cookie:expired}},r3); assert.equal(r3.code,401);
});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
