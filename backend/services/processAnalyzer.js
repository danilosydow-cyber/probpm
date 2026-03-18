import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";

// 🔑 OpenAI Client (funktioniert mit sk-proj- Keys)
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function analyzeProcess(text) {
    // ❌ Fehler wenn kein Text
    if (!text || text.trim() === "") {
        throw new Error("Kein Text übergeben");
    }

    try {
        console.log("📥 Eingehender Text:", text);

        // 🔥 OpenAI Request (NEUE API!)
        const response = await client.responses.create({
            model: "gpt-4.1-mini",
            input: `
Du bist ein BPMN-Experte.

Analysiere den folgenden Prozess und gib eine strukturierte Liste von Schritten zurück.

Format:
1. Schritt 1
2. Schritt 2
3. Schritt 3

Prozess:
${text}
      `
        });

        // ✅ Antwort sauber extrahieren
        const result = response.output[0].content[0].text;

        console.log("🤖 AI Antwort:", result);

        return result;

    } catch (error) {
        console.error("❌ OpenAI Fehler:", error);

        throw new Error(
            error?.message || "Fehler bei der Prozessanalyse"
        );
    }
}