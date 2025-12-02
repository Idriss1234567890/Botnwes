const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PAGE_TOKEN = process.env.PAGE_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// 🛡️ إعدادات طلب Axios لمحاكاة متصفح حقيقي (ضروري لتجنب الحظر)
const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
    }
};

// ----------------------------------------------------------------------
// التحقق من الويب هوك (Webhook Verification)
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
        return res.send(req.query["hub.challenge"]);
    }
    res.status(403).send("Error: wrong validation token");
});

// ----------------------------------------------------------------------
// استقبال رسائل المستخدم (Receiving Messages)
app.post("/webhook", async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const event = entry?.messaging?.[0];
        const sender = event?.sender?.id;

        // قراءة النص الوارد وتحويله إلى حروف صغيرة مع إزالة الفراغات الزائدة
        const text = event?.message?.text?.trim()?.toLowerCase();
        
        if (text && sender) {
            await handleUserMessage(sender, text);
        }

        res.sendStatus(200);
    } catch (e) {
        console.error("Webhook Error:", e);
        res.sendStatus(200);
    }
});

// ----------------------------------------------------------------------
// معالجة رسالة المستخدم (Handling User Message)
async function handleUserMessage(sender, text) {
    
    // 1. معالجة أمر 'list'
    if (text === 'list') {
        await sendMessage(sender, { text: "للبحث عن أنمي، أرسل اسمه بالإنجليزية (مثال: One Piece).\n\nلطلب حلقة معينة، أرسل اسم الأنمي متبوعًا برقم الحلقة (مثال: One Piece 3)" });
        return;
    }

    // 2. معالجة طلب حلقة (اسم ورقم)
    // النمط يبحث عن أي نص يليه مسافة ورقم في النهاية
    const episodeMatch = text.match(/^(.*)\s+(\d+)$/);

    if (episodeMatch) {
        // [1] اسم الأنمي
        const name = episodeMatch[1].trim().replace(/ /g, "-"); 
        // [2] رقم الحلقة
        const ep = episodeMatch[2];
        
        await getEpisode(sender, name, ep);
        return;
    }

    // 3. معالجة طلب معلومات أنمي (الاسم فقط)
    const slug = text.replace(/ /g, "-");
    await getAnimeInfo(sender, slug);
}

// ----------------------------------------------------------------------
// جلب معلومات الأنمي (Get Anime Info)
async function getAnimeInfo(sender, slug) {
    const url = `https://anime3rb.com/titles/${slug}`;
    
    try {
        // 🚀 إرسال الطلب مع User-Agent
        const html = await axios.get(url, axiosConfig); 
        const $ = cheerio.load(html.data);
        
        const title = $("meta[property='og:title']").attr("content");
        if (!title || title.includes("Page Not Found")) {
             throw new Error("Anime not found or 404 page received.");
        }
        
        const desc = $("meta[property='og:description']").attr("content") || 'لا يوجد وصف متاح.';
        const image = $("meta[property='og:image']").attr("content"); // جلب رابط الصورة
        
        // جلب البيانات من صفحة الأنمي
        const rating = $(".text-yellow-500").first().text().trim() || 'غير متوفر';
        const status = $("span:contains('الحالة')").next().text().trim() || 'غير متوفر';
        const studio = $("span:contains('الاستوديو')").next().text().trim() || 'غير متوفر';
        const author = $("span:contains('المؤلف')").next().text().trim() || 'غير متوفر';
        const age = $("span:contains('التصنيف العمري')").next().text().trim() || 'غير متوفر';

        const infoMessage = 
            `📌 *${title}* \n\n` + 
            `⭐ التقييم: ${rating}\n` + 
            `📅 الحالة: ${status}\n` + 
            `🎬 الاستوديو: ${studio}\n` + 
            `✍ المؤلف: ${author}\n` + 
            `🔞 التصنيف العمري: ${age}\n\n` + 
            `📜 القصة:\n${desc}`;


        // رسالة معلومات الأنمي
        await sendMessage(sender, { text: infoMessage });

        // زر مرفق برابط "عرض الحلقات"
        await sendButton(sender, "عرض الحلقات على الموقع", url);
        
    } catch (e) {
        console.error(`Error fetching info for ${slug}:`, e.message);
        await sendMessage(sender, { text: `❌ لم أستطع العثور على الأنمي باسم: ${slug}. تأكد من إدخال الاسم الإنجليزي الصحيح.` });
    }
}

