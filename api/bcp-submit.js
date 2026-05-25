const { Resend } = require('resend');

// Googleスプレッドシートに診断データを記録
async function saveToSheet(data) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error('スプレッドシート記録エラー:', err);
  }
}

const CATEGORIES = [
  '経営・体制',
  'リスク認識',
  '重要業務・連絡体制',
  '設備・物理対策',
  'IT・データ',
  'サプライチェーン',
  '訓練・維持管理',
];

// ===== 損失試算 =====

// 業種 × 従業員数レンジ → 推計年商（百万円）
const REVENUE_BY_INDUSTRY = {
  '製造業':       { '〜20名':50,  '21〜50名':200,  '51〜100名':600,  '101〜300名':2000, '301〜1,000名':8000,  '1,001名以上':50000 },
  '卸売業・小売業':{ '〜20名':80,  '21〜50名':300,  '51〜100名':800,  '101〜300名':3000, '301〜1,000名':12000, '1,001名以上':60000 },
  '建設業':       { '〜20名':60,  '21〜50名':250,  '51〜100名':700,  '101〜300名':2500, '301〜1,000名':10000, '1,001名以上':40000 },
  '情報通信業':   { '〜20名':60,  '21〜50名':220,  '51〜100名':600,  '101〜300名':2000, '301〜1,000名':8000,  '1,001名以上':40000 },
  '医療・福祉':   { '〜20名':40,  '21〜50名':150,  '51〜100名':400,  '101〜300名':1500, '301〜1,000名':6000,  '1,001名以上':30000 },
  '金融・保険':   { '〜20名':100, '21〜50名':400,  '51〜100名':1000, '101〜300名':4000, '301〜1,000名':15000, '1,001名以上':80000 },
  '運輸・物流':   { '〜20名':50,  '21〜50名':200,  '51〜100名':500,  '101〜300名':1800, '301〜1,000名':7000,  '1,001名以上':35000 },
  'サービス業':   { '〜20名':30,  '21〜50名':120,  '51〜100名':350,  '101〜300名':1200, '301〜1,000名':5000,  '1,001名以上':25000 },
  'その他':       { '〜20名':40,  '21〜50名':160,  '51〜100名':450,  '101〜300名':1600, '301〜1,000名':6000,  '1,001名以上':30000 },
};

// 年商テキスト → 中央値（百万円）
const REVENUE_TEXT_TO_MAN = {
  '〜1億円':      50,
  '1億〜5億円':   300,
  '5億〜10億円':  750,
  '10億〜50億円': 3000,
  '50億〜100億円':7500,
  '100億円以上':  20000,
};

/**
 * 年商推計（百万円）
 * - annualRevenue が入力されていればその中央値
 * - なければ 業種 × 従業員数レンジから推計
 */
function estimateRevenueMillion(annualRevenue, industry, size) {
  if (annualRevenue && REVENUE_TEXT_TO_MAN[annualRevenue]) {
    return { value: REVENUE_TEXT_TO_MAN[annualRevenue], isInput: true };
  }
  const ind = industry || 'その他';
  const sz  = size || '51〜100名';
  const table = REVENUE_BY_INDUSTRY[ind] || REVENUE_BY_INDUSTRY['その他'];
  const value = table[sz] ?? 450;
  return { value, isInput: false };
}

/**
 * 3シナリオ損失試算
 * 期待損失 ≈ 発生確率 × 損失率 × 年商
 * BCPスコアが低いほど損失率が高くなる補正をかける
 * @returns {Array} 3シナリオの試算結果
 */
