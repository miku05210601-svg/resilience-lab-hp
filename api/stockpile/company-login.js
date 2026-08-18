const { loadCompanies, hashPassword, deriveCompanyToken } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const companyCode = req.query.company;
  const { password } = req.body || {};

  if (!companyCode) return res.status(400).json({ error: '会社コードが必要です' });
  if (!password) return res.status(400).json({ error: 'パスワードが必要です' });

  try {
    const { companies } = await loadCompanies();
    const company = companies.find(c => c.code === companyCode);
    if (!company) return res.status(404).json({ error: '会社が見つかりません' });

    const inputHash = hashPassword(companyCode, password);
    if (inputHash !== company.passwordHash) {
      return res.status(401).json({ error: 'パスワードが違います' });
    }

    if (company.expiresAt) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const exp   = new Date(company.expiresAt);
      if (today > exp) {
        return res.status(403).json({ error: 'デモ期間が終了しました。お問い合わせは resilab-jpn.com まで。' });
      }
    }

    res.json({ token: company.tokenHash, companyName: company.name });
  } catch (err) {
    console.error('company-login エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
};
