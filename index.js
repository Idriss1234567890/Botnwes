import express from "express";
import axios from "axios";
import cheerio from "cheerio";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PAGE_TOKEN = process.env.PAGE_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ----------------------------------------------------------------------
// 1. Webhook Verify
// ----------------------------------------------------------------------
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === VERIFY_TOKEN) {
        return res.send(req.query["hub.challenge"]);
    }
    res.send("Error: wrong validation token");
});

// ----------------------------------------------------------------------
// 2. Handle Incoming Messages
// ----------------------------------------------------------------------
app.post("/webhook", async (req, res) => {
    try {
        const entry = req.body.entry?.[0];
        const event = entry.messaging?.[0];
        const sender = event.sender.id;

        const text = event.message?.text?.toLowerCase();

        if (text) {
            await handleUserMessage(sender, text);
        }

        res.sendStatus(200);
    } catch (e) {
        console.log("Webhook Error:", e);
        res.sendStatus(200);
    }
});

// ----------------------------------------------------------------------
// 3. Router: Detect Anime Name or Episode
// ----------------------------------------------------------------------
async function handleUserMessage(sender, text) {
    const isEpisode = text.match(/(.*)\s+(\d+)$/);

    if (isEpisode) {
        const name = isEpisode[1].trim().replace(/ /g, "-");
        const ep = isEpisode[2];
        await getEpisode(sender, name, ep);
        return;
    }

    const slug = text.replace(/ /g, "-");
    await getAnimeInfo(sender, slug);
}

// ----------------------------------------------------------------------
// 4. Get Anime Info
// ----------------------------------------------------------------------
async function getAnimeInfo(sender, slug) {
    try {
        const url = `https://anime3rb.com/titles/${slug}`;
        const html = await axios.get(url);
        const $ = cheerio.load(html.data);

        const title = $("meta[property='og:title']").attr("content");
        const desc = $("meta[property='og:description']").attr("content");

        const rating = $(".text-yellow-500").first().text().trim();
        const status = $("span:contains('الحالة')").next().text().trim();
        const studio = $("span:contains('الاستوديو')").next().text().trim();
        const author = $("span:contains('المؤلف')").next().text().trim();
        const age = $("span:contains('التصنيف العمري')").next().text().trim();

        await sendMessage(sender, {
            text: `📌 *${title}*\n\n⭐ التقييم: ${rating}\n📜 القصة: ${desc}\n🎬 الاستوديو: ${studio}\n✍ المؤلف: ${author}\n📅 الحالة: ${status}\n🔞 التصنيف العمري: ${age}`
        });

        await sendButton(sender, "عرض الحلقات", `https://anime3rb.com/titles/${slug}`);
    } catch (err) {
        await sendMessage(sender, { text: "❌ لم أستطع العثور على الأنمي" });
    }
}

// ----------------------------------------------------------------------
// 5. Get Episode Video Sources
// ----------------------------------------------------------------------
async function getEpisode(sender, slug, ep) {
    try {
        const url = `https://anime3rb.com/episode/${slug}/${ep}`;
        const html = await axios.get(url);
        const data = html.data;

        const START = 'video_url&quot;:&quot;';
        const END = '&quot;';

        let i1 = data.indexOf(START);
        if (i1 === -1) {
            await sendMessage(sender, { text: "❌ لم أجد رابط المشغل" });
            return;
        }

        let start = i1 + START.length;
        let end = data.indexOf(END, start);

        let encoded = data.substring(start, end)
            .replace(/\\\//g, "/")
            .replace(/&amp;/g, "&");

        const playerHTML = await axios.get(encoded);
        const text2 = playerHTML.data;

        const BLOCK = "var video_sources = ";
        const b1 = text2.lastIndexOf(BLOCK);

        let results = [];

        if (b1 !== -1) {
            let jsonPart = text2.substring(b1 + BLOCK.length);
            jsonPart = jsonPart.split("];")[0] + "]";

            jsonPart = jsonPart.replace(/\\\//g, "/");

            const arr = JSON.parse(jsonPart);

            arr.forEach(v => {
                results.push({
                    quality: v.label,
                    url: v.src
                });
            });
        }

        let msg = "🎥 روابط المشاهدة:\n\n";
        results.forEach(r => {
            msg += `💠 *${r.quality}*\n${r.url}\n\n`;
        });

        await sendMessage(sender, { text: msg });

    } catch (err) {
        console.log(err);
        await sendMessage(sender, { text: "❌ حدث خطأ أثناء جلب الحلقة" });
    }
}

// ----------------------------------------------------------------------
// 6. Send Text Message
// ----------------------------------------------------------------------
async function sendMessage(sender, payload) {
    return axios.post(
        `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_TOKEN}`,
        {
            recipient: { id: sender },
            message: payload
        }
    );
}

// ----------------------------------------------------------------------
// 7. Send Button
// ----------------------------------------------------------------------
async function sendButton(sender, title, url) {
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

app.listen(3000, () => console.log("BOT Running"));
