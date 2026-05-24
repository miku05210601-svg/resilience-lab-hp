const { authCheck, loadStockpile, getStatus } = require('./_helpers');

async function sendAlertWithResend(data) {
  const alertItems = data.items.filter(item =>
    getStatus(item.expiry, data.alertDays) !== 'ok'
  );
  if (alertItems.length === 0 || data.contacts.length === 0) return { skipped: true };

  const today = new Date().toLocaleDateString('ja-JP');
  const rows = alertItems.map(item => {
    const status = getStatus(item.expiry, data.alertDays);
    const badge = status === 'expired' ? '🔴 期限切れ' : '🟡 要確認';
    const diff = item.expiry
      ? Math.floor((new Date(item.expiry) - new Date()) / 86400000)
      : null;
    const expLabel = item.expiry ? `${item.expiry}（残${diff}日）` : '期限なし';
    const shortage = item.required > 0 && item.stock < item.required
      ? `-${item.required - item.stock} 不足`
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

  const to = data.contacts.map(c => ({ email: c.email, name: c.name }));
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY が未設定です');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: '備蓄品管理システム <noreply@resilab-jpn.com>',
      to: to.map(t => t.email),
      subject: `【備蓄品アラート】${alertItems.length}件の確認が必要です（${today}）`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend APIエラー: ${text}`);
  }
  return { sent: true, count: alertItems.length };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!authCheck(req)) return res.status(401).json({ error: '認証が必要です' });

  try {
    const { data } = await loadStockpile();
    const result = await sendAlertWithResend(data);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports.sendAlertWithResend = sendAlertWithResend;
