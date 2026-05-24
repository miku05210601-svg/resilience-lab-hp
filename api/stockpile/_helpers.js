const crypto = require('crypto');
const https = require('https');

const GITHUB_OWNER = 'miku05210601-svg';
const GITHUB_REPO = 'resilience-lab-hp';
const GITHUB_BRANCH = 'master';

// ─ トークン生成 ──────────────────────────────────
function getStockpileToken() {
  return crypto.createHash('sha256')
    .update('stockpile:' + (process.env.STOCKPILE_PASSWORD || ''))
    .digest('hex');
}

// 会社ごとのパスワードハッシュ（companies.json保存用）
function hashPassword(companyCode, password) {
  return crypto.createHash('sha256')
    .update(`pwd:${companyCode}:${password}`)
    .digest('hex');
}

// 会社ごとのトークンハッシュ（セッショントークン）
function deriveCompanyToken(companyCode, password) {
  return crypto.createHash('sha256')
    .update(`token:${companyCode}:${password}`)
    .digest('hex');
}

// 管理者トークン
function getAdminToken() {
  return crypto.createHash('sha256')
    .update('admin:' + (process.env.ADMIN_PASSWORD || ''))
    .digest('hex');
}

// ─ 認証チェック ──────────────────────────────────
function authCheck(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${getStockpileToken()}`;
}

function authAdmin(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${getAdminToken()}`;
}

function authCompany(req, tokenHash) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${tokenHash}`;
}

// ─ GitHub API ────────────────────────────────────
function githubRequest(method, filePath, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return reject(new Error('GITHUB_TOKEN が未設定です'));

    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      method,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'resilience-lab-stockpile',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`GitHub API エラー ${res.statusCode}: ${data}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSONパースエラー: ${data}`)); }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function githubGet(filePath) {
  try {
    const res = await githubRequest('GET', filePath);
    const content = Buffer.from(res.content, 'base64').toString('utf8');
    return { data: JSON.parse(content), sha: res.sha };
  } catch (err) {
    if (err.message.includes('404')) return { data: null, sha: null };
    throw err;
  }
}

async function githubPut(filePath, jsonData, sha, message) {
  const content = Buffer.from(JSON.stringify(jsonData, null, 2), 'utf8').toString('base64');
  const body = { message: message || 'データ更新', content, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;
  return githubRequest('PUT', filePath, body);
}

// ─ 会社リスト ─────────────────────────────────────
async function loadCompanies() {
  const { data, sha } = await githubGet('data/companies.json');
  return { companies: data || [], sha };
}

async function saveCompanies(companies, sha) {
  return githubPut('data/companies.json', companies, sha, '会社リスト更新');
}

// ─ 会社別備蓄品データ ─────────────────────────────
async function loadCompanyData(companyCode) {
  const { data, sha } = await githubGet(`data/stockpile-${companyCode}.json`);
  return {
    data: data || { contacts: [], locations: ['本社'], alertDays: 90, items: [] },
    sha,
  };
}

async function saveCompanyData(companyCode, jsonData, sha) {
  return githubPut(
    `data/stockpile-${companyCode}.json`,
    jsonData,
    sha,
    `備蓄品データ更新 (${companyCode})`
  );
}

// ─ 単一会社（旧システム互換）───────────────────────
async function loadStockpile() {
  const { data, sha } = await githubGet('data/stockpile.json');
  return {
    data: data || { contacts: [], locations: ['本社'], alertDays: 90, items: [] },
    sha,
  };
}

async function saveStockpile(jsonData, sha) {
  return githubPut('data/stockpile.json', jsonData, sha, '備蓄品データ更新');
}

// ─ ステータス判定 ─────────────────────────────────
function getStatus(expiry, alertDays) {
  if (!expiry) return 'ok';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  const diff = Math.floor((exp - today) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= (alertDays || 90)) return 'warning';
  return 'ok';
}

module.exports = {
  getStockpileToken, hashPassword, deriveCompanyToken, getAdminToken,
  authCheck, authAdmin, authCompany,
  loadCompanies, saveCompanies,
  loadCompanyData, saveCompanyData,
  loadStockpile, saveStockpile,
  getStatus,
};
