import { buildRoutingDebug } from "./bpmnRoutingDebug.js";
import { analyzeBpmnDiagram } from "./bpmnDiagramMetrics.js";

function hasAtLeastOneEnd(steps) {
    return steps.some((step) => String(step?.type || "").toLowerCase() === "end");
}

function hasDuplicateStepIds(steps) {
    const seen = new Set();
    for (const step of steps) {
        const id = String(step?.id || "").trim();
        if (!id) continue;
        if (seen.has(id)) return true;
        seen.add(id);
    }
    return false;
}

function countDeadEnds(steps) {
    let deadEnds = 0;
    for (const step of steps) {
        const type = String(step?.type || "").toLowerCase();
        if (type === "end") continue;
        const nextCount = Array.isArray(step?.next) ? step.next.length : 0;
        const condCount = Array.isArray(step?.conditions) ? step.conditions.length : 0;
        if (nextCount + condCount === 0) deadEnds += 1;
    }
    return deadEnds;
}

function countInvalidGateways(steps) {
    let invalid = 0;
    for (const step of steps) {
        const type = String(step?.type || "").toLowerCase();
        if (type !== "gateway") continue;
        const condCount = Array.isArray(step?.conditions) ? step.conditions.length : 0;
        if (condCount < 2) invalid += 1;
    }
    return invalid;
}

function countUnclearGatewayLabels(steps) {
    let unclear = 0;
    for (const step of steps) {
        const type = String(step?.type || "").toLowerCase();
        if (type !== "gateway") continue;
        const conditions = Array.isArray(step?.conditions) ? step.conditions : [];
        for (const condition of conditions) {
            const label = String(condition?.label || "").trim();
            if (!label) {
                unclear += 1;
            }
        }
    }
    return unclear;
}

function countMissingRoles(steps) {
    return steps.filter((step) => !String(step?.role || "").trim()).length;
}

function buildCheck({ id, title, weight, ok, penaltyWhenFail, detail, violationCode, suggestion }) {
    const score = ok ? weight : Math.max(0, weight - penaltyWhenFail);
    const violations = ok ? [] : [{
        code: violationCode,
        title,
        detail,
        suggestion,
        weight
    }];
    return {
        id,
        title,
        weight,
        ok,
        score,
        detail,
        violations
    };
}