function calcLossScenarios(revenueMillion, totalScore) {
  // BCPスコアによる損失倍率（スコアが低いほど被害が大きい）
  const scoreFactor = totalScore >= 80 ? 0.4
                    : totalScore >= 60 ? 0.7
                    : totalScore >= 40 ? 1.0
                    : 1.4;

  const scenarios = [
    {
      name: '大規模自然災害',
      icon: '🌊',
      prob: '10年に1回（10%/年）',
      lossRate: 0.30,  // 売上の30%相当
      stopDays: totalScore >= 60 ? '約30〜90日' : '約90〜180日',
      intangible: '取引先への信頼失墜・従業員の離職・ブランド毀損',
    },
    {
      name: 'サイバー攻撃・システム障害',
      icon: '💻',
      prob: '5年に1回（20%/年）',
      lossRate: 0.15,
      stopDays: totalScore >= 60 ? '約3〜14日' : '約14〜60日',
      intangible: '情報漏洩による賠償リスク・顧客離れ・株価下落',
    },
    {
      name: 'パンデミック・感染症拡大',
      icon: '🦠',
      prob: '20年に1回（5%/年）',
      lossRate: 0.20,
      stopDays: totalScore >= 60 ? '約14〜30日' : '約30〜90日',
      intangible: '採用ブランド低下・取引先の代替調達・官公庁評価への影響',
    },
  ];

  return scenarios.map(s => {
    const financialLossMillion = Math.round(revenueMillion * s.lossRate * scoreFactor);
    return {
      ...s,
      financialLoss: financialLossMillion >= 10000
        ? `約${(financialLossMillion / 10000).toFixed(1)}億円`
        : `約${financialLossMillion.toLocaleString()}百万円`,
      financialLossNum: financialLossMillion,
    };
  });
}

