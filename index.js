import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PAGE_TOKEN = process.env.PAGE_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// إعدادات طلب Axios لمحاكاة متصفح حقيقي
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
        await sendMessage(sender, { text: "للبحث عن أنمي، أرسل اسمه بالإنجليزية (مثل: One Piece). \n\nللبحث عن حلقة، أرسل اسم الأنمي متبوعًا برقم الحلقة (مثل: One Piece 3)" });
        return;
    }

    // 2. معالجة طلب حلقة (اسم ورقم)
    // النمط يبحث عن أي نص يليه مسافة ورقم في النهاية
    const episodeMatch = text.match(/^(.*)\s+(\d+)$/);

    if (episodeMatch) {
        // [1] هو اسم الأنمي (قد يحتوي على مسافات)
        const name = episodeMatch[1].trim().replace(/ /g, "-"); 
        // [2] هو رقم الحلقة
        const ep = episodeMatch[2];
        
        await getEpisode(sender, name, ep);
        return;
    }

    // 3. معالجة طلب معلومات أنمي (الاسم فقط)
    // يتم تحويل المسافات إلى شُرط (-) ليصبح slug
    const slug = text.replace(/ /g, "-");
    await getAnimeInfo(sender, slug);
}

// ----------------------------------------------------------------------
// جلب معلومات الأنمي (Get Anime Info)
async function getAnimeInfo(sender, slug) {
    try {
        const url = `https://anime3rb.com/titles/${slug}`;
        
        // إرسال الطلب مع User-Agent
        const html = await axios.get(url, axiosConfig); 
        const $ = cheerio.load(html.data);
        
        // تأكد من وجود العنوان قبل استكمال الاستخراج
        const title = $("meta[property='og:title']").attr("content");
        if (!title) {
             throw new Error("Title not found, likely 404");
        }
        
        const desc = $("meta[property='og:description']").attr("content");
        const image = $("meta[property='og:image']").attr("content"); // إضافة جلب رابط الصورة
        
        // جلب البيانات من صفحة الأنمي
        const rating = $(".text-yellow-500").first().text().trim();
        const status = $("span:contains('الحالة')").next().text().trim();
        const studio = $("span:contains('الاستوديو')").next().text().trim();
        const author = $("span:contains('المؤلف')").next().text().trim();
        const age = $("span:contains('التصنيف العمري')").next().text().trim();

        const infoMessage = `
            📌 *${title}*
            
            ${image ? `` : ''}
            
            ⭐ التقييم: ${rating}
            📅 الحالة: ${status}
            🎬 الاستوديو: ${studio}
            ✍ المؤلف: ${author}
            🔞 التصنيف العمري: ${age}
            
            📜 القصة:
            ${desc}
        `.trim();


        await sendMessage(sender, { text: infoMessage });

        // إرسال زر حلقات تهو
        await sendButton(sender, "عرض الحلقات على الموقع", url);
        
    } catch (e) {
        console.error(`Error fetching info for ${slug}:`, e.message);
        await sendMessage(sender, { text: `❌ لم أستطع العثور على الأنمي باسم: ${slug} أو حدث خطأ. تأكد من إدخال اسم الأنمي بالإنجليزية كما هو في الرابط.` });
    }
}

// ----------------------------------------------------------------------
// جلب روابط الحلقة (Get Episode Links)
async function getEpisode(sender, slug, ep) {
    try {
        const url = `https://anime3rb.com/episode/${slug}/${ep}`;
        
        // 1. طلب صفحة الحلقة مع User-Agent
        const html = await axios.get(url, axiosConfig);
        const data = html.data;

        // 2. استخراج وفك تشفير رابط المشغل
        // الموقع يستخدم &quot; ترميزاً بدلاً من علامات الاقتباس (")
        const START = 'video_url&quot;:&quot;';
        const END = '&quot;';

        let i1 = data.indexOf(START);
        if (i1 === -1) {
             // محاولة البحث عن الترميز البديل (في حال تغير الموقع)
            const START_ALT = 'video_url":"';
            i1 = data.indexOf(START_ALT);
            if (i1 === -1) {
                await sendMessage(sender, { text: "❌ لم أجد رابط المشغل في صفحة الحلقة. تأكد من توفر الحلقة أو قد يكون هناك خطأ في الموقع." });
                return;
            }
            // إذا وجد الترميز البديل، يجب تعديل نقطة البداية والنهاية
            i1 = i1 + START_ALT.length;
            end = data.indexOf('"', i1);
        } else {
            i1 = i1 + START.length;
            end = data.indexOf(END, i1);
        }
        
        if (end === -1) {
             throw new Error("Could not find end of encoded URL");
        }
        
        // فك التشفير الأساسي (استبدال السلاش المهربة و &amp;)
        let encodedURL = data.substring(i1, end)
            .replace(/\\\//g, "/") 
            .replace(/&amp;/g, "&"); 

        if (!encodedURL) {
            throw new Error("Encoded URL is empty");
        }

        // 3. إرسال طلب إلى رابط المشغل المفكوك
        // مهم: إرسال الطلب بنفس User-Agent
        const playerHTML = await axios.get(encodedURL, axiosConfig);
        const text2 = playerHTML.data;

        // 4. استخراج روابط المشاهدة من JSON
        const BLOCK = "var video_sources = ";
        const b1 = text2.lastIndexOf(BLOCK);

        let results = [];

        if (b1 !== -1) {
            let jsonPart = text2.substring(b1 + BLOCK.length);
            // البحث عن نهاية مصفوفة JSON
            jsonPart = jsonPart.split("];")[0] + "]"; 

            // فك تشفير السلاش في JSON
            jsonPart = jsonPart.replace(/\\\//g, "/"); 

            const arr = JSON.parse(jsonPart);

            arr.forEach(v => {
                // التأكد من وجود رابط صالح قبل إضافته
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

        let msg = `🎥 روابط مشاهدة *${slug}* - الحلقة *${ep}*:\n\n`;
        results.forEach(r => {
            msg += `💠 *${r.quality}*:\n${r.url}\n\n`;
        });
        
        // إرسال رسالة بروابط المشاهدة
        await sendMessage(sender, { text: msg });
        
        // إضافة الزر المطلوب الذي يفتح رابط الحلقة مباشرة على الموقع
        const episodeWebUrl = `https://anime3rb.com/episode/${slug}/${ep}`;
        await sendButton(sender, "مشاهدة الحلقة على الموقع", episodeWebUrl);


    } catch (err) {
        console.error(`Error in getEpisode for ${slug}/${ep}:`, err);
        await sendMessage(sender, { text: "❌ حدث خطأ أثناء جلب الحلقة. قد تكون الحلقة غير موجودة أو هناك مشكلة مؤقتة في الاستخراج." });
    }
}

// ----------------------------------------------------------------------
// إرسال رسالة نصية (Send Text Message)
async function sendMessage(sender, payload) {
    // التأكد من أن العنوان موجود، وإلا ارمي خطأ
    if (!PAGE_TOKEN) {
        throw new Error("PAGE_TOKEN is not set in .env file.");
    }
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
    if (!PAGE_TOKEN) {
        throw new Error("PAGE_TOKEN is not set in .env file.");
    }
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