export function buildBpmnQualityScorecard(processJson, options = {}) {
    const steps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    const metrics = options?.diagramMetrics || analyzeBpmnDiagram(String(options?.xml || ""), processJson);

    const checks = [];

    const endExists = hasAtLeastOneEnd(steps);
    checks.push(buildCheck({
        id: "check_end_event",
        title: "Mindestens ein Endevent vorhanden",
        weight: 20,
        ok: endExists,
        penaltyWhenFail: 20,
        detail: endExists ? "Endevent erkannt." : "Kein Endevent gefunden.",
        violationCode: "MISSING_END_EVENT",
        suggestion: "Mindestens ein Endevent modellieren."
    }));

    const duplicateIds = hasDuplicateStepIds(steps);
    checks.push(buildCheck({
        id: "check_unique_ids",
        title: "Eindeutige Step-IDs",
        weight: 20,
        ok: !duplicateIds,
        penaltyWhenFail: 20,
        detail: duplicateIds ? "Doppelte Step-IDs erkannt." : "Alle Step-IDs sind eindeutig.",
        violationCode: "DUPLICATE_STEP_ID",
        suggestion: "Jeden Step mit einer eindeutigen ID versehen."
    }));

    const deadEnds = countDeadEnds(steps);
    checks.push(buildCheck({
        id: "check_dead_ends",
        title: "Keine Dead-End Aktivitaeten",
        weight: 15,
        ok: deadEnds === 0,
        penaltyWhenFail: Math.min(15, deadEnds * 5),
        detail: deadEnds === 0 ? "Keine Dead-Ends erkannt." : `${deadEnds} Dead-End Aktivitaet(en) erkannt.`,
        violationCode: "DEAD_END_ACTIVITY",
        suggestion: "Jede Nicht-End-Aktivitaet mit Folgeschritt oder Bedingungspfad verbinden."
    }));

    const invalidGateways = countInvalidGateways(steps);
    checks.push(buildCheck({
        id: "check_gateway_branches",
        title: "Gateways mit mindestens zwei Pfaden",
        weight: 15,
        ok: invalidGateways === 0,
        penaltyWhenFail: Math.min(15, invalidGateways * 6),
        detail: invalidGateways === 0 ? "Alle Gateways haben mindestens zwei Bedingungen." : `${invalidGateways} unvollstaendige Gateway(s) erkannt.`,
        violationCode: "INVALID_GATEWAY_BRANCH_COUNT",
        suggestion: "Gateways nur bei echter Verzweigung mit mindestens zwei ausgehenden Bedingungen verwenden."
    }));

    const unclearLabels = countUnclearGatewayLabels(steps);
    checks.push(buildCheck({
        id: "check_gateway_labels",
        title: "Gateway-Bedingungen klar beschriftet",
        weight: 15,
        ok: unclearLabels === 0,
        penaltyWhenFail: Math.min(15, unclearLabels * 4),
        detail: unclearLabels === 0 ? "Alle Gateway-Bedingungen haben Labels." : `${unclearLabels} unlabeled Gateway-Bedingung(en) erkannt.`,
        violationCode: "UNCLEAR_GATEWAY_LABEL",
        suggestion: "Bedingungen an Gateways eindeutig benennen, z. B. Ja/Nein."
    }));

    const missingRoles = countMissingRoles(steps);
    checks.push(buildCheck({
        id: "check_role_assignment",
        title: "Jeder Schritt hat eine Rolle",
        weight: 15,
        ok: missingRoles === 0,
        penaltyWhenFail: Math.min(15, missingRoles * 5),
        detail: missingRoles === 0 ? "Alle Schritte haben Rollen." : `${missingRoles} Schritt(e) ohne Rolle erkannt.`,
        violationCode: "MISSING_ROLE_ASSIGNMENT",
        suggestion: "Jeden Schritt einer verantwortlichen Rolle/Lane zuordnen."
    }));

    const routingDebug = buildRoutingDebug(processJson);
    const debugFlows = Array.isArray(routingDebug?.flows) ? routingDebug.flows : [];
    const gatewayAnchorViolations = debugFlows.filter(
        (flow) => flow.gatewaySideAnchorOk === false
    ).length;
    const loopAnchorViolations = debugFlows.filter(
        (flow) => flow.loopTargetAnchorOk === false
    ).length;
    const routingAnchorViolations = gatewayAnchorViolations + loopAnchorViolations;
    checks.push(buildCheck({
        id: "check_routing_anchor_rules",
        title: "Routing-Ankerregeln fuer Nebenpfade und Loops",
        weight: 15,
        ok: routingAnchorViolations === 0,
        penaltyWhenFail: Math.min(15, routingAnchorViolations * 5),
        detail: routingAnchorViolations === 0
            ? "Routing-Ankerregeln sind konsistent."
            : `${routingAnchorViolations} Anchor-Regelverletzung(en) erkannt (gateway:${gatewayAnchorViolations}, loop:${loopAnchorViolations}).`,
        violationCode: "ROUTING_ANCHOR_RULE_BROKEN",
        suggestion: "Gateway-Nebenpfade nur ueber Top/Bottom-Mitte ausfuehren und Loop-Ziele ueber Top/Bottom-Mitte eindeutig ankern."
    }));

    const layoutViolations = (metrics.elementOverlaps || 0)
        + (metrics.flowCrossingsAvoidable || 0)
        + (metrics.flowShapeOverlaps || 0)
        + (metrics.outOfWorkspaceFlows || 0);
    checks.push(buildCheck({
        id: "check_layout_collisions",
        title: "Layout ohne Ueberlagerungen und vermeidbare Kreuzungen",
        weight: 20,
        ok: layoutViolations === 0,
        penaltyWhenFail: Math.min(20, layoutViolations * 2),
        detail: layoutViolations === 0
            ? "Keine kritischen Layout-Kollisionen erkannt."
            : `Kollisionen erkannt: elementOverlaps=${metrics.elementOverlaps}, avoidableCrossings=${metrics.flowCrossingsAvoidable}, flowShapeOverlaps=${metrics.flowShapeOverlaps}, outOfWorkspace=${metrics.outOfWorkspaceFlows}.`,
        violationCode: "LAYOUT_COLLISIONS_DETECTED",
        suggestion: "Vermeidbare Kreuzungen reduzieren, ueberlagerte Elemente trennen und Flows innerhalb des Arbeitsbereichs halten."
    }));

    const maxScore = checks.reduce((sum, check) => sum + check.weight, 0);
    const score = checks.reduce((sum, check) => sum + check.score, 0);
    const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const grade = percent >= 90 ? "A" : percent >= 80 ? "B" : percent >= 70 ? "C" : percent >= 60 ? "D" : "E";

    const violations = checks.flatMap((check) => check.violations);
    const suggestions = Array.from(new Set(violations.map((item) => item.suggestion))).filter(Boolean);
    const outOfWorkspace = Number(metrics?.outOfWorkspaceFlows || 0);
    const avoidableCrossings = Number(metrics?.flowCrossingsAvoidable || 0);
    const totalCrossings = Number(metrics?.flowCrossingsTotal || 0);
    const flowShapeOverlaps = Number(metrics?.flowShapeOverlaps || 0);
    const stepCount = steps.length;
    const avoidableWarnThreshold = stepCount <= 6 ? 2 : stepCount <= 12 ? 3 : 4;
    const shapeWarnThreshold = stepCount <= 6 ? 2 : stepCount <= 12 ? 3 : 4;
    const outOfWorkspaceWarnThreshold = 1;
    const avoidableBlockThreshold = stepCount <= 6 ? 5 : stepCount <= 12 ? 6 : 8;
    const shapeBlockThreshold = stepCount <= 6 ? 5 : 6;
    const outOfWorkspaceBlockThreshold = stepCount <= 6 ? 2 : 4;
    const avoidableRatio = totalCrossings > 0 ? avoidableCrossings / totalCrossings : 0;
    const gateReasons = [];
    if (outOfWorkspace >= outOfWorkspaceWarnThreshold) gateReasons.push("outOfWorkspaceFlows");
    if (avoidableCrossings >= avoidableWarnThreshold) gateReasons.push("flowCrossingsAvoidable");
    if (flowShapeOverlaps >= shapeWarnThreshold) gateReasons.push("flowShapeOverlaps");
    const severeAvoidableCrossings = avoidableCrossings >= avoidableBlockThreshold
        && (avoidableRatio >= 0.35 || avoidableCrossings >= avoidableBlockThreshold + 2);
    const severeLayoutIssue = outOfWorkspace >= outOfWorkspaceBlockThreshold
        || severeAvoidableCrossings
        || flowShapeOverlaps >= shapeBlockThreshold;
    const gate = {
        needsRelayout: gateReasons.length > 0,
        blocking: severeLayoutIssue,
        severity: severeLayoutIssue ? "error" : gateReasons.length > 0 ? "warn" : "info",
        reasons: gateReasons
    };

    return {
        score,
        maxScore,
        percent,
        grade,
        metrics,
        gate,
        checks,
        violations,
        suggestions
    };
}