// パターンベースで改善提案レポートを生成（Claude API 不使用・同期処理）
function generateReport({ company, totalScore, level, catPcts }) {
  const lLetter = level?.match(/[ABCD]/)?.[0] ?? 'D';

  // レベル別 総評
  const SUMMARIES = {
    A: `${company}様のBCP対策は非常に高い水準にあります。7つの領域にわたり組織的な備えができており、業界でもトップクラスの対策レベルといえます。この優れた取り組みを維持しながら、さらなる高度化・実効性向上を目指していきましょう。`,
    B: `${company}様のBCP対策は良好な水準にあります。基本的な取り組みは整っていますが、一部の領域にさらなる強化の余地があります。重点領域への取り組みを加速させることで、より実効性の高い体制が実現できます。`,
    C: `${company}様のBCP対策は現在改善の途上にあります。診断により課題のある領域が明確になりました。優先順位をつけて一つずつ対策を進めていくことで、確実にレベルアップできます。多くの企業がこの段階から本格的な取り組みを始めています。`,
    D: `${company}様のBCPはこれから整備していく段階にあります。まず現状を正確に把握できたことが最初の一歩です。ゼロから始める企業ほど対策の効果が大きく出ます。優先度の高いことから着実に進めていきましょう。`,
  };

  // レベル別 締めメッセージ
  const CLOSINGS = {
    A: `高い水準のBCP対策を維持されていることは、企業の信頼性向上にも直結します。レジリエンスラボは、さらなる高度化に向けてともに歩んでまいります。`,
    B: `BCPの整備は着実に進んでいます。あと一歩の強化で、より実効性の高い体制が整います。レジリエンスラボが全力でサポートいたします。`,
    C: `BCPの整備に取り組む姿勢そのものが、企業の強さになります。一つひとつ確実に進めていきましょう。レジリエンスラボがしっかりとサポートいたします。`,
    D: `まず現状を知ることから始めることが大切です。今日の診断がその第一歩です。レジリエンスラボが伴走しながらサポートいたします。`,
  };

  // カテゴリ別アクションパターン（低/中/高 スコア対応）
  const ACTION_PATTERNS = [
    // 0: 経営・体制
    { low: '防災・事業継続の担当者を指名し、経営会議で推進を正式に宣言する', mid: '経営層向けの事業継続説明資料を作成し、次回役員会で方針を承認してもらう', high: '年1回の方針レビューを経営カレンダーに組み込む' },
    // 1: リスク認識
    { low: '自社事業所のハザードマップを確認し、想定リスクを箇条書きで整理する', mid: 'リスクを「発生確率×影響度」で評価し、対策の優先順位を決める', high: '年1回のリスク棚卸しを定例化し、新たなリスクを見直す' },
    // 2: 重要業務・連絡体制
    { low: '緊急連絡先リスト（全社員・主要取引先）を作成し担当者に共有する', mid: '災害時に継続すべき最重要業務（上位3つ）と業務再開の目標期日を設定する', high: '緊急連絡先リストを半期ごとに更新する仕組みをつくる' },
    // 3: 設備・物理対策
    { low: '社員3日分の飲料水・非常食を調達し、保管場所を決める', mid: '備蓄品リストを整備し、停電対策（蓄電池・ポータブル電源・無停電電源装置等）の検討を始める', high: '備蓄品の補充・点検を年1回の定例作業に組み込む。備蓄品の配布や運用を計画・訓練する' },
    // 4: IT・データ
    { low: '重要データのクラウドバックアップを設定する', mid: 'バックアップからの復旧テストを実施し、手順書を作成する', high: 'システム停止時の代替手順を文書化し全員に周知する' },
    // 5: サプライチェーン
    { low: '主要取引先（上位5社）の連絡先と代替候補をリスト化する', mid: '重要仕入先の事業継続状況を確認し、連携体制を整える', high: '代替調達先との基本契約・優先交渉権の確保を進める' },
    // 6: 訓練・維持管理
    { low: '全社員向けの研修を実施し、災害対応の基本知識を共有する', mid: '年1回の災害対策本部訓練＋研修を組み合わせた実践プログラムを企画・実施する', high: '訓練・研修の振り返りを記録し、毎回内容を改善するサイクルをつくる' },
  ];

  // 各カテゴリの現在スコアに応じたアクションを取得
  const catActions = ACTION_PATTERNS.map((p, i) => {
    const pct = catPcts?.[i] ?? 0;
    const action = pct >= 70 ? p.high : pct >= 40 ? p.mid : p.low;
    return { cat: i, name: CATEGORIES[i], pct, action };
  });

  // スコアが低い順にソートし、上位3つを優先アクションとして抽出
  const sortedByScore = [...catActions].sort((a, b) => a.pct - b.pct);
  const top3Actions = sortedByScore.slice(0, 3).map(c => `【${c.name}】${c.action}`);

  // 強み（70点以上、最大2つ）
  const strengths = catActions
    .filter(c => c.pct >= 70)
    .map(c => `${c.name}（${c.pct}点）：この領域の取り組みは高い水準にあります。`)
    .slice(0, 2);

  // 優先改善領域（70点未満、最大3つ）
  const weakPoints = sortedByScore
    .filter(c => c.pct < 70)
    .slice(0, 3)
    .map(c => ({
      area: c.name,
      comment: c.pct < 40 ? 'この領域は早急な対応が必要です。' : 'さらなる改善の余地があります。',
      action: ACTION_PATTERNS[c.cat][c.pct >= 40 ? 'mid' : 'low'],
    }));

  return {
    summary: SUMMARIES[lLetter] ?? SUMMARIES.D,
    strengths,
    weakPoints,
    top3Actions,
    closing: CLOSINGS[lLetter] ?? CLOSINGS.D,
  };
}

