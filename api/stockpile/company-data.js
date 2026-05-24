const { loadCompanies, authCompany, loadCompanyData, saveCompanyData } = require('./_helpers');

module.exports = async (req, res) => {
  const companyCode = req.query.company;
  if (!companyCode) return res.status(400).json({ error: '会社コードが必要です' });

  try {
    // トークン検証
    const { companies } = await loadCompanies();
    const company = companies.find(c => c.code === companyCode);
    if (!company) return res.status(404).json({ error: '会社が見つかりません' });
    if (!authCompany(req, company.tokenHash)) {
      return res.status(401).json({ error: '認証が必要です' });
    }

    if (req.method === 'GET') {
      const { data } = await loadCompanyData(companyCode);
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { data, sha } = await loadCompanyData(companyCode);
      await saveCompanyData(companyCode, req.body, sha);
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (err) {
    console.error('company-data エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
};
