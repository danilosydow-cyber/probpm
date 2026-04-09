function compactLabel(value, maxWords = 3) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) return "";
    const words = text.split(" ");
    return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

function normalizeRoleName(value) {
    return compactLabel(value, 3);
}

function buildConsistentRoles(json) {
    const knownRoles = [];
    const roleIndex = new Map();

    const addRole = (roleName) => {
        const normalized = normalizeRoleName(roleName);
        if (!normalized) return null;
        const key = normalized.toLowerCase();
        if (!roleIndex.has(key)) {
            roleIndex.set(key, normalized);
            knownRoles.push(normalized);
        }
        return roleIndex.get(key);
    };

    (json.roles || []).forEach(addRole);
    (json.steps || []).forEach((step) => addRole(step?.role));

    if (knownRoles.length === 0) {
        knownRoles.push("System");
        roleIndex.set("system", "System");
    }

    json.roles = knownRoles;
    json.steps = (json.steps || []).map((step) => {
        const resolvedRole = addRole(step?.role) || knownRoles[0];
        return { ...step, role: resolvedRole };
    });
}

function normalizeConnections(json) {
    const steps = Array.isArray(json.steps) ? json.steps : [];
    const validIds = new Set(steps.map((step) => step?.id).filter(Boolean));

    json.steps = steps.map((step) => {
        const type = String(step?.type || "").trim();
        const isGateway = type === "gateway";

        const nextRaw = Array.isArray(step?.next) ? step.next : [];
        const nextUnique = [];
        const nextSeen = new Set();
        for (const target of nextRaw) {
            if (typeof target !== "string") continue;
            if (!validIds.has(target)) continue;
            if (target === step.id) continue;
            if (nextSeen.has(target)) continue;
            nextSeen.add(target);
            nextUnique.push(target);
        }

        const conditionsRaw = Array.isArray(step?.conditions) ? step.conditions : [];
        const conditionsUnique = [];
        const condSeenTargets = new Set();
        for (const cond of conditionsRaw) {
            const target = cond?.target;
            if (typeof target !== "string") continue;
            if (!validIds.has(target)) continue;
            if (target === step.id) continue;
            if (condSeenTargets.has(target)) continue;
            condSeenTargets.add(target);
            conditionsUnique.push({
                label: compactLabel(cond?.label || "Bedingung", 2),
                target
            });
        }

        if (isGateway) {
            return {
                ...step,
                next: [],
                conditions: conditionsUnique
            };
        }

        // Non-gateway: keep exactly one primary dependency to reduce noisy arrows.
        return {
            ...step,
            next: nextUnique.slice(0, 1),
            conditions: []
        };
    });
}

function hasAlternatePath(adjacency, source, target) {
    const queue = [source];
    const visited = new Set([source]);

    while (queue.length > 0) {
        const current = queue.shift();
        const neighbors = adjacency.get(current) || [];
        for (const next of neighbors) {
            if (next === target) return true;
            if (visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
    return false;
}

function mergeDuplicateTasksByLabel(json) {
    const steps = Array.isArray(json.steps) ? json.steps : [];
    const mergeKey = (step) => {
        const type = String(step?.type || "task").trim().toLowerCase();
        if (type === "gateway" || type === "end" || type === "endevent") return null;
        if (!step?.id) return null;
        const label = String(step?.label || "").trim().toLowerCase();
        const role = String(step?.role || "").trim().toLowerCase();
        if (!label || !role) return null;
        return `${role}::${label}`;
    };

    const canonicalIdByKey = new Map();
    const duplicateOf = new Map();

    steps.forEach((step) => {
        const k = mergeKey(step);
        if (!k) return;
        if (!canonicalIdByKey.has(k)) {
            canonicalIdByKey.set(k, step.id);
        } else if (canonicalIdByKey.get(k) !== step.id) {
            duplicateOf.set(step.id, canonicalIdByKey.get(k));
        }
    });

    if (duplicateOf.size === 0) return;

    const resolveId = (id) => {
        let cur = id;
        const guard = new Set();
        while (duplicateOf.has(cur) && !guard.has(cur)) {
            guard.add(cur);
            cur = duplicateOf.get(cur);
        }
        return cur;
    };

    steps.forEach((step) => {
        if (Array.isArray(step.next)) {
            step.next = [
                ...new Set(
                    step.next
                        .map((t) => (typeof t === "string" ? resolveId(t) : t))
                        .filter((t) => typeof t === "string" && t !== step.id)
                )
            ];
        }
        if (Array.isArray(step.conditions)) {
            step.conditions = step.conditions.map((cond) => ({
                ...cond,
                target: typeof cond?.target === "string" ? resolveId(cond.target) : cond.target
            }));
        }
    });

    json.steps = steps.filter((step) => !duplicateOf.has(step.id));

    json.steps.forEach((step) => {
        if (step.type !== "gateway" || !Array.isArray(step.conditions)) return;
        const seenTargets = new Set();
        step.conditions = step.conditions.filter((cond) => {
            const t = cond?.target;
            if (typeof t !== "string" || seenTargets.has(t)) return false;
            seenTargets.add(t);
            return true;
        });
    });
}

function removeTransitiveDirectEdges(json) {
    const steps = Array.isArray(json.steps) ? json.steps : [];
    const edges = [];

    steps.forEach((step) => {
        (Array.isArray(step.next) ? step.next : []).forEach((target) => {
            edges.push({ from: step.id, to: target, kind: "next" });
        });
        (Array.isArray(step.conditions) ? step.conditions : []).forEach((cond, idx) => {
            if (cond?.target) {
                edges.push({ from: step.id, to: cond.target, kind: "condition", conditionIndex: idx });
            }
        });
    });

    const keep = new Set(edges.map((_, idx) => idx));
    for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        const adjacency = new Map();
        edges.forEach((candidate, idx) => {
            if (idx === i || !keep.has(idx)) return;
            const list = adjacency.get(candidate.from) || [];
            list.push(candidate.to);
            adjacency.set(candidate.from, list);
        });

        if (hasAlternatePath(adjacency, edge.from, edge.to)) {
            keep.delete(i);
        }
    }

    json.steps = steps.map((step) => {
        const keptNext = (Array.isArray(step.next) ? step.next : []).filter((target) =>
            edges.findIndex((edge, idx) =>
                keep.has(idx)
                && edge.kind === "next"
                && edge.from === step.id
                && edge.to === target
            ) !== -1
        );

        const keptConditions = (Array.isArray(step.conditions) ? step.conditions : []).filter((cond) =>
            edges.findIndex((edge, idx) =>
                keep.has(idx)
                && edge.kind === "condition"
                && edge.from === step.id
                && edge.to === cond?.target
            ) !== -1
        );

        return {
            ...step,
            next: keptNext,
            conditions: keptConditions
        };
    });
}

export function normalizeProcessJson(processJson) {
    const normalized = JSON.parse(JSON.stringify(processJson));

    normalized.steps = (normalized.steps || []).map((step) => {
        const type = step?.type === "start" || step?.type === "startEvent" ? "task" : step?.type;
        return { ...step, type };
    });

    normalized.roles = (normalized.roles || []).map((role) => compactLabel(role, 3) || "Rolle");
    normalized.steps = (normalized.steps || []).map((step, index) => ({
        ...step,
        label: compactLabel(step?.label, 3) || `Schritt ${index + 1}`
    }));

    normalizeConnections(normalized);
    buildConsistentRoles(normalized);
    mergeDuplicateTasksByLabel(normalized);
    removeTransitiveDirectEdges(normalized);
    return normalized;
}
