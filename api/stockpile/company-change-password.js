const {
  loadCompanies, saveCompanies,
  hashPassword, deriveCompanyToken,
  authCompany,
} = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const companyCode = req.query.company;
  const { currentPassword, newPassword } = req.body || {};

  if (!companyCode)       return res.status(400).json({ error: '会社コードが必要です' });
  if (!currentPassword)   return res.status(400).json({ error: '現在のパスワードが必要です' });
  if (!newPassword)       return res.status(400).json({ error: '新しいパスワードが必要です' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });

  try {
    const { companies, sha } = await loadCompanies();
    const idx = companies.findIndex(c => c.code === companyCode);
    if (idx === -1) return res.status(404).json({ error: '会社が見つかりません' });

    const company = companies[idx];

    // ① ログイン済みトークンで認証
    if (!authCompany(req, company.tokenHash)) {
      return res.status(401).json({ error: '認証が必要です。再ログインしてください' });
    }

    // ② 現在パスワードの照合
    const currentHash = hashPassword(companyCode, currentPassword);
    if (currentHash !== company.passwordHash) {
      return res.status(401).json({ error: '現在のパスワードが違います' });
    }

    // ③ 新しいハッシュを計算して保存
    companies[idx].passwordHash = hashPassword(companyCode, newPassword);
    companies[idx].tokenHash    = deriveCompanyToken(companyCode, newPassword);

    await saveCompanies(companies, sha);

    // ④ 新しいトークンを返す（フロントで sessionStorage を更新する）
    res.json({ token: companies[idx].tokenHash });
  } catch (err) {
    console.error('company-change-password エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
};
