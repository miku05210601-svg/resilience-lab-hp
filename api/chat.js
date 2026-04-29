const Anthropic = require('@anthropic-ai/sdk');

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

module.exports = async (req, res) => {
  // POSTのみ受け付ける
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messagesが必要です' });
  }

  // SSEヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
};
