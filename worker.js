// 打卡记录同步中转（Cloudflare Worker）。
// 为什么需要它：GitHub Pages 是纯静态页，不能直接写仓库（写仓库要密钥，
// 密钥放进公开网页等于公开）。这个 Worker 拿着密钥帮 App 读写仓库里的 data.json。
//
// 部署方法（3 分钟）：
// 1. GitHub 建一个 fine-grained token：只给这一个仓库（hamburgloveer/hamburgloveer.github.io）
//    的 Contents 读写权限（Read and write），其他什么都不勾。
// 2. Cloudflare Dashboard → Workers → 新建 Worker，把这个文件内容粘贴进去，部署。
// 3. 在 Worker 的 Settings → Variables 里加一个 Secret：名字 GITHUB_TOKEN，值就是第 1 步的 token。
//    （REPO / BRANCH / FILE_PATH 下面有默认值，不用改，除非换仓库。）
// 4. 把 Worker 的地址（形如 https://daka-sync.xxx.workers.dev）填到 index.html 和
//    calendar.html 顶部的 WORKER_URL 里，推到仓库即可。
// 接上后：打开 App 自动合并手机和 GitHub 两边的记录；每次打卡/取消都同步写到 data.json。

const REPO = 'hamburgloveer/hamburgloveer.github.io';
const BRANCH = 'main';
const FILE_PATH = 'data.json';
const ALLOWED_ORIGIN = 'https://hamburgloveer.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders();
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/api/days') {
      return new Response('Not found', { status: 404, headers });
    }

    const repo = env.REPO || REPO;
    const branch = env.BRANCH || BRANCH;
    const filePath = env.FILE_PATH || FILE_PATH;
    const api = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const ghHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daka-sync',
    };

    if (request.method === 'GET') {
      const r = await fetch(`${api}?ref=${branch}`, { headers: ghHeaders });
      if (r.status === 404) return jsonResponse({ days: [] });
      if (!r.ok) return jsonResponse({ error: 'github read failed' }, 502);
      const data = await r.json();
      let days = [];
      try {
        days = JSON.parse(atob(data.content.replace(/\n/g, ''))).days || [];
      } catch (e) {}
      return jsonResponse({ days });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: 'bad json' }, 400);
      }
      const days = Array.isArray(body.days) ? body.days : [];
      const cur = await fetch(`${api}?ref=${branch}`, { headers: ghHeaders });
      let sha;
      if (cur.ok) sha = (await cur.json()).sha;
      const payload = {
        message: 'update check-in data',
        content: btoa(JSON.stringify({ days })),
        branch,
      };
      if (sha) payload.sha = sha;
      const put = await fetch(api, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!put.ok) return jsonResponse({ error: 'github write failed' }, 502);
      return jsonResponse({ ok: true, days });
    }

    return new Response('Method not allowed', { status: 405, headers });
  },
};
