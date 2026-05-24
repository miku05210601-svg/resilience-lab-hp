const { getAdminToken } = require('../stockpile/_helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'ADMIN_PASSWORD が未設定です' });
  if (password !== expected) return res.status(401).json({ error: 'パスワードが違います' });
  res.json({ token: getAdminToken() });
};
