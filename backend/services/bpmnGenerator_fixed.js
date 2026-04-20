// Design-Regeln Fix - Neue Implementierung mit korrekten Regeln

import { buildActivityElementXml, PROBPM_EMAIL_NS } from "./bpmnSemantics.js";

function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function compactLabel(value, maxWords = 3) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) return "";
    const words = text.split(" ");
    return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

const SNAP_GRID = 12;

function snap(value, grid = SNAP_GRID) {
    return Math.round(value / grid) * grid;
}

function classifyBranchLabel(label) {
    const value = String(label || "").trim().toLowerCase();
    if (!value) return "other";
    if (/(^|\b)(ja|yes|ok|genehmigt|freigabe|freigegeben|true)(\b|$)/i.test(value)) return "yes";
    if (/(^|\b)(nein|no|abgelehnt|false)(\b|$)/i.test(value)) return "no";
    if (/(^|\b)(fehler|error|ungueltig|ungültig|fehlend|unvollstaendig|unvollständig)(\b|$)/i.test(value)) return "error";
    return "other";
}

function getNodeSize(step) {
    const isGateway = step?.type === "gateway";
    const isStart = step?.type === "startEvent";
    const isEnd = step?.type === "endEvent";
    const isBoundary = step?.type === "boundaryTimer";
    return {
        width: isGateway ? 50 : isStart || isEnd || isBoundary ? 36 : 100,
        height: isGateway ? 50 : isStart || isEnd || isBoundary ? 36 : 60
    };
}

// NEUE routeFlow Funktion mit korrekten Design-Regeln
function routeFlow(
    flow,
    index,
    stepsById,
    positions,
    allFlows,
    outgoingIndexMeta,
    _horizontalBands,
    _loopBands,
    corridorState,
    laneBounds,
    laneMeta,
    strictQuality = false
) {
    const from = positions[flow.from];
    const to = positions[flow.to];
    if (!from || !to) return null;

    const fromStep = stepsById.get(flow.from);
    const toStep = stepsById.get(flow.to);
    const fromSize = getNodeSize(fromStep);
    const toSize = getNodeSize(toStep);

    const startX = from.x + fromSize.width;
    const startY = from.y + fromSize.height / 2;
    const endX = to.x;
    
    // Design-Regel 1: Eingehende Sequenzflüsse IMMER horizontal und mittig bei Aktivitäten
    let endY;
    if (toStep?.type === "task" || toStep?.type === "startEvent" || toStep?.type === "endEvent" || toStep?.type === "boundaryTimer") {
        endY = to.y + toSize.height / 2; // Horizontal und mittig
    } else {
        endY = to.y + toSize.height / 2; // Standard
    }

    const outgoingMeta = outgoingIndexMeta.get(index) || { localIndex: 0, total: 1 };
    const isLoop = Boolean(flow._isBackEdge);
    const branchKind = classifyBranchLabel(flow.condition);
    const isPrimaryForward = Boolean(outgoingMeta.isPrimary) && endX > startX;
    const isMainFlow = Boolean(flow._isMain);
    const isToEndEvent = toStep?.type === "endEvent" && !isLoop;

    // Design-Regel 1: Spezielle Behandlung für horizontale eingehende Pfeile bei Aktivitäten
    if (toStep?.type === "task" || toStep?.type === "startEvent" || toStep?.type === "endEvent" || toStep?.type === "boundaryTimer") {
        const horizontalEndY = to.y + toSize.height / 2;
        if (Math.abs(snap(startY) - snap(horizontalEndY)) <= SNAP_GRID) {
            return [
                { x: snap(startX), y: snap(startY) },
                { x: snap(endX), y: snap(horizontalEndY) }
            ];
        }
        return [
            { x: snap(startX), y: snap(startY) },
            { x: snap(endX), y: snap(startY) },
            { x: snap(endX), y: snap(horizontalEndY) }
        ];
    }

    // Design-Regel 2: Gateway-Ausgangsflüsse müssen rechts, oberhalb oder unterhalb des Gateways verlaufen
    if (fromStep?.type === "gateway") {
        let gatewayExitDirection = 0; // 0 = rechts, -1 = oben, 1 = unten
        
        if (!isPrimaryForward) {
            // Für nicht-primäre Flüsse: bevorzuge oben/unten basierend auf branchKind
            if (branchKind === "no" || branchKind === "error") {
                gatewayExitDirection = 1; // unten
            } else if (outgoingMeta.localIndex % 2 === 0) {
                gatewayExitDirection = -1; // oben
            } else {
                gatewayExitDirection = 1; // unten
            }
        }
        
        const targetDeltaX = Math.max(24, endX - startX);
        const forkX = snap(startX + Math.min(72, Math.max(36, Math.round(targetDeltaX * 0.28))));
        const baseY = snap(startY);
        
        const branchStart = !isPrimaryForward
            ? {
                x: snap(startX),
                y: snap(startY)
            }
            : {
                x: snap(from.x + fromSize.width / 2),
                y: snap(gatewayExitDirection < 0 ? from.y : (from.y + fromSize.height))
            };
        
        const entryX = snap(endX - 6);
        const points = [branchStart];
        
        if (!isPrimaryForward) {
            // Design-Regel 2: Erzwinge klare Gateway-Ausgangsrichtung
            const exitY = gatewayExitDirection < 0 
                ? snap(from.y - 24)  // oben
                : snap(from.y + fromSize.height + 24);  // unten
            const exitX = snap(from.x + fromSize.width / 2);
            
            points.push({ x: exitX, y: exitY });
            points.push({ x: forkX, y: exitY });
            
            const branchCorridorY = baseY + (gatewayExitDirection * 48);
            if (branchCorridorY !== exitY) {
                points.push({ x: forkX, y: branchCorridorY });
            }
            points.push({ x: entryX, y: branchCorridorY });
        } else {
            points.push({ x: forkX, y: snap(startY) });
            points.push({ x: entryX, y: snap(startY) });
        }
        
        points.push({ x: entryX, y: snap(endY) });
        points.push({ x: snap(endX), y: snap(endY) });
        return points;
    }

    // Standard-Routing für andere Fälle
    if (isMainFlow && !isLoop && endX > startX) {
        const sameRow = Math.abs(snap(startY) - snap(endY)) <= SNAP_GRID;
        if (sameRow) {
            return [
                { x: snap(startX), y: snap(startY) },
                { x: snap(endX), y: snap(endY) }
            ];
        }
        return [
            { x: snap(startX), y: snap(startY) },
            { x: snap(endX), y: snap(startY) },
            { x: snap(endX), y: snap(endY) }
        ];
    }

    if (isToEndEvent) {
        if (Math.abs(snap(startY) - snap(endY)) <= SNAP_GRID) {
            return [
                { x: snap(startX), y: snap(startY) },
                { x: snap(endX), y: snap(endY) }
            ];
        }
        const entryX = snap(endX - 18);
        return [
            { x: snap(startX), y: snap(startY) },
            { x: entryX, y: snap(startY) },
            { x: entryX, y: snap(endY) },
            { x: snap(endX), y: snap(endY) }
        ];
    }

    // Standard-Routing
    const entryX = snap(endX - 6);
    return [
        { x: snap(startX), y: snap(startY) },
        { x: entryX, y: snap(startY) },
        { x: entryX, y: snap(endY) },
        { x: snap(endX), y: snap(endY) }
    ];
}

export { routeFlow };
