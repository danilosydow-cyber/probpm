import fs from "node:fs";
import path from "node:path";

const LEARNING_PATH = path.resolve(process.cwd(), "data", "bpmnQualityLearning.json");

function defaultLearningState() {
    return {
        version: "1.0.0",
        updatedAt: "",
        totalModelsEvaluated: 0,
        violationCounts: {},
        recentScores: []
    };
}

function loadLearningState() {
    try {
        const raw = fs.readFileSync(LEARNING_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return {
            ...defaultLearningState(),
            ...parsed,
            violationCounts: { ...(parsed?.violationCounts || {}) },
            recentScores: Array.isArray(parsed?.recentScores) ? parsed.recentScores : []
        };
    } catch {
        return defaultLearningState();
    }
}

function saveLearningState(state) {
    const safe = {
        ...defaultLearningState(),
        ...state,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(LEARNING_PATH, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
}

export function recordQualityScorecard(scorecard) {
    const state = loadLearningState();
    state.totalModelsEvaluated += 1;

    const violations = Array.isArray(scorecard?.violations) ? scorecard.violations : [];
    violations.forEach((violation) => {
        const code = String(violation?.code || "").trim();
        if (!code) return;
        state.violationCounts[code] = (state.violationCounts[code] || 0) + 1;
    });

    const newScoreEntry = {
        at: new Date().toISOString(),
        score: Number(scorecard?.score || 0),
        maxScore: Number(scorecard?.maxScore || 0),
        percent: Number(scorecard?.percent || 0),
        grade: String(scorecard?.grade || "E")
    };
    state.recentScores = [newScoreEntry, ...state.recentScores].slice(0, 25);
    saveLearningState(state);
    return state;
}

export function getQualityLearningHints(limit = 5) {
    const state = loadLearningState();
    const entries = Object.entries(state.violationCounts || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.max(1, limit));

    const hints = entries.map(([code, count]) => ({
        code,
        count,
        hint: `Fehler '${code}' trat ${count}x auf. Vermeide diesen Fehler in neuen Modellen.`
    }));

    return {
        totalModelsEvaluated: state.totalModelsEvaluated,
        recurringIssues: hints,
        recentScores: state.recentScores.slice(0, 5)
    };
}

export function buildLearningGuidanceText() {
    const learning = getQualityLearningHints(4);
    const recurring = learning.recurringIssues || [];
    if (recurring.length === 0) return "";

    const lines = recurring.map((entry) => `- ${entry.code}: ${entry.hint}`);
    return `LERNREGELN AUS FRUEHEREN MODELLEN:\n${lines.join("\n")}`;
}
