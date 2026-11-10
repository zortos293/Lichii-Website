const objectKey = /^(frequent|daily|manual)\/[0-9A-Za-z._-]{1,120}\.dump$/;

export default {
  async fetch(request, env) {
    if (!(await authorized(request, env))) return new Response('unauthorized', { status: 401 });
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));
    if (request.method === 'GET' && key === '') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const objects = [];
      let cursor;
      do {
        const page = await env.BUCKET.list({ prefix, cursor });
        objects.push(...page.objects.map(object => ({ key: object.key, size: object.size, uploaded: object.uploaded })));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return Response.json(objects.sort((a, b) => a.key.localeCompare(b.key)));
    }
    if (!objectKey.test(key)) return new Response('invalid key', { status: 400 });
    if (request.method === 'GET') {
      const object = await env.BUCKET.get(key);
      return object ? new Response(object.body, { headers: { 'content-length': String(object.size), etag: object.httpEtag } }) : new Response('not found', { status: 404 });
    }
    if (request.method !== 'PUT') return new Response('method not allowed', { status: 405 });
    const sha256 = request.headers.get('x-content-sha256') ?? '';
    if (!/^[0-9a-f]{64}$/.test(sha256)) return new Response('x-content-sha256 is required', { status: 400 });
    if (await env.BUCKET.head(key)) return new Response('already exists', { status: 409 });
    const object = await env.BUCKET.put(key, request.body, { sha256 });
    return Response.json({ key: object.key, size: object.size });
  },
};

async function authorized(request, env) {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header.slice(7))));
  const expected = Uint8Array.from(env.TOKEN_SHA256.match(/../g), byte => parseInt(byte, 16));
  return crypto.subtle.timingSafeEqual(actual, expected);
}
