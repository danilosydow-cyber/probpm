import knowledgeBase from "../data/bpmnKnowledgeBase.json" with { type: "json" };

function normalizeQueryValue(value) {
    return String(value || "").trim().toLowerCase();
}

export function getBpmnKnowledgeBase({ category, level, search } = {}) {
    const categoryNeedle = normalizeQueryValue(category);
    const levelNeedle = normalizeQueryValue(level);
    const searchNeedle = normalizeQueryValue(search);

    let instructions = Array.isArray(knowledgeBase.instructions) ? [...knowledgeBase.instructions] : [];

    if (categoryNeedle) {
        instructions = instructions.filter((entry) => normalizeQueryValue(entry.category) === categoryNeedle);
    }
    if (levelNeedle) {
        instructions = instructions.filter((entry) => normalizeQueryValue(entry.level) === levelNeedle);
    }
    if (searchNeedle) {
        instructions = instructions.filter((entry) => {
            const haystack = [
                entry.title,
                entry.guideline,
                entry.rationale,
                entry.category
            ].map(normalizeQueryValue).join(" ");
            return haystack.includes(searchNeedle);
        });
    }

    return {
        ...knowledgeBase,
        instructions
    };
}
