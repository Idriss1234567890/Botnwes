const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');

// يجب تعريف هذه المتغيرات في إعدادات البيئة (Environment Variables) في Vercel
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ----------------------------------------------------------------------
// دالة مساعدة لإرسال الردود إلى Messenger
// ----------------------------------------------------------------------
async function callSendAPI(senderPsid, response) {
    const requestBody = {
        "recipient": { "id": senderPsid },
        "message": response
    };

    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            requestBody
        );
    } catch (error) {
        console.error("Failed to send message to Facebook:", error.response ? error.response.data : error.message);
    }
}

// ----------------------------------------------------------------------
// دالة معالجة منطق Gemini وتحويل JSON إلى رسالة نصية بسيطة للرد
// ----------------------------------------------------------------------
async function handleAnimeRequest(animeName, senderPsid) {
    if (!GEMINI_API_KEY) {
        return callSendAPI(senderPsid, { text: "عذراً، مفتاح Gemini API غير موجود." });
    }
    
    // إرسال رسالة "جاري الكتابة..." لتهدئة المستخدم
    callSendAPI(senderPsid, { sender_action: "typing_on" });

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // نطلب من Gemini إنشاء JSON كامل كما طلبته، مع التركيز على اللغة العربية
        const prompt = `
        Act as an Anime Database API. I need information for the anime: "${animeName}".
        Generate a JSON object with the following keys. All text should be in ARABIC, except titles (name, name2) and technical keys (image, url, s, t, id).
        
        Required JSON Structure:
        {
            "image": "URL of the anime poster (must be a real URL)",
            "مصدر": "Source (e.g. مانجا)",
            "c": "Generate a random 10-digit number string",
            "g": "Genres in Arabic separated by ' / '",
            "مدة": "Duration per episode in Arabic",
            "h": "Status . Season Year . AgeRating (e.g., مكتمل . شتاء 2024 . +13)",
            "ep": "Type in Arabic (e.g., أنمي تلفزيوني)",
            "url": "A valid link to the anime",
            "sto": "A detailed story summary in Arabic.",
            "عدد_حلقات": "Total episodes + حلقة",
            "s": "Studio Name (English)",
            "t": "Score out of 10",
            "name": "Official English Title",
            "id": "MyAnimeList ID or empty",
            "name2": "Japanese Title",
            "fg": "مسلسل"
        }
        
        IMPORTANT: Return ONLY the JSON string. Do not include markdown like \`\`\`json.
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const animeData = JSON.parse(responseText);

        // تنسيق الرد إلى نص سهل القراءة في Messenger
        const replyMessage = 
            `**${animeData.name}** (${animeData.name2})\n` +
            `==========================\n` +
            `📺 التصنيف: ${animeData.g}\n` +
            `📚 المصدر: ${animeData.مصدر}\n` +
            `✨ الحالة: ${animeData.h}\n` +
            `🔢 عدد الحلقات: ${animeData.عدد_حلقات}\n` +
            `⭐ التقييم: ${animeData.t}/10\n` +
            `\n` +
            `📜 القصة:\n` +
            `${animeData.sto}\n\n` +
            `🔗 رابط الأنمي: ${animeData.url}`;
            
        // إرسال الرد إلى المستخدم
        callSendAPI(senderPsid, { text: replyMessage });
        
        // إرسال الصورة كبطاقة إذا كانت متوفرة (اختياري)
        if (animeData.image) {
             callSendAPI(senderPsid, { attachment: {
                 type: "image",
                 payload: { url: animeData.image }
             }});
        }

    } catch (error) {
        console.error("Processing Error:", error);
        callSendAPI(senderPsid, { 
            text: `عذراً، لم أتمكن من إيجاد معلومات الأنمي "${animeName}" أو حدث خطأ في المعالجة.`
        });
    }
}

// ----------------------------------------------------------------------
// الدالة الرئيسية لـ Webhook (Vercel Handler)
// ----------------------------------------------------------------------
module.exports = async (req, res) => {
    
    // 1. معالجة طلب التحقق (GET Request for Verification)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                // النجاح في التحقق
                return res.status(200).send(challenge);
            } else {
                // فشل الرمز
                return res.status(403).send("Verification token mismatch");
            }
        }
        // إذا لم يكن طلب تحقق، قم بالرد العادي
        return res.status(200).send("Anime Bot Webhook is running.");
    }
    
    // 2. معالجة رسائل المستخدم (POST Request for Messages)
    if (req.method === 'POST') {
        const body = req.body;
        
        if (body.object === 'page') {
            body.entry.forEach(entry => {
                const webhookEvent = entry.messaging[0];
                const senderPsid = webhookEvent.sender.id;

                if (webhookEvent.message && webhookEvent.message.text) {
                    const receivedText = webhookEvent.message.text.trim();
                    // تمرير اسم الأنمي لدالة المعالجة
                    handleAnimeRequest(receivedText, senderPsid);
                }
            });
            
            // يجب الرد بـ 200 OK فوراً لتجنب Timeout من فيسبوك
            return res.status(200).send('EVENT_RECEIVED');
        }
        return res.status(404).send('Not Found');
    }

    // الرد على أي طلبات أخرى غير GET/POST
    res.status(405).send('Method Not Allowed');
};
