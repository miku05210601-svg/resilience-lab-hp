const { authCheck, loadStockpile, saveStockpile } = require('./_helpers');

module.exports = async (req, res) => {
  if (!authCheck(req)) return res.status(401).json({ error: '認証が必要です' });

  if (req.method === 'GET') {
    const { data } = await loadStockpile();
    return res.json(data);
  }

  if (req.method === 'POST') {
    const { data, sha } = await loadStockpile();
    await saveStockpile(req.body, sha);
    return res.json({ ok: true });
  }

  res.status(405).end();
};