// ----------------------------------------------------------------------
// جلب روابط الحلقة (Get Episode Links)
async function getEpisode(sender, slug, ep) {
    const url = `https://anime3rb.com/episode/${slug}/${ep}`;
    
    try {
        // 1. طلب صفحة الحلقة مع User-Agent
        const html = await axios.get(url, axiosConfig);
        const data = html.data;

        // 2. استخراج وفك تشفير رابط المشغل
        // البحث عن الترميز: video_url&quot;:&quot;
        const START_MARKER = 'video_url&quot;:&quot;';
        const END_MARKER = '&quot;';

        let i1 = data.indexOf(START_MARKER);
        
        if (i1 === -1) {
             // إذا لم يتم العثور على الترميز، احتمال أن تكون الحلقة غير موجودة
             throw new Error("Video URL marker not found.");
        }
        
        let start = i1 + START_MARKER.length;
        let end = data.indexOf(END_MARKER, start);
        
        if (end === -1) {
             throw new Error("Could not find end of encoded URL");
        }
        
        // فك التشفير الأساسي: (استبدال السلاش المهربة و &amp;)
        let encodedURL = data.substring(start, end)
            .replace(/\\\//g, "/") 
            .replace(/&amp;/g, "&"); 

        if (!encodedURL) {
            throw new Error("Encoded URL is empty");
        }
        
        // 3. إرسال طلب إلى رابط المشغل المفكوك
        const playerHTML = await axios.get(encodedURL, axiosConfig);
        const text2 = playerHTML.data;

        // 4. استخراج روابط المشاهدة من JSON
        const BLOCK = "var video_sources = ";
        const b1 = text2.lastIndexOf(BLOCK);

        let results = [];

        if (b1 !== -1) {
            let jsonPart = text2.substring(b1 + BLOCK.length);
            // قطع الجزء الزائد بعد نهاية مصفوفة JSON
            jsonPart = jsonPart.split("];")[0] + "]"; 

            // فك تشفير السلاش في JSON
            jsonPart = jsonPart.replace(/\\\//g, "/"); 

            const arr = JSON.parse(jsonPart);

            arr.forEach(v => {
                if (v.src && v.label) {
                    results.push({
                        quality: v.label,
                        url: v.src.replace(/&amp;/g, "&") // فك تشفير نهائي
                    });
                }
            });
        }
        
        if (results.length === 0) {
             await sendMessage(sender, { text: "❌ لم يتم العثور على أي روابط مشاهدة بجودة محددة في ملف المشغل." });
             return;
        }

        let msg = `🎥 روابط مشاهدة *${slug.replace(/-/g, " ")}* - الحلقة *${ep}*:\n\n`;
        results.forEach(r => {
            msg += `💠 *${r.quality}*:\n${r.url}\n\n`;
        });
        
        // إرسال رسالة بروابط المشاهدة
        await sendMessage(sender, { text: msg });
        
        // زر فتح رابط الحلقة مباشرة على الموقع
        const episodeWebUrl = `https://anime3rb.com/episode/${slug}/${ep}`;
        await sendButton(sender, "مشاهدة الحلقة على الموقع", episodeWebUrl);


    } catch (err) {
        console.error(`Error in getEpisode for ${slug}/${ep}:`, err.message);
        await sendMessage(sender, { text: `❌ حدث خطأ أثناء جلب الحلقة رقم ${ep} للأنمي ${slug.replace(/-/g, " ")}. قد تكون الحلقة غير موجودة أو هناك مشكلة في الاستخراج.` });
    }
}

// ----------------------------------------------------------------------
// إرسال رسالة نصية (Send Text Message)
async function sendMessage(sender, payload) {
    if (!PAGE_TOKEN) throw new Error("PAGE_TOKEN is not set.");
    return axios.post(
        `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_TOKEN}`,
        {
            recipient: { id: sender },
            message: payload
        }
    );
}

// ----------------------------------------------------------------------
// إرسال زر مرفق برابط (Send URL Button)
async function sendButton(sender, title, url) {
    if (!PAGE_TOKEN) throw new Error("PAGE_TOKEN is not set.");
    return axios.post(
        `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_TOKEN}`,
        {
            recipient: { id: sender },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: title,
                        buttons: [
                            {
                                type: "web_url",
                                url: url,
                                title: "فتح الرابط"
                            }
                        ]
                    }
                }
            }
        }
    );
}

app.listen(PORT, () => console.log(`BOT Running on port ${PORT}`));
