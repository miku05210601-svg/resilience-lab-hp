require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 株式会社レジリエンスラボ 案内ボット用システムプロンプト
const SYSTEM_PROMPT = `あなたは株式会社レジリエンスラボの公式AIアシスタントです。
防災・BCP（事業継続計画）対策のトータル支援を行う専門コンサルティング会社として、
お客様のご質問に丁寧かつ的確にお答えします。

【会社概要】
- 会社名：株式会社レジリエンスラボ（Resilience Lab Co., Ltd.）
- 事業内容：企業向け防災・BCP対策トータル支援
- メール：contact@resilience-lab.co.jp
- 営業時間：平日9時〜17時

【サービス名】
BCP対策デザイン事業

【サービス内容】
企業向けの防災・BCPトータル支援として、以下を提供しています。
- BCP策定支援
- 階層別研修
- 訓練・シミュレーション演習
- 備蓄品提案
- 停電対策提案
- その他、各社の実態・ニーズに合わせたご提案

【料金】
個別にお見積りしております。詳細はお問い合わせください。

【よくある質問と回答】
Q: これまでの実績は？
A: メーカー、物流、不動産、サービス等、複数の企業のご支援を実施しています。BCP診断、策定支援、研修、訓練、備蓄品提案など、各社の実態・ニーズに合わせたご提案を実施しています。

Q: まずは話を聞くだけでも良いですか？
A: はい、もちろん構いません。まずはお気軽にご連絡ください。

【対応方針】
- 常に丁寧な敬語で日本語でお答えください
- 具体的なお問い合わせや見積もりについては「contact@resilience-lab.co.jp までメールでお問い合わせください（平日9時〜17時対応）」とご案内ください
- 防災・BCPに関係のない質問には「弊社は防災・BCP対策の専門機関のため、その点については対応しかねます」と丁重にお断りください
- 200〜300文字程度の簡潔な回答を心がけてください`;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// チャットエンドポイント（SSEストリーミング）
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messagesが必要です' });
  }

  // SSEヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('message', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('Anthropic APIエラー:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AIの応答中にエラーが発生しました。' })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error('サーバーエラー:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'サーバーエラーが発生しました。' })}\n\n`);
    res.end();
  }
});

// ─── 備蓄品管理ツール ─────────────────────────────────────

const STOCKPILE_FILE = path.join(__dirname, 'data', 'stockpile.json');

// パスワードから決定論的トークンを生成（サーバー再起動後も同じ値）
function getStockpileToken() {
  return crypto.createHash('sha256').update('stockpile:' + (process.env.STOCKPILE_PASSWORD || '')).digest('hex');
}

// データ読み込み
function loadStockpile() {
  try {
    return JSON.parse(fs.readFileSync(STOCKPILE_FILE, 'utf8'));
  } catch {
    return { contacts: [], locations: ['本社'], alertDays: 90, items: [] };
  }
}

// データ保存
function saveStockpile(data) {
  fs.mkdirSync(path.dirname(STOCKPILE_FILE), { recursive: true });
  fs.writeFileSync(STOCKPILE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 期限ステータス判定
function getStatus(expiry, alertDays) {
  if (!expiry) return 'ok';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  const diff = Math.floor((exp - today) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= alertDays) return 'warning';
  return 'ok';
}

// メール送信
async function sendStockpileAlert() {
  const data = loadStockpile();
  const alertItems = data.items.filter(item =>
    getStatus(item.expiry, data.alertDays) !== 'ok'
  );
  if (alertItems.length === 0 || data.contacts.length === 0) return;

  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: parseInt(process.env.SMTP_PORT || '465') === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  };
  if (!smtpConfig.host || !smtpConfig.auth.user) {
    console.warn('SMTP設定が未完了のためメール送信をスキップします');
    return;
  }

  const transporter = nodemailer.createTransport(smtpConfig);
  const today = new Date().toLocaleDateString('ja-JP');

  const rows = alertItems.map(item => {
    const status = getStatus(item.expiry, data.alertDays);
    const badge = status === 'expired' ? '🔴 期限切れ' : '🟡 要確認';
    const diff = item.expiry
      ? Math.floor((new Date(item.expiry) - new Date()) / 86400000)
      : null;
    const expLabel = item.expiry
      ? `${item.expiry}（残${diff}日）`
      : '期限なし';
    const shortage = item.required > 0 && item.stock < item.required
      ? `<span style="color:#c00">-${item.required - item.stock} 不足</span>`
      : `+${item.stock - (item.required || 0)} 余剰`;
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${badge}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${item.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${item.category}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${item.location}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${item.stock} ${item.unit}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${shortage}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${expLabel}</td>
    </tr>`;
  }).join('');

  const html = `
    <div style="font-family:'Hiragino Kaku Gothic ProN','Yu Gothic UI',sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#8b1a2e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">🔔 備蓄品期限アラート（${today}）</h2>
      </div>
      <div style="background:#fff;padding:20px 24px;border:1px solid #e5e0db;border-top:none;border-radius:0 0 8px 8px">
        <p style="color:#3d3d3d">以下の備蓄品について確認が必要です。</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f8f6f4;color:#8b1a2e">
              <th style="padding:8px 12px;text-align:left">状態</th>
              <th style="padding:8px 12px;text-align:left">品名</th>
              <th style="padding:8px 12px;text-align:left">カテゴリ</th>
              <th style="padding:8px 12px;text-align:left">拠点</th>
              <th style="padding:8px 12px;text-align:left">在庫数</th>
              <th style="padding:8px 12px;text-align:left">過不足</th>
              <th style="padding:8px 12px;text-align:left">使用期限</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#888;font-size:12px;margin-top:20px">
          このメールは備蓄品管理システムから自動送信されています。
        </p>
      </div>
    </div>`;

  const to = data.contacts.map(c => c.email).join(', ');
  try {
    await transporter.sendMail({
      from: `"備蓄品管理システム" <${process.env.SMTP_USER}>`,
      to,
      subject: `【備蓄品アラート】${alertItems.length}件の確認が必要です（${today}）`,
      html,
    });
    console.log(`備蓄品アラートメールを送信しました: ${to}`);
  } catch (err) {
    console.error('メール送信エラー:', err.message);
  }
}

// 認証ミドルウェア
function authStockpile(req, res, next) {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${getStockpileToken()}`) return next();
  res.status(401).json({ error: '認証が必要です' });
}

// ログインエンドポイント
app.post('/api/stockpile/login', (req, res) => {
  const { password } = req.body;
  const expected = process.env.STOCKPILE_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'STOCKPILE_PASSWORDが未設定です' });
  if (password !== expected) return res.status(401).json({ error: 'パスワードが違います' });
  res.json({ token: getStockpileToken() });
});

// データ取得
app.get('/api/stockpile/data', authStockpile, (req, res) => {
  res.json(loadStockpile());
});

// データ保存
app.post('/api/stockpile/data', authStockpile, (req, res) => {
  saveStockpile(req.body);
  res.json({ ok: true });
});

// 手動アラートメール送信
app.post('/api/stockpile/send-alert', authStockpile, async (req, res) => {
  try {
    await sendStockpileAlert();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 毎朝9時にアラートメール自動送信
cron.schedule('0 9 * * *', sendStockpileAlert, { timezone: 'Asia/Tokyo' });

// ─────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
