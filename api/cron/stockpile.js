const { loadStockpile } = require('../stockpile/_helpers');
const { sendAlertWithResend } = require('../stockpile/send-alert');

module.exports = async (req, res) => {
  // Vercel Cron からのリクエストのみ許可
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: '不正なリクエストです' });
  }

  try {
    const { data } = await loadStockpile();
    const result = await sendAlertWithResend(data);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
