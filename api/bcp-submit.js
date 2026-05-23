const { Resend } = require('resend');
const Anthropic = require('@anthropic-ai/sdk');

const CATEGORIES = [
  'BCPの策定状況',
  'リスク認識・評価',
  '組織・体制',
  'IT・情報管理',
  'サプライチェーン',
  '訓練・維持管理',
];

// Claude APIで改善提案レポートを生成
async function generateReport({ company, size, totalScore, level, catPcts }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const domainList = CATEGORIES
    .map((cat, i) => `・${cat}: ${catPcts?.[i] ?? 0}点 / 100点`)
    .join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1600,
    messages: [{
      role: 'user',
      content: `あなたは株式会社レジリエンスラボの防災・BCP専門コンサルタントです。
以下の企業のBCP簡易診断結果をもとに、具体的で実践的な改善提案レポートを日本語で作成してください。

【企業情報】
会社名: ${company}
従業員数: ${size || '不明'}

【診断結果】
総合スコア: ${totalScore}点 / 100点
総合レベル: ${level}

【領域別スコア】
${domainList}

【重要な注意】
総合スコアが80点以上（レベルA・優良）の場合は、改善ではなく「さらなる高みへの発展・維持」の観点で提案してください。弱点を指摘するのではなく、現状を称えつつ、BCPの高度化・組織強化・業界リーダーとしての姿勢を提案する内容にしてください。

以下の形式のJSONのみを返してください（前後に説明文は不要）：
{
  "summary": "総評（3〜4文。会社名を入れてパーソナライズ。現状を正直に、かつ前向きに。レベルAなら高い水準を称える）",
  "strengths": ["強みの領域と簡単なコメント（スコア60点以上の領域。最大2つ。なければ空配列）"],
  "weakPoints": [
    {"area": "領域名またはテーマ", "comment": "課題または発展のポイント（レベルAなら高度化・維持の観点で）", "action": "具体的なアクション1文"}
  ],
  "top3Actions": [
    "最優先アクション（具体的に。レベルAなら高度化・維持の観点で）",
    "2番目のアクション（具体的に）",
    "3番目のアクション（具体的に）"
  ],
  "closing": "前向きな締めのメッセージ（2文。レジリエンスラボとしてサポートする意欲を示す）"
}`,
    }],
  });

  return JSON.parse(msg.content[0].text);
}

