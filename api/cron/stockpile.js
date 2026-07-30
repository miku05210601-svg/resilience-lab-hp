const { loadCompanies, loadCompanyData } = require('../stockpile/_helpers');
const { sendAlertWithResend } = require('../stockpile/send-alert');

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: '不正なリクエストです' });
  }

  try {
    const { companies } = await loadCompanies();
    const results = [];

    for (const company of companies) {
      try {
        const { data } = await loadCompanyData(company.code);
        const result = await sendAlertWithResend(data, company.code);
        results.push({ company: company.code, ...result });
      } catch (err) {
        results.push({ company: company.code, error: err.message });
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