// 顧客向けHTMLメール本文を生成
function buildCustomerHtml({ company, name, totalScore, level, catPcts, report, lossScenarios, revenueInfo }) {
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

  // ※ cat4（IT・データ）はパートナー対応のため非表示
  const IMPROVE_SERVICES = [
    { cat: 0, name: 'BCP体制づくり支援', icon: '📋',
      desc: '誰が何をするかを決めるところから、専門コンサルタントが伴走してサポートします。' },
    { cat: 1, name: 'リスク評価・詳細診断', icon: '🔍',
      desc: '自社に潜むリスクを洗い出し、どのリスクから優先的に対応すべきかを明確にします。' },
    { cat: 2, name: '社員向けBCP教育・研修', icon: '🎓',
      desc: '「BCPって何？」という段階から、経営層・管理職・全社員それぞれのレベルに合わせた研修を提供します。' },
    { cat: 3, name: '設備・備蓄対策支援', icon: '🏗️',
      desc: '備蓄品の整備計画から、停電・断水時の業務継続対策まで、物理的な備えを専門家が支援します。' },
    { cat: 5, name: '取引先との連携強化支援', icon: '🔗',
      desc: '主要な仕入先・取引先の事業継続状況を確認し、万が一の際の代替調達先確保を支援します。' },
    { cat: 6, name: '防災訓練・シミュレーション演習', icon: '🏃',
      desc: '安否確認訓練・災害対応演習など、学んだことを実際の行動に落とし込む実践的プログラムを提供します。' },
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
      <tr><td style="background:#C8002D; padding:20px 32px 16px; border-radius:12px 12px 0 0;">
        <img src="https://resilience-lab-hp.vercel.app/bcp-check/resilab_logo.png" alt="レジリエンスラボ" style="height:32px; width:auto; filter:brightness(0) invert(1); margin-bottom:10px; display:block;">
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

        <!-- リスクシナリオ別 損失試算 -->
        ${lossScenarios ? `
        <div style="margin-bottom:32px;">
          <h2 style="font-size:16px; color:#C8002D; border-bottom:2px solid #C8002D; padding-bottom:8px; margin:0 0 8px;">■ BCP未整備の場合のリスクシナリオ別 損失試算</h2>
          <div style="background:#fffbe6; border:1px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:16px;">
            <p style="font-size:12px; color:#92400e; margin:0; line-height:1.8;">
              ⚠️ <strong>注意：この試算はあくまで参考値です</strong><br>
              推計年商（約${revenueInfo.value >= 10000 ? (revenueInfo.value/10000).toFixed(1)+'億円' : revenueInfo.value+'百万円'}／${revenueInfo.isInput ? 'ご入力値' : '従業員数・業種からの推計値'}）をもとに、保険数理的アプローチで算出した概算です。実際の損失額は、拠点数・事業構成・既存の対策状況・被災規模などにより大きく異なります。本数値は「何も対策しなかった場合のリスクの大きさ感」を把握する目的でご参照ください。投資判断・保険設計等の根拠としてそのままご使用にならないようご注意ください。
            </p>
          </div>
          ${lossScenarios.map(s => `
          <div style="border:1px solid #eee; border-radius:10px; padding:16px; margin-bottom:12px; background:#fafafa;">
            <p style="font-size:15px; font-weight:bold; color:#1a1a2e; margin:0 0 10px;">${s.icon} ${s.name}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr>
                <td style="color:#888; width:120px; padding:4px 0;">発生確率の目安</td>
                <td style="color:#333; padding:4px 0;">${s.prob}</td>
              </tr>
              <tr>
                <td style="color:#888; padding:4px 0;">推計 財務的損失</td>
                <td style="color:#C8002D; font-weight:bold; font-size:15px; padding:4px 0;">${s.financialLoss}</td>
              </tr>
              <tr>
                <td style="color:#888; padding:4px 0;">事業停止期間</td>
                <td style="color:#333; padding:4px 0;">${s.stopDays}</td>
              </tr>
              <tr>
                <td style="color:#888; padding:4px 0; vertical-align:top;">無形損失</td>
                <td style="color:#555; padding:4px 0; line-height:1.6;">${s.intangible}</td>
              </tr>
            </table>
          </div>`).join('')}
        </div>` : ''}

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
          <a href="mailto:info@resilab-jpn.com?subject=${encodeURIComponent('BCP診断後のご相談（' + company + '様）')}&body=${encodeURIComponent('BCP診断を実施しました。詳細について、説明してください。\n\n■希望日時（複数ご提示ください）\n\n\n■希望形式：オンライン／対面\n（対面の場合は場所をお知らせください）')}" style="display:inline-block; background:#C8002D; color:white; padding:14px 36px; border-radius:8px; font-weight:bold; font-size:15px; text-decoration:none; margin-bottom:12px;">無料相談を申し込む →</a>
          <p style="color:#666; font-size:12px; margin:0;">平日9:00〜17:00 ／ info@resilab-jpn.com</p>
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
function buildNotifyText({ company, dept, name, email, tel, size, industry, annualRevenue, totalScore, level, catPcts, submittedAt, lossScenarios, revenueInfo }) {
  const submitted = submittedAt
    ? new Date(submittedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    : '不明';
  const domainRows = CATEGORIES.map((cat, i) => `  ${cat}: ${catPcts?.[i] ?? 0}点`).join('\n');
  const revText = revenueInfo
    ? `  推計年商  : 約${revenueInfo.value >= 10000 ? (revenueInfo.value/10000).toFixed(1)+'億円' : revenueInfo.value+'百万円'}（${revenueInfo.isInput ? '入力値' : '従業員数・業種から推計'}）`
    : '';
  const lossRows = lossScenarios
    ? '\n■ 損失試算（推計）\n' + lossScenarios.map(s => `  ${s.name}: ${s.financialLoss}`).join('\n')
    : '';
  return `【BCP診断ツール】新規リードが届きました

■ 受信日時: ${submitted}

■ お客様情報
  会社名  : ${company}
  部署名  : ${dept || '—'}
  担当者名: ${name}
  メール  : ${email}
  電話    : ${tel || '—'}
  業種    : ${industry || '—'}
  従業員数: ${size || '—'}
  年商目安: ${annualRevenue || '未入力'}
${revText}

■ 診断結果
  総合スコア: ${totalScore ?? '—'} 点 / 100点
  総合レベル: ${level ?? '—'}

■ 領域別スコア
${domainRows}
${lossRows}

──────────────────────
※ 顧客へのAIレポートは自動送信済みです。
`.trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { company, dept, name, email, tel, size, industry, annualRevenue, totalScore, level, catPcts, submittedAt } = req.body;

  if (!company || !name || !email) {
    return res.status(400).json({ error: '必須項目が不足しています' });
  }

  // 損失試算
  const revenueInfo = estimateRevenueMillion(annualRevenue, industry, size);
  const lossScenarios = calcLossScenarios(revenueInfo.value, totalScore ?? 30);

  // Resend API クライアントを初期化
  const resend = new Resend(process.env.RESEND_API_KEY);

  // パターンベースでレポート生成（同期処理・高速）
  const report = generateReport({ company, totalScore, level, catPcts });

  const errors = [];

  // 顧客へのレポートメール送信
  let customerMailResult = null;
  try {
    const html = buildCustomerHtml({ company, name, totalScore, level, catPcts, report, lossScenarios, revenueInfo });
    customerMailResult = await resend.emails.send({
      from: 'レジリエンスラボ BCP診断 <report-noreply@resilab-jpn.com>',
      to: email,
      bcc: 'mitou@resilab-jpn.com',
      subject: `【BCP診断レポート】${company}様 — 総合スコア${totalScore}点（${level}）`,
      html,
    });
    console.log('顧客メール送信結果:', JSON.stringify(customerMailResult));
  } catch (err) {
    console.error('顧客メール送信エラー:', err.message, err.name);
    errors.push('customer_mail_failed');
    customerMailResult = { error: err.message };
  }

  // レジリエンスラボへの通知メール送信
  try {
    await resend.emails.send({
      from: 'BCP診断ツール <report-noreply@resilab-jpn.com>',
      to: process.env.NOTIFY_EMAIL || 'info@resilab-jpn.com',
      subject: `【新規リード】${company} 様 — スコア${totalScore}点（${level}）`,
      text: buildNotifyText({ company, dept, name, email, tel, size, industry, annualRevenue, totalScore, level, catPcts, submittedAt, lossScenarios, revenueInfo }),
    });
  } catch (err) {
    console.error('通知メール送信エラー:', err);
    errors.push('notify_mail_failed');
  }

  // Googleスプレッドシートにデータを記録
  await saveToSheet({ company, dept, name, email, tel, size, industry, annualRevenue, totalScore, level, catPcts, submittedAt });

  // メール失敗時もデータをログに残す
  if (errors.length > 0) {
    console.log('診断データバックアップ:', JSON.stringify(req.body));
  }

  return res.status(200).json({ ok: true, warnings: errors, _debug: { customerMailResult, to: email } });
};
