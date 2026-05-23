require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function test() {
  console.log('📧 メール送信テスト開始...');
  console.log(`送信元: ${process.env.SMTP_USER}`);
  console.log(`送信先: ${process.env.NOTIFY_EMAIL}`);
  console.log(`SMTPサーバー: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);

  try {
    await transporter.sendMail({
      from: `"BCP診断テスト" <${process.env.SMTP_USER}>`,
      to: 'miku0521.0601@gmail.com',
      subject: '【テスト】BCP診断ツール メール送信確認',
      text: 'このメールはBCP診断ツールのメール送信テストです。正常に届いていれば設定は完了です。',
    });
    console.log('✅ 送信成功！miku0521.0601@gmail.com を確認してください。');
  } catch (err) {
    console.error('❌ 送信失敗:', err.message);
  }
}

test();
