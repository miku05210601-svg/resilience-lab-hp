const crypto = require('crypto');

const GITHUB_OWNER = 'miku05210601-svg';
const GITHUB_REPO = 'resilience-lab-hp';
const GITHUB_FILE = 'data/stockpile.json';
const GITHUB_BRANCH = 'master';

function getStockpileToken() {
  return crypto.createHash('sha256')
    .update('stockpile:' + (process.env.STOCKPILE_PASSWORD || ''))
    .digest('hex');
}

function authCheck(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${getStockpileToken()}`;
}

async function githubRequest(method, path, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN が未設定です');
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API エラー ${res.status}: ${text}`);
  }
  return res.json();
}

async function loadStockpile() {
  try {
    const data = await githubRequest('GET', GITHUB_FILE);
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { data: JSON.parse(content), sha: data.sha };
  } catch (err) {
    if (err.message.includes('404')) {
      return {
        data: { contacts: [], locations: ['本社'], alertDays: 90, items: [] },
        sha: null,
      };
    }
    throw err;
  }
}

async function saveStockpile(jsonData, sha) {
  const content = Buffer.from(JSON.stringify(jsonData, null, 2), 'utf8').toString('base64');
  const body = {
    message: 'feat: 備蓄品データ更新',
    content,
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  return githubRequest('PUT', GITHUB_FILE, body);
}

function getStatus(expiry, alertDays) {
  if (!expiry) return 'ok';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  const diff = Math.floor((exp - today) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= alertDays) return 'warning';
  return 'ok';
}

module.exports = { getStockpileToken, authCheck, loadStockpile, saveStockpile, getStatus };