// 顧客向けHTMLメール本文を生成
function buildCustomerHtml({ company, name, totalScore, level, catPcts, report }) {
  const levelColor = { A: '#2e7d32', B: '#1565c0', C: '#f57f17', D: '#C8002D' };
  const color = levelColor[level?.match(/[ABCD]/)?.[0]] ?? '#C8002D';

  const domainBars = CATEGORIES.map((cat, i) => {
    const pct = catPcts?.[i] ?? 0;
    const barColor = pct >= 70 ? '#2e7d32' : pct >= 40 ? '#f57f17' : '#C8002D';
    return `
      <tr>
        <td style="padding:6px 0; font-size:13px; color:#555; width:130px;">${cat}</td>
        <td style="padding:6px 8px;">
          <div style="background:#eee; border-radius:4px; height:12px; width:100%;">
            <div style="background:${barColor}; width:${pct}%; height:12px; border-radius:4px;"></div>
          </div>
        </td>
        <td style="padding:6px 0; font-size:13px; font-weight:bold; color:${barColor}; width:40px; text-align:right;">${pct}点</td>
      </tr>`;
  }).join('');

  const strengthsHtml = (report.strengths?.length > 0)
    ? `<ul style="margin:8px 0; padding-left:20px;">${report.strengths.map(s => `<li style="margin-bottom:6px; font-size:14px; color:#333;">${s}</li>`).join('')}</ul>`
    : '<p style="font-size:14px; color:#555; margin:8px 0;">今後の取り組みで強みを育てていきましょう。</p>';

  const weakHtml = (report.weakPoints || []).map(w => `
    <div style="background:#fff8f8; border-left:3px solid #C8002D; padding:12px 16px; margin-bottom:12px; border-radius:0 8px 8px 0;">
      <p style="font-weight:bold; color:#C8002D; margin:0 0 4px; font-size:14px;">▼ ${w.area}</p>
      <p style="font-size:13px; color:#555; margin:0 0 6px;">${w.comment}</p>
      <p style="font-size:13px; color:#333; margin:0;"><strong>→ 推奨アクション：</strong>${w.action}</p>
    </div>`).join('');

  const actionsHtml = (report.top3Actions || []).map((a, i) => `
    <div style="display:flex; align-items:flex-start; margin-bottom:12px;">
      <div style="background:#C8002D; color:white; font-weight:bold; font-size:13px; width:28px; height:28px; min-width:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:12px; margin-top:2px;">${i + 1}</div>
      <p style="font-size:14px; color:#333; margin:4px 0;">${a}</p>
    </div>`).join('');

  // サービスカード生成（スコアに応じて改善型・高度化型を切り替え）
  const lLetter = level?.match(/[ABCD]/)?.[0] ?? 'D';
  const isTopLevel = lLetter === 'A';

  const IMPROVE_SERVICES = [
    { cat: 0, name: 'BCP策定支援', icon: '📋', desc: 'BCPの文書化から体制構築まで、専門コンサルタントが伴走してゼロからサポートします。' },
    { cat: 1, name: 'リスク評価・詳細診断', icon: '🔍', desc: '自社のリスク洗い出しから重要業務・目標復旧時間の特定まで、現場に即した詳細診断を実施します。' },
    { cat: 2, name: '階層別BCP研修', icon: '🎓', desc: '経営層・管理職・全社員向けに、自社の課題に合わせたカスタム研修プログラムを提供します。' },
    { cat: 3, name: 'IT-BCP支援', icon: '💻', desc: 'データバックアップ体制の見直しからシステム復旧計画の策定まで、IT面の事業継続を支援します。' },
    { cat: 4, name: 'サプライチェーンBCP支援', icon: '🔗', desc: '重要取引先のBCP状況調査から代替調達先の確保まで、サプライチェーン視点で支援します。' },
    { cat: 5, name: '訓練・シミュレーション演習', icon: '🏃', desc: '災害対策本部訓練・安否確認訓練など、BCPを机上から実践レベルに引き上げる演習を実施します。' },
  ];

  const ADVANCED_SERVICES = [
    { name: '高度化訓練・シミュレーション演習', icon: '🏆', desc: '大規模複合災害や長期停電など、より難易度の高いシナリオでの演習を実施。現状のBCPの穴を発見し、さらなる実効性強化を図ります。' },
    { name: 'BCP定期見直し・ブラッシュアップ支援', icon: '🔄', desc: '法改正・組織変更・拠点移転など環境変化に合わせて、専門家とともにBCPを継続的にアップデートします。' },
    { name: 'サプライチェーン全体の強靭化支援', icon: '🔗', desc: '自社のBCPをグループ会社・取引先にも展開。サプライチェーン全体のBCPレベル底上げを支援します。' },
    { name: '全社員BCP教育の継続・高度化', icon: '🎓', desc: '階層別・部門別の定期教育プログラムで、組織全体のBCP意識と実践力を維持・向上させます。' },
  ];

  let targetServices, sectionTitle;
  if (isTopLevel) {
    targetServices = ADVANCED_SERVICES;
    sectionTitle = '■ さらなる高みへ — レジリエンスラボの高度化支援';
  } else {
    targetServices = IMPROVE_SERVICES.filter(s => (catPcts?.[s.cat] ?? 0) < 70);
    sectionTitle = '■ 貴社の課題に対応したレジリエンスラボのサービス';
  }

  const servicesHtml = targetServices.map(s => `
    <div style="border:1px solid #eee; border-radius:10px; padding:16px; margin-bottom:12px;">
      <p style="font-size:15px; font-weight:bold; color:#1a1a2e; margin:0 0 6px;">${s.icon} ${s.name}</p>
      <p style="font-size:13px; color:#555; margin:0; line-height:1.7;">${s.desc}</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f5f5f5; font-family:'Hiragino Kaku Gothic ProN','Noto Sans JP','Meiryo',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5; padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

      <!-- ヘッダー -->
      <tr><td style="background:#C8002D; padding:24px 32px; border-radius:12px 12px 0 0;">
        <p style="color:white; font-size:12px; margin:0 0 4px; opacity:0.8;">株式会社レジリエンスラボ</p>
        <p style="color:white; font-size:20px; font-weight:bold; margin:0;">BCP簡易診断レポート</p>
      </td></tr>

      <!-- 本文 -->
      <tr><td style="background:white; padding:32px; border-radius:0 0 12px 12px;">

        <p style="font-size:15px; color:#333; margin:0 0 24px;">${name} 様<br><br>
        この度はBCP簡易診断にご参加いただきありがとうございます。<br>
        診断結果と改善提案をお届けします。</p>

        <!-- スコア -->
        <div style="background:#f9f9f9; border-radius:10px; padding:24px; text-align:center; margin-bottom:28px;">
          <p style="font-size:13px; color:#888; margin:0 0 8px;">総合スコア</p>
          <p style="font-size:56px; font-weight:900; color:#C8002D; margin:0; line-height:1;">${totalScore}</p>
          <p style="font-size:14px; color:#888; margin:0 0 16px;">点 / 100点</p>
          <div style="display:inline-block; background:${color}22; color:${color}; font-weight:bold; font-size:16px; padding:8px 24px; border-radius:999px;">${level}</div>
        </div>

        <!-- 総評 -->
        <div style="margin-bottom:28px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 16px;">■ 総評</h2>
          <p style="font-size:14px; color:#333; line-height:1.8; margin:0;">${report.summary}</p>
        </div>

        <!-- 領域別スコア -->
        <div style="margin-bottom:28px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 16px;">■ 領域別スコア</h2>
          <table width="100%" cellpadding="0" cellspacing="0">${domainBars}</table>
        </div>

        <!-- 強み -->
        <div style="margin-bottom:28px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 16px;">■ 貴社の強み</h2>
          ${strengthsHtml}
        </div>

        <!-- 課題・改善点 -->
        <div style="margin-bottom:28px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 16px;">■ 優先的に強化すべき領域</h2>
          ${weakHtml}
        </div>

        <!-- 優先アクション3つ -->
        <div style="margin-bottom:32px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 16px;">■ 今すぐ取り組むべき3つのアクション</h2>
          ${actionsHtml}
        </div>

        <!-- 締め -->
        <div style="background:#f9f9f9; border-radius:10px; padding:20px; margin-bottom:28px; border-left:4px solid #C8002D;">
          <p style="font-size:14px; color:#333; line-height:1.8; margin:0;">${report.closing}</p>
        </div>

        <!-- 弊社サービス紹介 -->
        <div style="margin-bottom:28px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 16px;">${sectionTitle}</h2>
          ${servicesHtml}
        </div>

        <!-- アポイントCTA -->
        <div style="background:#1a1a2e; border-radius:10px; padding:28px; text-align:center; margin-bottom:28px;">
          <p style="color:white; font-size:18px; font-weight:bold; margin:0 0 16px;">まずは無料でご相談ください</p>
          <p style="color:#ccc; font-size:14px; margin:0 0 20px; line-height:1.9; text-align:left;">
            診断結果をもとに、貴社に最適なBCP・課題への対応をご提案いたします。<br>
            オンライン・ご訪問どちらでも対応可能です。<br>
            <span style="font-size:12px; color:#999;">（ご訪問は東京・神奈川・千葉・埼玉に限ります。ご了承ください。）</span><br><br>
            まずは他社の状況や改善アイディアなど、ざっくばらんな情報共有を前提に、お気軽にご連絡ください。
          </p>
          <a href="mailto:contact@resilience-lab.co.jp?subject=BCP診断後のご相談（${encodeURIComponent(company)}）&body=BCP診断レポートを拝見しました。詳しいご説明をお願いいたします。" style="display:inline-block; background:#C8002D; color:white; padding:14px 36px; border-radius:8px; font-weight:bold; font-size:15px; text-decoration:none; margin-bottom:12px;">無料相談を申し込む →</a>
          <p style="color:#666; font-size:12px; margin:0;">平日9:00〜17:00 ／ contact@resilience-lab.co.jp</p>
        </div>

        <!-- 免責・コンプライアンス注記 -->
        <p style="font-size:11px; color:#bbb; line-height:1.7; margin:0; padding-top:16px; border-top:1px solid #eee;">
          ※ 本診断レポートは、ご回答いただいた内容に基づく簡易的な評価であり、貴社のBCP対策の完全性・十分性を保証するものではありません。実際の事業継続リスクや対策の妥当性については、専門家による詳細調査・評価をあわせてご検討ください。本レポートの内容を参考にされたことによる損害について、株式会社レジリエンスラボは責任を負いかねます。
        </p>
      </td></tr>

      <!-- フッター -->
      <tr><td style="padding:20px; text-align:center;">
        <p style="font-size:12px; color:#aaa; margin:0;">
          株式会社レジリエンスラボ｜<a href="https://resilab-jpn.com/" style="color:#aaa;">resilab-jpn.com</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// レジリエンスラボ社内向け通知メール
function buildNotifyText({ company, dept, name, email, tel, size, totalScore, level, catPcts, submittedAt }) {
  const submitted = submittedAt
    ? new Date(submittedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    : '不明';
  const domainRows = CATEGORIES.map((cat, i) => `  ${cat}: ${catPcts?.[i] ?? 0}点`).join('\n');
  return `【BCP診断ツール】新規リードが届きました

■ 受信日時: ${submitted}

■ お客様情報
  会社名  : ${company}
  部署名  : ${dept || '—'}
  担当者名: ${name}
  メール  : ${email}
  電話    : ${tel || '—'}
  従業員数: ${size || '—'}

■ 診断結果
  総合スコア: ${totalScore ?? '—'} 点 / 100点
  総合レベル: ${level ?? '—'}

■ 領域別スコア
${domainRows}

──────────────────────
※ 顧客へのAIレポートは自動送信済みです。
`.trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company, dept, name, email, tel, size, totalScore, level, catPcts, submittedAt } = req.body;

  if (!company || !name || !email) {
    return res.status(400).json({ error: '必須項目が不足しています' });
  }

  // Resend API クライアントを初期化
  const resend = new Resend(process.env.RESEND_API_KEY);

  // AIレポート生成
  let report;
  try {
    report = await generateReport({ company, size, totalScore, level, catPcts });
  } catch (err) {
    console.error('Claude APIエラー:', err);
    report = {
      summary: `${company}様のBCP診断結果をお届けします。総合スコアは${totalScore}点（${level}）でした。詳細な改善提案については、弊社担当者よりご連絡いたします。`,
      strengths: [],
      weakPoints: [],
      top3Actions: ['BCPの担当者・責任者を明確にする', '安否確認の仕組みを整備する', '重要業務とその目標復旧時間（RTO）を設定する'],
      closing: 'BCPの整備は一歩一歩の積み重ねです。レジリエンスラボがしっかりとサポートいたします。お気軽にご相談ください。',
    };
  }

  const errors = [];

  // 顧客へのレポートメール送信
  try {
    const html = buildCustomerHtml({ company, name, totalScore, level, catPcts, report });
    await resend.emails.send({
      from: 'レジリエンスラボ BCP診断 <report-noreply@resilab-jpn.com>',
      to: email,
      bcc: process.env.NOTIFY_EMAIL || 'info@resilab-jpn.com', // 社内控えとして同じレポートを保存
      subject: `【BCP診断レポート】${company}様 — 総合スコア${totalScore}点（${level}）`,
      html,
    });
  } catch (err) {
    console.error('顧客メール送信エラー:', err);
    errors.push('customer_mail_failed');
  }

  // レジリエンスラボへの通知メール送信
  try {
    await resend.emails.send({
      from: 'BCP診断ツール <report-noreply@resilab-jpn.com>',
      to: process.env.NOTIFY_EMAIL || 'info@resilab-jpn.com',
      subject: `【新規リード】${company} 様 — スコア${totalScore}点（${level}）`,
      text: buildNotifyText({ company, dept, name, email, tel, size, totalScore, level, catPcts, submittedAt }),
    });
  } catch (err) {
    console.error('通知メール送信エラー:', err);
    errors.push('notify_mail_failed');
  }

  // メール失敗時もデータをログに残す
  if (errors.length > 0) {
    console.log('診断データバックアップ:', JSON.stringify(req.body));
  }

  return res.status(200).json({ ok: true, warnings: errors });
};
