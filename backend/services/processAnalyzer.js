import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// 🔧 JSON Extraction Helper
function extractJSON(text) {
    if (!text) return null;

    try {
        // Entferne Markdown-Blöcke
        const cleaned = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        // 🔥 Versuch direkt zu parsen
        return JSON.parse(cleaned);

    } catch (err) {
        console.warn("⚠️ Direct parse failed, trying fallback...");

        // 🔥 Fallback: JSON im Text suchen
        const match = text.match(/\{[\s\S]*\}/);

        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e) {
                console.error("❌ Fallback JSON parse failed");
            }
        }

        console.error("❌ Could not extract valid JSON");
        console.log("🔍 RAW OUTPUT:\n", text);

        return null;
    }
}

export async function analyzeText(text) {

    const prompt = `
Extract a BPMN process.

STRICT RULES:
- Output ONLY valid JSON
- No markdown
- No explanation
- No text before or after JSON

Schema:
{
  "steps":[
    {"id":"start","type":"startEvent","name":"Start"},
    {"id":"task1","type":"task","name":"Example"},
    {"id":"end","type":"endEvent","name":"End"}
  ],
  "flows":[
    {"from":"start","to":"task1"},
    {"from":"task1","to":"end"}
  ]
}

Text:
${text}
`;

    const response = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.2, // 🔥 stabilere Outputs
        messages: [
            { role: "user", content: prompt }
        ]
    });

    const raw = response.choices[0]?.message?.content;

    console.log("🧠 RAW AI RESPONSE:\n", raw);

    const parsed = extractJSON(raw);

    // 🛡️ HARTE VALIDIERUNG
    if (
        !parsed ||
        !Array.isArray(parsed.steps) ||
        !Array.isArray(parsed.flows)
    ) {
        throw new Error("Invalid AI response structure");
    }

    return parsed;
}