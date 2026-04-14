import { sanitizeTaskKind } from "../bpmnSemantics.js";

function compactLabel(value, maxWords = 3) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) return "";
    const words = text.split(" ");
    return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

function normalizeRoleName(value) {
    return compactLabel(value, 3);
}

function classifyConditionLabel(label) {
    const value = String(label || "").trim().toLowerCase();
    if (!value) return "other";
    const hasNegation = /\b(nicht|kein|keine|ohne|un|inaktiv|ungueltig|ungültig)\b/i.test(value);
    if (/\b(nicht\s+genehmigt|nicht\s+freigegeben|nicht\s+ok|not\s+approved)\b/i.test(value)) return "no";
    if (/\b(nicht\s+abgelehnt|not\s+rejected)\b/i.test(value)) return "yes";
    if (/(^|\b)(ja|yes|ok|true|freigabe|genehmigt)(\b|$)/i.test(value)) return "yes";
    if (/(^|\b)(nein|no|false|abgelehnt)(\b|$)/i.test(value)) return "no";
    if (hasNegation) return "no";
    return "other";
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
        const kind = String(step?.taskKind || "task").trim().toLowerCase();
        if (!label || !role) return null;
        return `${role}::${label}::${kind}`;
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
        if (Array.isArray(step.boundaryTimers)) {
            step.boundaryTimers = step.boundaryTimers.map((bt) => ({
                ...bt,
                target: typeof bt?.target === "string" ? resolveId(bt.target) : bt.target
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

function normalizeEmailBlock(email) {
    if (!email || typeof email !== "object") return undefined;
    const out = {};
    for (const key of ["to", "recipient", "cc", "bcc", "from", "sender", "subject", "template", "body"]) {
        if (email[key] != null && typeof email[key] === "string") {
            const trimmed = email[key].trim();
            if (trimmed) {
                if (key === "recipient") out.to = trimmed;
                else if (key === "sender") out.from = trimmed;
                else out[key] = trimmed;
            }
        }
    }
    if (email.noBcsStyling === true) out.noBcsStyling = true;
    return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeBoundaryTimersOnStep(step, validIds) {
    if (!Array.isArray(step.boundaryTimers)) return { ...step, boundaryTimers: [] };
    const cleaned = [];
    step.boundaryTimers.forEach((bt) => {
        const target = typeof bt?.target === "string" ? bt.target : "";
        if (!validIds.has(target)) return;
        cleaned.push({
            label: compactLabel(bt?.label || "Timer", 3) || "Timer",
            target,
            interrupting: bt.interrupting !== false,
            duration: typeof bt?.duration === "string" ? bt.duration.trim().slice(0, 80) : undefined
        });
    });
    return { ...step, boundaryTimers: cleaned };
}

function normalizeAnnotationsBlock(json) {
    const steps = json.steps || [];
    const validIds = new Set(steps.map((s) => s?.id).filter(Boolean));
    const raw = json.annotations;
    if (!Array.isArray(raw)) {
        json.annotations = [];
        return;
    }
    let n = 0;
    json.annotations = raw
        .filter((a) => a && typeof a.attachTo === "string" && validIds.has(a.attachTo))
        .map((a) => {
            n += 1;
            const idRaw = typeof a.id === "string" ? a.id.trim() : "";
            const safeId = idRaw && /^[A-Za-z_][A-Za-z0-9_]*$/.test(idRaw) ? idRaw : `ann_${n}`;
            return {
                id: safeId,
                text: compactLabel(String(a.text ?? a.label ?? "").trim(), 24) || "Hinweis",
                attachTo: a.attachTo
            };
        });
}

function applyBpmnStandards(json) {
    const steps = Array.isArray(json.steps) ? json.steps : [];
    const validIds = new Set(steps.map((s) => s?.id).filter(Boolean));

    // Canonicalize step types and keep end events terminal.
    steps.forEach((step) => {
        const t = String(step?.type || "").trim().toLowerCase();
        if (t === "gateway") step.type = "gateway";
        else if (t === "end" || t === "endevent") step.type = "end";
        else step.type = "task";

        if (step.type === "end") {
            step.next = [];
            step.conditions = [];
            delete step.taskKind;
            delete step.email;
            delete step.boundaryTimers;
            delete step.documentation;
        }
    });

    let syntheticCounter = 1;
    const nextSyntheticEndId = () => {
        let id = `step_end_auto_${syntheticCounter}`;
        while (validIds.has(id)) {
            syntheticCounter += 1;
            id = `step_end_auto_${syntheticCounter}`;
        }
        syntheticCounter += 1;
        validIds.add(id);
        return id;
    };

    const ensureEndForStep = (sourceStep, mode = "task") => {
        const endId = nextSyntheticEndId();
        steps.push({
            id: endId,
            type: "end",
            label: "Ende",
            role: sourceStep.role
        });
        if (mode === "gateway") {
            sourceStep.conditions = [
                ...(Array.isArray(sourceStep.conditions) ? sourceStep.conditions : []),
                { label: "Weiter", target: endId }
            ];
        } else {
            sourceStep.next = [endId];
        }
    };

    steps.forEach((step) => {
        if (step.type === "gateway") {
            const conditions = Array.isArray(step.conditions) ? step.conditions : [];
            const deduped = [];
            const seenTargets = new Set();
            conditions.forEach((cond) => {
                const target = cond?.target;
                if (typeof target !== "string" || !validIds.has(target)) return;
                if (target === step.id || seenTargets.has(target)) return;
                seenTargets.add(target);
                deduped.push({
                    label: compactLabel(cond?.label || "Bedingung", 2),
                    target
                });
            });

            if (deduped.length === 2) {
                const firstKind = classifyConditionLabel(deduped[0].label);
                const secondKind = classifyConditionLabel(deduped[1].label);
                if (firstKind === "other" && secondKind === "other") {
                    deduped[0].label = "Ja";
                    deduped[1].label = "Nein";
                }
            }
            step.next = [];
            step.conditions = deduped;
            if (step.conditions.length === 0) {
                ensureEndForStep(step, "gateway");
            }
        }
    });

    steps.forEach((step) => {
        if (step.type === "end") return;
        const hasNext = Array.isArray(step.next) && step.next.length > 0;
        const hasConditions = Array.isArray(step.conditions) && step.conditions.length > 0;
        if (!hasNext && !hasConditions) {
            ensureEndForStep(step, step.type === "gateway" ? "gateway" : "task");
        }
    });

    if (!steps.some((step) => step.type === "end")) {
        const fallbackRole = json.roles?.[0] || "System";
        steps.push({
            id: nextSyntheticEndId(),
            type: "end",
            label: "Ende",
            role: fallbackRole
        });
    }

    json.steps = steps;
}

function applyCorrectionLoopHeuristics(json) {
    const steps = Array.isArray(json.steps) ? json.steps : [];
    if (steps.length === 0) return;
    const byId = new Map(steps.map((step) => [step.id, step]));
    const correctionRegex = /(korrig|korrektur|nacharbeit|nachbearbeit|klaer|klär|fehlerbeheb)/i;
    const checkRegex = /(pruef|prüf|validier|bewert|kontroll|review)/i;
    const completionRegex = /(abschluss|beend|ende|kommuniz|informier|versend)/i;

    const findNearestCheckBefore = (gatewayIndex) => {
        for (let i = gatewayIndex - 1; i >= 0; i -= 1) {
            const step = steps[i];
            if (!step || step.type !== "task") continue;
            const label = String(step.label || "");
            if (checkRegex.test(label)) return step;
        }
        return null;
    };

    steps.forEach((step, gatewayIndex) => {
        if (step.type !== "gateway") return;
        const conditions = Array.isArray(step.conditions) ? step.conditions : [];
        if (conditions.length < 2) return;

        const yesCond = conditions.find((cond) => classifyConditionLabel(cond?.label) === "yes");
        const noCond = conditions.find((cond) => classifyConditionLabel(cond?.label) === "no");
        if (!yesCond || !noCond) return;

        const yesTarget = byId.get(yesCond.target);
        const noTarget = byId.get(noCond.target);
        const yesIsCorrection = correctionRegex.test(String(yesTarget?.label || ""));
        const noIsCorrection = correctionRegex.test(String(noTarget?.label || ""));
        const yesLooksCompletion = completionRegex.test(String(yesTarget?.label || ""));
        const noLooksCompletion = completionRegex.test(String(noTarget?.label || ""));

        // Swap only with strong evidence to avoid damaging valid special cases.
        const highEvidenceSwap =
            yesIsCorrection
            && !noIsCorrection
            && (noLooksCompletion || yesTarget?.type === "task");
        if (highEvidenceSwap) {
            const temp = yesCond.target;
            yesCond.target = noCond.target;
            noCond.target = temp;
        }

        const correctedNoTarget = byId.get(noCond.target);
        const noStillCorrection = correctionRegex.test(String(correctedNoTarget?.label || ""));
        if (!noStillCorrection || correctedNoTarget?.type !== "task") return;

        const nearestCheck = findNearestCheckBefore(gatewayIndex);
        if (!nearestCheck?.id) return;
        if (completionRegex.test(String(nearestCheck?.label || ""))) return;

        // Enforce local correction loop to the nearest relevant check/validation step.
        correctedNoTarget.next = [nearestCheck.id];
        correctedNoTarget.conditions = [];
    });
}

export function normalizeProcessJson(processJson) {
    const normalized = JSON.parse(JSON.stringify(processJson));
    const semanticSteps = Array.isArray(normalized?._semanticIR?.steps) ? normalized._semanticIR.steps : [];
    const semanticById = new Map(semanticSteps.map((step) => [step?.id, step]));
    const processFlags = Array.isArray(normalized?._semanticIR?.processFlags) ? normalized._semanticIR.processFlags : [];
    const topLevelAmbiguity = Array.isArray(normalized?._ambiguityFlags) ? normalized._ambiguityFlags : [];

    normalized.steps = (normalized.steps || []).map((step) => {
        const type = step?.type === "start" || step?.type === "startEvent" ? "task" : step?.type;
        return { ...step, type };
    });

    normalized.roles = (normalized.roles || []).map((role) => compactLabel(role, 3) || "Rolle");

    normalized.steps = (normalized.steps || []).map((step, index) => {
        const semantic = semanticById.get(step?.id) || {};
        const t = String(step?.type || "").toLowerCase();
        const isActivity = t !== "gateway" && t !== "end" && t !== "endevent";
        const nextStep = {
            ...step,
            role: semantic?.role || step?.role,
            label: compactLabel(step?.label || semantic?.activity, 3) || `Schritt ${index + 1}`
        };
        if (Array.isArray(semantic?.dependsOn) && semantic.dependsOn.length > 0) {
            nextStep._dependsOn = semantic.dependsOn.filter((id) => typeof id === "string");
        }
        if (Array.isArray(semantic?.ambiguityFlags) && semantic.ambiguityFlags.length > 0) {
            nextStep._ambiguityFlags = [...new Set(semantic.ambiguityFlags)];
        }
        if (semantic?.statusHint) {
            nextStep._statusHint = String(semantic.statusHint);
        }
        if (isActivity) {
            nextStep.taskKind = sanitizeTaskKind(step?.taskKind);
            const doc = typeof step?.documentation === "string" ? step.documentation.trim() : "";
            const semanticDoc = semantic?.statusHint ? `Statushinweis: ${semantic.statusHint}` : "";
            if (doc) {
                nextStep.documentation = `${doc}${semanticDoc ? `\n${semanticDoc}` : ""}`.slice(0, 2000);
            } else if (semanticDoc) {
                nextStep.documentation = semanticDoc;
            } else {
                delete nextStep.documentation;
            }
            const email = normalizeEmailBlock(step?.email);
            if (email) nextStep.email = email;
            else delete nextStep.email;
        } else {
            delete nextStep.taskKind;
            delete nextStep.email;
            delete nextStep.boundaryTimers;
            delete nextStep.documentation;
        }
        return nextStep;
    });

    normalizeConnections(normalized);
    buildConsistentRoles(normalized);
    mergeDuplicateTasksByLabel(normalized);
    removeTransitiveDirectEdges(normalized);
    applyBpmnStandards(normalized);
    applyCorrectionLoopHeuristics(normalized);
    normalizeConnections(normalized);

    const validIdsAfter = new Set(normalized.steps.map((s) => s?.id).filter(Boolean));
    normalized.steps = normalized.steps.map((step) => {
        const t = String(step?.type || "").toLowerCase();
        if (t === "gateway" || t === "end" || t === "endevent") return step;
        return normalizeBoundaryTimersOnStep(step, validIdsAfter);
    });

    normalizeAnnotationsBlock(normalized);
    normalized.analysisMeta = {
        ambiguityFlags: [...new Set([...processFlags, ...topLevelAmbiguity])],
        semanticVersion: normalized?._semanticIR?.version || "none"
    };
    delete normalized._semanticIR;
    delete normalized._ambiguityFlags;
    return normalized;
}
