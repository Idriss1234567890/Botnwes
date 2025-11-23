// api/webhook.js
const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// استخدام body-parser لمعالجة JSON
app.use(bodyParser.json());

// التوكن السري الذي ستستخدمه في إعداد Webhook على فيسبوك
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; 
// توكن الوصول للصفحة لـ Messenger API
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; 

// 1. مسار التحقق من Webhook (GET)
app.get('/api/webhook', (req, res) => {
    // تحقق من أن البارامترات المطلوبة موجودة
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // تحقق من وضع 'subscribe' ومن مطابقة التوكن
    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            // نجاح التحقق: أعد قيمة الـ 'challenge'
            console.log('Webhook Verified!');
            res.status(200).send(challenge);
        } else {
            // فشل التحقق
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400); // طلب غير مكتمل
    }
});

// 2. مسار معالجة رسائل Webhook (POST)
app.post('/api/webhook', (req, res) => {
    const data = req.body;

    // تأكد من أن الحدث جاء من Messenger
    if (data.object === 'page') {
        data.entry.forEach(entry => {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            // يمكنك هنا استدعاء دالة لمعالجة الرسائل
            if (webhook_event.message) {
                handleMessage(sender_psid, webhook_event.message);
            }
        });

        // يجب أن ترجع حالة 200 لفيسبوك لتجنب إعادة إرسال الحدث
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// دالة لمعالجة الرسائل (تحتاج لتنفيذ منطق البوت الخاص بك هنا)
function handleMessage(senderPsid, receivedMessage) {
    // ... منطق معالجة الرسائل والنشر على فيسبوك هنا ...
    console.log(`Received message from PSID: ${senderPsid}`);
    
    // مثال: إرسال رد بسيط (يتطلب مكتبة axios أو fetch)
    // const requestBody = { ... };
    // axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, requestBody)
}

// تصدير التطبيق ليتم استخدامه كوظيفة بلا خادم على Vercel
module.exports = app;
