const {
  authAdmin, loadCompanies, saveCompanies,
  hashPassword, deriveCompanyToken,
} = require('../stockpile/_helpers');

module.exports = async (req, res) => {
  if (!authAdmin(req)) return res.status(401).json({ error: '管理者認証が必要です' });

  try {
    // 会社一覧取得
    if (req.method === 'GET') {
      const { companies } = await loadCompanies();
      // パスワードハッシュ・トークンは返さない
      const safe = companies.map(({ code, name, created }) => ({ code, name, created }));
      return res.json(safe);
    }

    // 会社追加
    if (req.method === 'POST') {
      const { code, name, password } = req.body || {};
      if (!code || !name || !password) {
        return res.status(400).json({ error: 'code・name・password が必要です' });
      }
      if (!/^[a-z0-9-]+$/.test(code)) {
        return res.status(400).json({ error: 'codeは半角英数字とハイフンのみ使用可能です' });
      }

      const { companies, sha } = await loadCompanies();
      if (companies.find(c => c.code === code)) {
        return res.status(409).json({ error: 'その会社コードはすでに使用されています' });
      }

      companies.push({
        code,
        name,
        passwordHash: hashPassword(code, password),
        tokenHash: deriveCompanyToken(code, password),
        created: new Date().toISOString().slice(0, 10),
      });

      await saveCompanies(companies, sha);
      return res.json({ ok: true, code, name });
    }

    // 会社削除
    if (req.method === 'DELETE') {
      const { code } = req.body || {};
      if (!code) return res.status(400).json({ error: 'code が必要です' });

      const { companies, sha } = await loadCompanies();
      const filtered = companies.filter(c => c.code !== code);
      if (filtered.length === companies.length) {
        return res.status(404).json({ error: '会社が見つかりません' });
      }

      await saveCompanies(filtered, sha);
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (err) {
    console.error('admin/companies エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
};
