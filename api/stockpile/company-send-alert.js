const { loadCompanies, authCompany, loadCompanyData } = require('./_helpers');
const { sendAlertWithResend } = require('./send-alert');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const companyCode = req.query.company;
  if (!companyCode) return res.status(400).json({ error: '会社コードが必要です' });

  try {
    const { companies } = await loadCompanies();
    const company = companies.find(c => c.code === companyCode);
    if (!company) return res.status(404).json({ error: '会社が見つかりません' });
    if (!authCompany(req, company.tokenHash)) {
      return res.status(401).json({ error: '認証が必要です' });
    }

    const { data } = await loadCompanyData(companyCode);
    const result = await sendAlertWithResend(data, companyCode);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('company-send-alert エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
};
