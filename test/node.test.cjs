// Test du nœud compilé : faux serveur Incarn + contexte n8n minimal qui reprend
// la conversion de requête de n8n-core 2.16.1 (FormData natif passé tel quel à axios 1.15).
const http = require('node:http');
const assert = require('node:assert');
const axios = require('axios');
const { NodeApiError } = require('n8n-workflow');
const { Incarn } = require('../dist/nodes/Incarn/Incarn.node.js');

const log = [];
let polls = 0;
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const send = (code, obj, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
  };
  log.push({ method: req.method, url: req.url, auth: req.headers.authorization, ct: req.headers['content-type'], idem: req.headers['idempotency-key'] });
  if (req.url.startsWith('/cdn/')) return send(200, Buffer.from('MP4DATA'), 'video/mp4');
  if (req.headers.authorization !== 'Bearer ik_live_test') return send(401, { message: 'Invalid API key' });
  if (req.url === '/v1/account') return send(200, { email: 'dev@example.com', credits: 7, cost_per_animation: 1 });
  if (req.method === 'POST' && req.url === '/v1/animations') {
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('multipart/form-data')) {
      const form = await new Response(raw, { headers: { 'content-type': ct } }).formData();
      const img = form.get('image');
      log[log.length - 1].multipart = { name: img.name, type: img.type, size: img.size, prompt: form.get('prompt'), first: Buffer.from(await img.arrayBuffer()).subarray(0, 3).toString('hex') };
    } else {
      log[log.length - 1].json = JSON.parse(raw.toString());
      if (log[log.length - 1].json.image_url.includes('broke')) return send(402, { message: 'No credits remaining.' });
    }
    return send(201, { id: 'a1', status: 'processing', video_url: null, error: null, created_at: '2026-10-29T08:00:00.000Z' });
  }
  if (req.url === '/v1/animations/a1') {
    polls++;
    return send(200, polls < 2
      ? { id: 'a1', status: 'processing', video_url: null, error: null, created_at: 'x' }
      : { id: 'a1', status: 'succeeded', video_url: `http://127.0.0.1:${server.address().port}/cdn/a1.mp4`, error: null, created_at: 'x' });
  }
  send(404, { message: 'Not found' });
});

// Reprise fidèle des étapes utiles de convertN8nRequestToAxios (n8n-core 2.16.1).
function toAxios(r) {
  const a = { headers: r.headers ?? {}, method: r.method, url: r.url, maxBodyLength: Infinity, maxContentLength: Infinity };
  if (r.encoding !== undefined) a.responseType = r.encoding;
  if (r.body && (typeof r.body === 'string' || (typeof r.body === 'object' && (Symbol.iterator in r.body || Object.keys(r.body).length)))) a.data = r.body;
  if (r.json && !Object.keys(a.headers).some((k) => k.toLowerCase() === 'accept')) a.headers = { ...a.headers, Accept: 'application/json' };
  a.headers = { ...a.headers, 'User-Agent': 'n8n' };
  return a;
}

function context(params, items) {
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const request = async (r) => {
    try {
      return (await axios(toAxios(r))).data;
    } catch (e) {
      // Comme n8n-core : l'erreur axios est enveloppée dans une NodeApiError.
      throw new NodeApiError({ name: 'Incarn', type: 'n8n-nodes-incarn.incarn', typeVersion: 1, parameters: {} }, e);
    }
  };
  return {
    getInputData: () => items,
    getNodeParameter: (name, i, fallback) => (name in params ? params[name] : fallback),
    getNode: () => ({ name: 'Incarn', type: 'n8n-nodes-incarn.incarn', typeVersion: 1, parameters: {} }),
    continueOnFail: () => params.__continue === true,
    helpers: {
      httpRequestWithAuthentication: async function (cred, r) {
        assert.equal(cred, 'incarnApi');
        return request({ ...r, url: r.url.replace('https://api.incarn.co', base()), headers: { ...r.headers, Authorization: `Bearer ${params.__key ?? 'ik_live_test'}` } });
      },
      httpRequest: request,
      assertBinaryData: (i, f) => items[i].binary[f],
      getBinaryDataBuffer: async (i, f) => Buffer.from(items[i].binary[f].data, 'base64'),
      prepareBinaryData: async (buf, fileName, mimeType) => ({ data: buf.toString('base64'), fileName, mimeType }),
    },
  };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const node = new Incarn();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const items = [{ json: {}, binary: { data: { data: jpeg.toString('base64'), mimeType: 'image/jpeg', fileName: 'mamie.jpg' } } }];

  // 1. Compte
  let out = await node.execute.call(context({ resource: 'account', operation: 'get' }, items));
  assert.equal(out[0][0].json.credits, 7);

  // 2. Fichier binaire + attente + téléchargement
  const t0 = Date.now();
  out = await node.execute.call(context({ resource: 'animation', operation: 'create', source: 'binary', binaryPropertyName: 'data', prompt: 'She smiles', waitForCompletion: true, downloadVideo: true, options: { idempotencyKey: 'k1' } }, items));
  const post = log.find((l) => l.method === 'POST');
  assert.match(post.ct, /^multipart\/form-data; boundary=/);
  assert.deepEqual(post.multipart, { name: 'mamie.jpg', type: 'image/jpeg', size: 7, prompt: 'She smiles', first: 'ffd8ff' });
  assert.equal(post.idem, 'k1');
  assert.equal(out[0][0].json.status, 'succeeded');
  assert.equal(Buffer.from(out[0][0].binary.video.data, 'base64').toString(), 'MP4DATA');
  assert.equal(out[0][0].binary.video.fileName, 'incarn-a1.mp4');
  const cdn = log.find((l) => l.url.startsWith('/cdn/'));
  assert.equal(cdn.auth, undefined, 'la clé ne doit pas partir vers le CDN');
  console.log(`binaire OK (attente ${Math.round((Date.now() - t0) / 1000)} s)`);

  // 3. URL sans attente
  out = await node.execute.call(context({ resource: 'animation', operation: 'create', source: 'url', imageUrl: ' https://example.com/p.jpg ', prompt: '', waitForCompletion: false, downloadVideo: false, options: { webhookUrl: 'https://hook.example.com/x' } }, items));
  const postUrl = log.filter((l) => l.method === 'POST').pop();
  assert.deepEqual(postUrl.json, { image_url: 'https://example.com/p.jpg', webhook_url: 'https://hook.example.com/x' });
  assert.equal(out[0][0].json.status, 'processing');

  // 4. Get
  out = await node.execute.call(context({ resource: 'animation', operation: 'get', animationId: 'a1', downloadVideo: false, options: {} }, items));
  assert.equal(out[0][0].json.id, 'a1');

  // 5. Erreurs : 402 et 401 avec message lisible ; continueOnFail
  await assert.rejects(node.execute.call(context({ resource: 'animation', operation: 'create', source: 'url', imageUrl: 'https://example.com/broke.jpg', waitForCompletion: false, downloadVideo: false, options: {} }, items)), /No credits left/);
  await assert.rejects(node.execute.call(context({ __key: 'ik_live_bad', resource: 'account', operation: 'get' }, items)), /Invalid API key/);
  out = await node.execute.call(context({ __continue: true, __key: 'ik_live_bad', resource: 'account', operation: 'get' }, items));
  assert.match(out[0][0].json.error, /Invalid API key/);

  console.log('tous les cas OK');
  server.close();
})().catch((e) => { console.error('ÉCHEC', e); server.close(); process.exit(1); });
