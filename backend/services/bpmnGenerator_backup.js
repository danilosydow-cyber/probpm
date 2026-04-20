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

function normalizeBranchLabel(label, fallback = "Bedingung") {
    const raw = String(label || "").trim();
    const kind = classifyBranchLabel(raw);
    if (kind === "yes") return "Ja";
    if (kind === "no") return "Nein";
    if (kind === "error") return "Fehlerpfad";
    return compactLabel(raw || fallback, 2);
}

function normalizeGatewayDisplayName(label) {
    const compact = compactLabel(label || "Entscheidung", 4) || "Entscheidung";
    if (compact.endsWith("?")) return compact;
    if (/(^|\b)(entscheidung|pruefen|prüfen|ok|gueltig|gültig|vollstaendig|vollständig|genehmigt|freigabe)(\b|$)/i.test(compact)) {
        return `${compact}?`;
    }
    return compact;
}

function rectsOverlap(a, b) {
    return (
        a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y
    );
}

function placeEdgeLabelBounds(anchor, labelWidth, labelHeight, stepRects, yBias = 0) {
    const candidates = [
        { x: snap(anchor.x + 6), y: snap(anchor.y - 14 + yBias) },
        { x: snap(anchor.x + 6), y: snap(anchor.y + 6 + yBias) },
        { x: snap(anchor.x - labelWidth - 8), y: snap(anchor.y - 14 + yBias) },
        { x: snap(anchor.x - labelWidth - 8), y: snap(anchor.y + 6 + yBias) },
        { x: snap(anchor.x + 6), y: snap(anchor.y - 32 + yBias) }
    ];

    for (const candidate of candidates) {
        const box = { x: candidate.x, y: candidate.y, width: labelWidth, height: labelHeight };
        const overlaps = Array.from(stepRects.values()).some((rect) => rectsOverlap(box, rect));
        if (!overlaps) return box;
    }

    return {
        x: snap(anchor.x + 6),
        y: snap(anchor.y - 32 + yBias),
        width: labelWidth,
        height: labelHeight
    };
}

function compactOrthogonalWaypoints(points) {
    if (!Array.isArray(points) || points.length < 2) return points;
    const deduped = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
        const prev = deduped[deduped.length - 1];
        const curr = points[i];
        if (!curr) continue;
        if (prev.x === curr.x && prev.y === curr.y) continue;
        deduped.push(curr);
    }
    if (deduped.length < 3) return deduped;
    const out = [deduped[0]];
    for (let i = 1; i < deduped.length - 1; i += 1) {
        const a = out[out.length - 1];
        const b = deduped[i];
        const c = deduped[i + 1];
        const colinearVertical = a.x === b.x && b.x === c.x;
        const colinearHorizontal = a.y === b.y && b.y === c.y;
        if (colinearVertical || colinearHorizontal) continue;
        out.push(b);
    }
    out.push(deduped[deduped.length - 1]);
    return out;
}

function normalizeType(step) {
    if (step.type === "end" || step.type === "endEvent") return "endEvent";
    if (step.type === "gateway") return "gateway";
    if (step.type === "start" || step.type === "startEvent") return "task";
    return "task";
}

function dedupeFlows(flows) {
    const seen = new Set();
    return flows.filter((flow) => {
        const key = `${flow.from}->${flow.to}:${flow.condition || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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

function resolveLaneNodeOverlaps(steps, positions, laneMeta, lanePadding = 16) {
    const byRole = new Map();
    steps.forEach((step) => {
        if (!positions[step.id]) return;
        const list = byRole.get(step._roleId) || [];
        list.push(step);
        byRole.set(step._roleId, list);
    });

    // Verbesserte Überlappungsauflösung mit Grid-basierter Platzierung
    byRole.forEach((laneSteps, roleId) => {
        if (!laneMeta[roleId]) return;
        const lane = laneMeta[roleId];
        
        // Erstelle ein Grid für bessere Platzierung
        const gridWidth = Math.max(1, Math.min(100, Math.floor((lane.width - 2 * lanePadding) / SNAP_GRID)));
        const gridHeight = Math.max(1, Math.min(100, Math.floor((lane.height - 2 * lanePadding) / SNAP_GRID)));
        
        // Zusätzliche Validierung zur Vermeidung von Array-Fehlern
        if (gridWidth <= 0 || gridHeight <= 0 || !Number.isFinite(gridWidth) || !Number.isFinite(gridHeight)) {
            console.warn('Invalid grid dimensions, skipping overlap resolution for lane:', roleId);
            return;
        }
        
        const grid = Array(gridHeight).fill().map(() => Array(gridWidth).fill(false));
        
        // Markiere belegte Zellen
        const placed = laneSteps.map((step) => {
            const pos = positions[step.id];
            const size = getNodeSize(step);
            return { step, pos, size };
        });
        
        placed.forEach(({ pos, size }) => {
            const x0 = Math.floor((pos.x - lane.x) / SNAP_GRID);
            const y0 = Math.floor((pos.y - lane.y) / SNAP_GRID);
            const w = Math.ceil(size.width / SNAP_GRID);
            const h = Math.ceil(size.height / SNAP_GRID);
            
            for (let x = x0; x < Math.min(x0 + w, gridWidth); x++) {
                for (let y = y0; y < Math.min(y0 + h, gridHeight); y++) {
                    if (x >= 0 && y >= 0) {
                        grid[y][x] = true;
                    }
                }
            }
        });
        
        // Sortiere nach Priorität (komplexe Elemente zuerst)
        const priorityOrder = (step) => {
            const type = step.type;
            if (type === 'startEvent' || type === 'endEvent') return 0;
            if (type === 'gateway') return 1;
            if (type === 'boundaryTimer') return 2;
            return 3;
        };
        
        const sortedSteps = [...laneSteps].sort((a, b) => priorityOrder(a) - priorityOrder(b));
        
        sortedSteps.forEach((step) => {
            const pos = positions[step.id];
            const size = getNodeSize(step);
            const box = { x: pos.x, y: pos.y, width: size.width, height: size.height };
            
            // Prüfe auf Überlappungen
            const overlaps = placed.filter(
                (other) => other.step.id !== step.id && rectsOverlap(box, {
                    x: other.pos.x,
                    y: other.pos.y,
                    width: other.size.width,
                    height: other.size.height
                })
            );
            
            if (overlaps.length === 0) return;
            
            // Finde beste neue Position mit Grid-Suche
            const w = Math.ceil(size.width / SNAP_GRID);
            const h = Math.ceil(size.height / SNAP_GRID);
            const originalX = Math.floor((pos.x - lane.x) / SNAP_GRID);
            const originalY = Math.floor((pos.y - lane.y) / SNAP_GRID);
            
            let bestPos = null;
            let bestDistance = Infinity;
            
            // Suche in spiralförmiger Reihenfolge von der Originalposition
            for (let radius = 1; radius < Math.max(gridWidth, gridHeight); radius++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dy = -radius; dy <= radius; dy++) {
                        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                        
                        const newX = originalX + dx;
                        const newY = originalY + dy;
                        
                        // Prüfe Grid-Grenzen
                        if (newX < 0 || newY < 0 || newX + w >= gridWidth || newY + h >= gridHeight) continue;
                        
                        // Prüfe ob Grid-Zellen frei sind
                        let canPlace = true;
                        for (let x = newX; x < newX + w && canPlace; x++) {
                            for (let y = newY; y < newY + h && canPlace; y++) {
                                if (grid[y][x]) canPlace = false;
                            }
                        }
                        
                        if (!canPlace) continue;
                        
                        // Berechne Abstand zur Originalposition
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance < bestDistance) {
                            bestDistance = distance;
                            bestPos = {
                                x: snap(lane.x + newX * SNAP_GRID),
                                y: snap(lane.y + newY * SNAP_GRID)
                            };
                        }
                    }
                }
                
                if (bestPos) break; // Early exit wenn gute Position gefunden
            }
            
            if (bestPos) {
                positions[step.id] = bestPos;
                
                // Aktualisiere Grid mit neuer Position
                const newX = Math.floor((bestPos.x - lane.x) / SNAP_GRID);
                const newY = Math.floor((bestPos.y - lane.y) / SNAP_GRID);
                for (let x = newX; x < newX + w && x < gridWidth; x++) {
                    for (let y = newY; y < newY + h && y < gridHeight; y++) {
                        grid[y][x] = true;
                    }
                }
            }
        });
    });
}

function detectAndReduceFlowCrossings(flows, positions, steps, laneMeta) {
    const stepsById = new Map(steps.map(step => [step.id, step]));
    
    // Berechne Kreuzungen zwischen Flows
    const calculateCrossings = () => {
        let crossings = 0;
        for (let i = 0; i < flows.length; i++) {
            for (let j = i + 1; j < flows.length; j++) {
                const flowA = flows[i];
                const flowB = flows[j];
                
                if (flowA.from === flowB.from || flowA.to === flowB.to || 
                    flowA.from === flowB.to || flowA.to === flowB.from) continue;
                
                const posAFrom = positions[flowA.from];
                const posATo = positions[flowA.to];
                const posBFrom = positions[flowB.from];
                const posBTo = positions[flowB.to];
                
                if (!posAFrom || !posATo || !posBFrom || !posBTo) continue;
                
                const sizeAFrom = getNodeSize(stepsById.get(flowA.from));
                const sizeATo = getNodeSize(stepsById.get(flowA.to));
                const sizeBFrom = getNodeSize(stepsById.get(flowB.from));
                const sizeBTo = getNodeSize(stepsById.get(flowB.to));
                
                // Vereinfachte Kreuzungserkennung (orthogonale Linien)
                const centerAFrom = { x: posAFrom.x + sizeAFrom.width / 2, y: posAFrom.y + sizeAFrom.height / 2 };
                const centerATo = { x: posATo.x + sizeATo.width / 2, y: posATo.y + sizeATo.height / 2 };
                const centerBFrom = { x: posBFrom.x + sizeBFrom.width / 2, y: posBFrom.y + sizeBFrom.height / 2 };
                const centerBTo = { x: posBTo.x + sizeBTo.width / 2, y: posBTo.y + sizeBTo.height / 2 };
                
                // Prüfe auf horizontale/vertikale Kreuzungen
                const aHorizontal = Math.abs(centerAFrom.y - centerATo.y) < 20;
                const bHorizontal = Math.abs(centerBFrom.y - centerBTo.y) < 20;
                
                if (aHorizontal && bHorizontal) continue; // Parallele horizontale Linien kreuzen sich nicht
                
                if (aHorizontal) {
                    const aY = centerAFrom.y;
                    const aX1 = Math.min(centerAFrom.x, centerATo.x);
                    const aX2 = Math.max(centerAFrom.x, centerATo.x);
                    
                    if (centerBFrom.y <= aY && centerBTo.y >= aY || centerBFrom.y >= aY && centerBTo.y <= aY) {
                        const bX = centerBFrom.x + (centerBTo.x - centerBFrom.x) * ((aY - centerBFrom.y) / (centerBTo.y - centerBFrom.y));
                        if (bX >= aX1 && bX <= aX2) crossings++;
                    }
                } else if (bHorizontal) {
                    const bY = centerBFrom.y;
                    const bX1 = Math.min(centerBFrom.x, centerBTo.x);
                    const bX2 = Math.max(centerBFrom.x, centerBTo.x);
                    
                    if (centerAFrom.y <= bY && centerATo.y >= bY || centerAFrom.y >= bY && centerATo.y <= bY) {
                        const aX = centerAFrom.x + (centerATo.x - centerAFrom.x) * ((bY - centerAFrom.y) / (centerATo.y - centerAFrom.y));
                        if (aX >= bX1 && aX <= bX2) crossings++;
                    }
                }
            }
        }
        return crossings;
    };
    
    const initialCrossings = calculateCrossings();
    if (initialCrossings === 0) return false; // Keine Kreuzungen zum Reduzieren
    
    // Versuche, Kreuzungen durch vertikale Verschiebung zu reduzieren
    const byRole = new Map();
    steps.forEach(step => {
        if (!positions[step.id]) return;
        const roleId = step._roleId || "_default";
        const list = byRole.get(roleId) || [];
        list.push(step);
        byRole.set(roleId, list);
    });
    
    let improved = false;
    
    byRole.forEach((laneSteps, roleId) => {
        if (!laneMeta[roleId]) return;
        const lane = laneMeta[roleId];
        const laneMinY = lane.y + 16;
        const laneMaxY = lane.y + lane.height - 16;
        
        // Sortiere Elemente nach horizontaler Position
        const sorted = [...laneSteps].sort((a, b) => {
            const ax = positions[a.id]?.x || 0;
            const bx = positions[b.id]?.x || 0;
            return ax - bx;
        });
        
        // Versuche verschiedene vertikale Anordnungen
        const testArrangements = [
            // Gleichmäßige Verteilung
            sorted.map((step, index) => {
                const pos = positions[step.id];
                const size = getNodeSize(step);
                const y = laneMinY + (index * (laneMaxY - laneMinY - size.height) / (sorted.length - 1));
                return { step, y: snap(y) };
            }),
            // Zentrierte Anordnung
            sorted.map((step, index) => {
                const pos = positions[step.id];
                const size = getNodeSize(step);
                const centerY = lane.y + lane.height / 2;
                const spacing = 80;
                const y = centerY - (sorted.length - 1) * spacing / 2 + index * spacing - size.height / 2;
                return { step, y: snap(Math.max(laneMinY, Math.min(laneMaxY - size.height, y))) };
            })
        ];
        
        let bestArrangement = null;
        let bestCrossings = initialCrossings;
        
        testArrangements.forEach(arrangement => {
            // Speichere Originalpositionen
            const originalYs = new Map();
            arrangement.forEach(({ step }) => {
                originalYs.set(step.id, positions[step.id].y);
            });
            
            // Wende Testanordnung an
            arrangement.forEach(({ step, y }) => {
                positions[step.id].y = y;
            });
            
            const crossings = calculateCrossings();
            if (crossings < bestCrossings) {
                bestCrossings = crossings;
                bestArrangement = arrangement;
            }
            
            // Stelle Originalpositionen wieder her
            originalYs.forEach((y, stepId) => {
                positions[stepId].y = y;
            });
        });
        
        // Wende beste Anordnung an
        if (bestArrangement && bestCrossings < initialCrossings) {
            bestArrangement.forEach(({ step, y }) => {
                positions[step.id].y = y;
            });
            improved = true;
        }
    });
    
    return improved;
}

function compactLaneHorizontalGaps(steps, positions, flows, laneMeta) {
    const stepsById = new Map((steps || []).map((step) => [step.id, step]));
    const inCount = new Map();
    const outCount = new Map();
    const crossRoleIncident = new Map();
    flows.forEach((flow) => {
        outCount.set(flow.from, (outCount.get(flow.from) || 0) + 1);
        inCount.set(flow.to, (inCount.get(flow.to) || 0) + 1);
        const fromStep = stepsById.get(flow.from);
        const toStep = stepsById.get(flow.to);
        if (fromStep?._roleId && toStep?._roleId && fromStep._roleId !== toStep._roleId) {
            crossRoleIncident.set(flow.from, (crossRoleIncident.get(flow.from) || 0) + 1);
            crossRoleIncident.set(flow.to, (crossRoleIncident.get(flow.to) || 0) + 1);
        }
    });

    const byRole = new Map();
    steps.forEach((step) => {
        const pos = positions[step.id];
        if (!pos) return;
        const roleId = step._roleId || "_default";
        const list = byRole.get(roleId) || [];
        list.push(step);
        byRole.set(roleId, list);
    });

    const isComplex = (step) => {
        const t = String(step?.type || "");
        if (t === "gateway" || t === "startEvent" || t === "endEvent" || t === "boundaryTimer") return true;
        if ((inCount.get(step.id) || 0) > 1) return true;
        if ((outCount.get(step.id) || 0) > 1) return true;
        if ((crossRoleIncident.get(step.id) || 0) > 0) return true;
        return false;
    };

    const optimizeVerticalAlignment = (laneSteps, roleId) => {
        if (!laneMeta[roleId]) return;
        
        const lane = laneMeta[roleId];
        const laneHeight = lane.height - 32; // Padding berücksichtigen
        const verticalSlots = Math.floor(laneHeight / 96); // 96px pro Slot
        
        const horizontalGroups = new Map();
        laneSteps.forEach(step => {
            const pos = positions[step.id];
            if (!pos) return;
            const xSlot = Math.floor(pos.x / 144); // 144px Raster
            const key = xSlot;
            if (!horizontalGroups.has(key)) {
                horizontalGroups.set(key, []);
            }
            horizontalGroups.get(key).push(step);
        });
        
        horizontalGroups.forEach((group, xSlot) => {
            if (group.length <= 1) return;
            
            const sortedY = [...group].sort((a, b) => {
                const ay = positions[a.id]?.y || 0;
                const by = positions[b.id]?.y || 0;
                return ay - by;
            });
            
            const availableHeight = laneHeight;
            const spacing = Math.min(96, Math.floor(availableHeight / (sortedY.length + 1)));
            const startY = lane.y + 16 + spacing;
            
            sortedY.forEach((step, index) => {
                const pos = positions[step.id];
                if (!pos) return;
                const size = getNodeSize(step);
                pos.y = snap(startY + index * spacing - size.height / 2);
            });
        });
    };

    byRole.forEach((laneSteps, roleId) => {
        if (!laneMeta[roleId]) return;
        
        optimizeVerticalAlignment(laneSteps, roleId);
        
        const sorted = [...laneSteps].sort((a, b) => {
            const ax = positions[a.id]?.x || 0;
            const bx = positions[b.id]?.x || 0;
            return ax - bx;
        });

        for (let i = 1; i < sorted.length; i += 1) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            const prevPos = positions[prev.id];
            const currPos = positions[curr.id];
            if (!prevPos || !currPos) continue;
            if (isComplex(prev) || isComplex(curr)) continue;

            const prevSize = getNodeSize(prev);
            const currSize = getNodeSize(curr);
            const gap = currPos.x - (prevPos.x + prevSize.width);
            const minGap = 64; // Erhöht für bessere Lesbarkeit
            
            const wouldCross = flows.some(flow => {
                if (flow.from === prev.id || flow.to === prev.id || 
                    flow.from === curr.id || flow.to === curr.id) return false;
                
                const flowFrom = positions[flow.from];
                const flowTo = positions[flow.to];
                if (!flowFrom || !flowTo) return false;
                
                const newCurrX = currPos.x - Math.min(gap - minGap, Math.floor(gap / 2));
                const flowFromCenter = flowFrom.x + getNodeSize(stepsById.get(flow.from)).width / 2;
                const flowToCenter = flowTo.x + getNodeSize(stepsById.get(flow.to)).width / 2;
                
                return (flowFromCenter < newCurrX && flowToCenter > currPos.x) ||
                       (flowFromCenter > currPos.x && flowToCenter < newCurrX);
            });
            
            if (gap <= minGap || wouldCross) continue;

            const shift = Math.min(gap - minGap, Math.floor(gap / 2));
            const affected = [];
            for (let j = i; j < sorted.length; j += 1) {
                const step = sorted[j];
                const pos = positions[step.id];
                if (!pos) continue;
                if (isComplex(step)) break;
                pos.x = snap(pos.x - shift);
                affected.push(step);
            }

            const flowsToReroute = flows.filter((flow) => {
                return affected.some((step) => step.id === flow.from || step.id === flow.to);
            });

            flowsToReroute.forEach((flow) => {
                const from = positions[flow.from];
                const to = positions[flow.to];
                if (!from || !to) return;
                const fromSize = getNodeSize(stepsById.get(flow.from));
                const toSize = getNodeSize(stepsById.get(flow.to));
                const fromCenter = { x: from.x + fromSize.width / 2, y: from.y + fromSize.height / 2 };
                const toCenter = { x: to.x + toSize.width / 2, y: to.y + toSize.height / 2 };
                
                const horizontal = Math.abs(fromCenter.y - toCenter.y) < 32;
                if (horizontal) {
                    to.y = snap(fromCenter.y - toSize.height / 2);
                }
            });
        }
    });
}

const SHAPE_LABEL_GAP = 10;
const SHAPE_LABEL_HEIGHT = 18;
const LANE_X = 50;
const LANE_SIDE_PADDING = 64;
const ROUTING_POLICY = Object.freeze({
    PROTECT_GATEWAY_SIDE_EXIT_SEGMENTS: 2,
    PROTECT_MAIN_SOURCE_SEGMENTS: 1,
    PROTECT_LOOP_TARGET_SEGMENTS: 2
});

function classifyFlowRoutingClass(flow, sourceStep) {
    if (flow?._isBackEdge) return "loop";
    if (sourceStep?.type === "gateway" && !flow?._isMain) return "gateway-side";
    if (flow?._isMain) return "main";
    return "other";
}

function computeLongestPathToEnd(steps, flows) {
    const bySource = new Map();
    flows.forEach((flow) => {
        const list = bySource.get(flow.from) || [];
        list.push(flow.to);
        bySource.set(flow.from, list);
    });

    const stepById = new Map((steps || []).map((step) => [step.id, step]));
    const memo = new Map();

    const dfs = (stepId, visiting = new Set()) => {
        if (memo.has(stepId)) return memo.get(stepId);
        const step = stepById.get(stepId);
        if (!step) return 0;
        if (step.type === "end" || step.type === "endEvent") {
            memo.set(stepId, 0);
            return 0;
        }
        if (visiting.has(stepId)) {
            // Cycle guard: treat cycle edge as short continuation.
            return 1;
        }
        visiting.add(stepId);
        const nextTargets = bySource.get(stepId) || [];
        let best = 0;
        nextTargets.forEach((targetId) => {
            best = Math.max(best, 1 + dfs(targetId, visiting));
        });
        visiting.delete(stepId);
        memo.set(stepId, best);
        return best;
    };

    steps.forEach((step) => {
        dfs(step.id, new Set());
    });
    return memo;
}

function buildOutgoingIndex(flows, positions = null, stepsById = null, longestPathToEnd = null) {
    const bySource = new Map();
    const indexByFlowId = new Map();
    flows.forEach((flow, index) => {
        const list = bySource.get(flow.from) || [];
        list.push({ ...flow, flowIndex: index });
        bySource.set(flow.from, list);
    });

    bySource.forEach((list) => {
        const sorted = [...list];
        if (positions && stepsById) {
            sorted.sort((a, b) => {
                const from = positions[a.from];
                const toA = positions[a.to];
                const toB = positions[b.to];
                const fromStep = stepsById.get(a.from);
                const fromSize = getNodeSize(fromStep);
                const toAStep = stepsById.get(a.to);
                const toBStep = stepsById.get(b.to);
                const toASize = getNodeSize(toAStep);
                const toBSize = getNodeSize(toBStep);
                if (!from || !toA || !toB) return 0;

                const startX = from.x + fromSize.width;
                const startY = from.y + fromSize.height / 2;
                const sourceStep = stepsById.get(a.from);
                const score = (candidate, to, size, targetId) => {
                    const targetX = to.x;
                    const targetY = to.y + size.height / 2;
                    const forwardPenalty = targetX >= startX ? 0 : 10000;
                    const verticalPenalty = Math.abs(targetY - startY);
                    const loopPenalty = candidate?._isBackEdge ? 12000 : 0;
                    // Hard rule: branches that lead to loops are never main exits.
                    const loopLeadPenalty = candidate?._leadsToLoop ? 50000 : 0;
                    const routePenalty = forwardPenalty + verticalPenalty + loopPenalty + loopLeadPenalty;
                    if (sourceStep?.type === "gateway" && longestPathToEnd) {
                        const remaining = Number(longestPathToEnd.get(targetId) || 0);
                        // Prefer the longest branch as the main-axis branch.
                        return routePenalty - remaining * 1000;
                    }
                    return routePenalty;
                };
                return score(a, toA, toASize, a.to) - score(b, toB, toBSize, b.to);
            });
        }

        sorted.forEach((item, localIndex) => {
            indexByFlowId.set(item.flowIndex, {
                localIndex,
                total: sorted.length,
                isPrimary: localIndex === 0
            });
        });
    });

    return indexByFlowId;
}

function isGatewayMainExitFlow(fromStep, flow, outgoingMeta) {
    return Boolean(
        fromStep?.type === "gateway"
        && (flow?._isMain || outgoingMeta?.isPrimary)
        && !flow?._isBackEdge
        && !flow?._leadsToLoop
    );
}

function shouldPreferYesAsMainExit(fromStep, flow, allFlows) {
    if (fromStep?.type !== "gateway") return false;
    if (!flow || flow._isBackEdge) return false;
    if (classifyBranchLabel(flow.condition) !== "yes") return false;
    const siblings = (allFlows || []).filter((candidate) => candidate.from === flow.from && candidate !== flow);
    return siblings.some((candidate) => {
        const kind = classifyBranchLabel(candidate.condition);
        return kind === "no" || kind === "error";
    });
}

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
    // Design-Regel 1: Eingehende Sequenzflüsse immer horizontal und mittig ausrichten
    const endY = to.y + toSize.height / 2;

    const outgoingMeta = outgoingIndexMeta.get(index) || { localIndex: 0, total: 1 };
    const relativeLane = outgoingMeta.localIndex - (outgoingMeta.total - 1) / 2;
    const branchYOffset = Math.round(relativeLane * 24);

    const sameRole = fromStep?._roleId && toStep?._roleId && fromStep._roleId === toStep._roleId;
    const isDecisionSplit = fromStep?.type === "gateway" || outgoingMeta.total > 1;
    const isLoop = Boolean(flow._isBackEdge);
    const branchKind = classifyBranchLabel(flow.condition);
    const preferYesAsMain = shouldPreferYesAsMainExit(fromStep, flow, allFlows);
    const isGatewayAffirmativeForward = fromStep?.type === "gateway"
        && branchKind === "yes"
        && endX > startX
        && !isLoop;
    const isGatewayPrimaryForward = (isGatewayMainExitFlow(fromStep, flow, outgoingMeta) || preferYesAsMain || isGatewayAffirmativeForward)
        && endX > startX;
    const isPrimaryForward = fromStep?.type === "gateway"
        ? isGatewayPrimaryForward
        : Boolean(outgoingMeta.isPrimary) && endX > startX;
    const isMainFlow = Boolean(flow._isMain);
    const isDirectJoinToGateway = fromStep?.type !== "gateway" && toStep?.type === "gateway" && !isLoop;
    const isToEndEvent = toStep?.type === "endEvent" && !isLoop;

    // Dominant forward line: if next element is directly on the right in the same row,
    // keep the connector perfectly straight for readability (even if side branches exist).
    const sameRow = Math.abs(snap(startY) - snap(endY)) <= SNAP_GRID;
    if (sameRole && !isLoop && isPrimaryForward && endX > startX && sameRow) {
        return [
            { x: snap(startX), y: snap(startY) },
            { x: snap(endX), y: snap(endY) }
        ];
    }

    if (isMainFlow && !isLoop && endX > startX) {
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

    // Robust task->gateway forward axis guard:
    // use geometry tolerance (not role equality) to avoid unwanted down-kinks.
    if (
        !isLoop
        && isPrimaryForward
        && fromStep?.type !== "gateway"
        && toStep?.type === "gateway"
        && endX > startX
        && Math.abs(snap(startY) - snap(endY)) <= SNAP_GRID * 2
    ) {
        return [
            { x: snap(startX), y: snap(startY) },
            { x: snap(endX), y: snap(startY) }
        ];
    }

    // Same role and no split: keep strict linear flow for readability.
    if (sameRole && !isLoop && !isDecisionSplit) {
        return [
            { x: snap(startX), y: snap(startY) },
            { x: snap(endX), y: snap(endY) }
        ];
    }

    // Keep joins into gateways as short as possible:
    // rightward exit from source, then direct vertical move into gateway anchor.
    if (isDirectJoinToGateway) {
        const entryX = snap(endX - 6);
        return [
            { x: snap(startX), y: snap(startY) },
            { x: entryX, y: snap(startY) },
            { x: entryX, y: snap(endY) },
            { x: snap(endX), y: snap(endY) }
        ];
    }

    // Loop/back edge: keep loops compact and separated near involved lanes.
    if (isLoop) {
        const loopTrack = corridorState.loop ?? 0;
        corridorState.loop = loopTrack + 1;
        const level = Math.floor(loopTrack / 2) + 1;
        const fromLane = fromStep?._roleId ? laneMeta?.[fromStep._roleId] : null;
        const toLane = toStep?._roleId ? laneMeta?.[toStep._roleId] : null;
        const localMinY = Math.min(fromLane?.y ?? laneBounds.minY, toLane?.y ?? laneBounds.minY);
        const localMaxY = Math.max(
            (fromLane?.y ?? laneBounds.maxY) + (fromLane?.height ?? 0),
            (toLane?.y ?? laneBounds.maxY) + (toLane?.height ?? 0)
        );
        const localMinX = Math.min(startX, endX);
        const localMaxX = Math.max(startX, endX);
        // Adaptive loop density:
        // keep loops compact for small counts, but spread them progressively
        // when multiple loop edges share the same area.
        const densityPhase = loopTrack < 2 ? 0 : loopTrack < 5 ? 1 : 2;
        const levelStep = densityPhase === 0 ? 10 : densityPhase === 1 ? 14 : 18;
        const laneInset = densityPhase === 0 ? 24 : 18;
        const bottomBand = snap(localMaxY - laneInset - level * levelStep);
        const preferredUnderAxis = snap(Math.max(startY, endY) + 36 + level * levelStep);
        const maxInsideLane = snap(localMaxY - 12);
        const loopY = snap(Math.min(maxInsideLane, Math.max(bottomBand, preferredUnderAxis)));
        const railSpread = densityPhase === 0 ? 14 : densityPhase === 1 ? 18 : 24;
        const desiredRailX = Math.max(startX + 36, localMaxX + 36 + level * railSpread);
        const maxRailX = strictQuality ? laneBounds.maxX + 48 : laneBounds.maxX + 132;
        const rightRailX = snap(Math.min(maxRailX, desiredRailX));
        const exitX = snap(startX + 24);
        const targetCenterX = to.x + toSize.width / 2;
        const targetAnchorY = to.y + toSize.height;
        const entryRailOffset = (loopTrack % 2 === 0 ? -1 : 1) * Math.max(12, level * 6);
        const entryX = snap(targetCenterX + entryRailOffset);

        const loopPoints = [
            { x: snap(startX), y: snap(startY) },
            { x: exitX, y: snap(startY) },
            { x: rightRailX, y: snap(startY) },
            { x: rightRailX, y: loopY },
            { x: entryX, y: loopY },
            { x: entryX, y: snap(targetAnchorY) }
        ];
        return loopPoints.filter((point, idx, arr) => {
            if (idx === 0) return true;
            const prev = arr[idx - 1];
            return point.x !== prev.x || point.y !== prev.y;
        });
    }

    // Design-Regel 2: Gateway-Ausgangsflüsse müssen rechts, oberhalb oder unterhalb des Gateways verlaufen
    if (fromStep?.type === "gateway") {
        const branchKind = classifyBranchLabel(flow.condition);
        const forkKey = `fork:${flow.from}`;
        const existingFork = corridorState.gatewayForks.get(forkKey);
        const targetDeltaX = Math.max(24, endX - startX);
        const forkX = existingFork?.x ?? snap(startX + Math.min(72, Math.max(36, Math.round(targetDeltaX * 0.28))));
        const baseY = existingFork?.y ?? snap(startY);
        corridorState.gatewayForks.set(forkKey, { x: forkX, y: baseY });

        const gatewayKey = `${flow.from}:${branchKind}`;
        const branchLevel = corridorState.gatewayBranchLevels.get(gatewayKey) || 0;
        corridorState.gatewayBranchLevels.set(gatewayKey, branchLevel + 1);
        
        // Design-Regel 2: Bestimme die Richtung basierend auf Design-Regeln
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
        
        const branchDirection = !isPrimaryForward
            ? resolveGatewayBranchDirectionWithFallback(flow, allFlows, stepsById, laneMeta, from, to)
            : gatewayExitDirection;
        const sideDirection = branchKind === "no" || branchKind === "error"
            ? 1
            : branchDirection !== 0
                ? branchDirection
                : (outgoingMeta.localIndex % 2 === 1 ? -1 : 1);
        const sideLevel = Math.ceil(outgoingMeta.localIndex / 2);

        // Adaptive branch fan-out:
        // more room in lane -> clearer vertical separation, less room -> compact.
        const sourceLane = fromStep?._roleId ? laneMeta?.[fromStep._roleId] : null;
        const laneHeight = Number(sourceLane?.height || 120);
        const spreadBase = laneHeight >= 220 ? 88 : laneHeight >= 170 ? 76 : 64;
        const spreadStep = laneHeight >= 220 ? 22 : laneHeight >= 170 ? 18 : 14;
        const sideOffset = (sideLevel || 1) * spreadBase;
        const branchCorridorY = isPrimaryForward
            ? snap(baseY)
            : snap(baseY + sideDirection * sideOffset + branchLevel * spreadStep + branchYOffset);
        
        // Design-Regel 2: Erzwinge Gateway-Ausgangspositionen
        const branchStart = !isPrimaryForward
            ? {
                x: snap(from.x + fromSize.width / 2),
                y: snap(gatewayExitDirection < 0 ? from.y : (from.y + fromSize.height))
            }
            : { x: snap(startX), y: snap(startY) };
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
            if (branchCorridorY !== exitY) {
                points.push({ x: forkX, y: branchCorridorY });
            }
        } else {
            points.push({ x: forkX, y: snap(branchStart.y) });
            if (branchCorridorY !== snap(branchStart.y)) {
                points.push({ x: forkX, y: branchCorridorY });
            }
        }
        points.push({ x: entryX, y: branchCorridorY });
        if (branchCorridorY !== snap(endY)) {
            points.push({ x: entryX, y: snap(endY) });
        }
        points.push({ x: snap(endX), y: snap(endY) });
        return points;
    }

    // Non-linear forward routing (role change):
    // move through dedicated outer corridors to prevent edge/shape overlaps in the core model area.
    if (isPrimaryForward && !isLoop) {
        const entryX = snap(endX - 6);
        return [
            { x: snap(startX), y: snap(startY) },
            { x: entryX, y: snap(startY) },
            { x: entryX, y: snap(endY) },
            { x: snap(endX), y: snap(endY) }
        ];
    }

    const fanKey = `fan:${flow.from}`;
    const fanForkX = corridorState.taskForks.get(fanKey) ?? snap(startX + 36);
    corridorState.taskForks.set(fanKey, fanForkX);
    const branchY = snap(startY + (relativeLane === 0 ? 0 : relativeLane * 72));
    const entryX = snap(endX - 6);

    return [
        { x: snap(startX), y: snap(startY) },
        { x: fanForkX, y: snap(startY) },
        { x: fanForkX, y: branchY },
        { x: entryX, y: branchY },
        { x: entryX, y: snap(endY) },
        { x: snap(endX), y: snap(endY) }
    ];
}

function resolveGatewayBranchDirection(flow, allFlows, stepsById, laneMeta) {
    const sourceStep = stepsById.get(flow.from);
    const targetStep = stepsById.get(flow.to);
    if (!sourceStep?._roleId || !targetStep) return 0;
    const sourceLane = laneMeta?.[sourceStep._roleId];
    if (!sourceLane) return 0;
    const sourceCenter = sourceLane.y + sourceLane.height / 2;
    const maxDepth = 24;
    const queue = [{ stepId: flow.to, depth: 0 }];
    const visited = new Set([flow.from]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current.stepId) || current.depth > maxDepth) continue;
        visited.add(current.stepId);
        const currentStep = stepsById.get(current.stepId);
        if (!currentStep) continue;

        if (currentStep._roleId && currentStep._roleId !== sourceStep._roleId) {
            const lane = laneMeta?.[currentStep._roleId];
            if (lane) {
                const center = lane.y + lane.height / 2;
                if (center < sourceCenter) return -1;
                if (center > sourceCenter) return 1;
            }
        }

        allFlows.forEach((candidate) => {
            if (candidate.from !== current.stepId) return;
            if (!visited.has(candidate.to)) {
                queue.push({ stepId: candidate.to, depth: current.depth + 1 });
            }
        });
    }

    if (!targetStep._roleId) return 0;
    const targetLane = laneMeta?.[targetStep._roleId];
    if (!targetLane) return 0;
    const targetCenter = targetLane.y + targetLane.height / 2;
    if (targetCenter < sourceCenter) return -1;
    if (targetCenter > sourceCenter) return 1;
    return 0;
}

function resolveGatewayBranchDirectionWithFallback(flow, allFlows, stepsById, laneMeta, fromPos = null, toPos = null) {
    const preferred = resolveGatewayBranchDirection(flow, allFlows, stepsById, laneMeta);
    if (preferred !== 0) return preferred;
    if (fromPos && toPos) {
        if (toPos.y < fromPos.y) return -1;
        if (toPos.y > fromPos.y) return 1;
    }
    const text = `${flow.from}->${flow.to}`;
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash += text.charCodeAt(i);
    return hash % 2 === 0 ? -1 : 1;
}

function isHorizontalSegment(a, b) {
    return a.y === b.y && a.x !== b.x;
}

function isVerticalSegment(a, b) {
    return a.x === b.x && a.y !== b.y;
}

function pointEquals(a, b) {
    return a.x === b.x && a.y === b.y;
}

function getSegmentIntersection(a1, a2, b1, b2) {
    if (isHorizontalSegment(a1, a2) && isVerticalSegment(b1, b2)) {
        const inX = Math.min(a1.x, a2.x) <= b1.x && b1.x <= Math.max(a1.x, a2.x);
        const inY = Math.min(b1.y, b2.y) <= a1.y && a1.y <= Math.max(b1.y, b2.y);
        if (inX && inY) return { x: b1.x, y: a1.y };
    }
    if (isVerticalSegment(a1, a2) && isHorizontalSegment(b1, b2)) {
        const inX = Math.min(b1.x, b2.x) <= a1.x && a1.x <= Math.max(b1.x, b2.x);
        const inY = Math.min(a1.y, a2.y) <= b1.y && b1.y <= Math.max(a1.y, a2.y);
        if (inX && inY) return { x: a1.x, y: b1.y };
    }
    return null;
}

function insertBridge(points, segmentIndex, crossPoint, size = 10) {
    const start = points[segmentIndex];
    const end = points[segmentIndex + 1];
    if (!isHorizontalSegment(start, end)) return points;

    const span = Math.abs(end.x - start.x);
    if (span < 100) return points;

    const dir = end.x > start.x ? 1 : -1;
    if (dir < 0) return points;
    const firstX = snap(crossPoint.x - dir * size);
    const secondX = snap(crossPoint.x + dir * size);
    const bridgeY = snap(start.y - size);

    // If there is not enough room, skip bridge insertion.
    if (
        (firstX <= start.x || secondX >= end.x)
    ) {
        return points;
    }

    const prefix = points.slice(0, segmentIndex + 1);
    const suffix = points.slice(segmentIndex + 2);
    return [
        ...prefix,
        { x: firstX, y: start.y },
        { x: firstX, y: bridgeY },
        { x: secondX, y: bridgeY },
        { x: secondX, y: start.y },
        ...suffix
    ];
}

function applyFlowBridges(flowWaypoints, flows, stepsById) {
    const source = flowWaypoints.map((points) => points.map((p) => ({ ...p })));
    const result = flowWaypoints.map((points) => points.map((p) => ({ ...p })));
    const bridgePlan = new Map();
    
    // Design-Regel 5: Überlappungs-Regel - keine Überlappungen zwischen Elementen und Pfeilen
    const checkFlowShapeOverlaps = (flowIndex, waypoints) => {
        const flow = flows[flowIndex];
        if (!flow) return false;
        
        const fromStep = stepsById.get(flow.from);
        const toStep = stepsById.get(flow.to);
        if (!fromStep || !toStep) return false;
        
        const fromSize = getNodeSize(fromStep);
        const toSize = getNodeSize(toStep);
        const fromPos = { x: waypoints[0].x - fromSize.width, y: waypoints[0].y - fromSize.height / 2 };
        const toPos = { x: waypoints[waypoints.length - 1].x, y: waypoints[waypoints.length - 1].y - toSize.height / 2 };
        
        // Prüfe Überlappungen mit anderen Elementen
        for (let i = 0; i < flows.length; i++) {
            if (i === flowIndex) continue;
            
            const otherFlow = flows[i];
            const otherStep = stepsById.get(otherFlow.from);
            if (!otherStep) continue;
            
            const otherSize = getNodeSize(otherStep);
            const otherPos = { x: waypoints[0].x - otherSize.width, y: waypoints[0].y - otherSize.height / 2 };
            
            // Erweitere Bounding Box für Pfeil-Überlappungsprüfung
            const flowBounds = [
                { x: fromPos.x - 10, y: fromPos.y - 10 },
                { x: fromPos.x + fromSize.width + 10, y: fromPos.y + fromSize.height + 10 }
            ];
            const otherBounds = [
                { x: otherPos.x - 10, y: otherPos.y - 10 },
                { x: otherPos.x + otherSize.width + 10, y: otherPos.y + otherSize.height + 10 }
            ];
            
            // Einfache Bounding Box Überlappungsprüfung
            if (flowBounds[0].x < otherBounds[1].x && flowBounds[1].x > otherBounds[0].x &&
                flowBounds[0].y < otherBounds[1].y && flowBounds[1].y > otherBounds[0].y) {
                return true;
            }
        }
        return false;
    };
    
    const isBridgeCandidateFlow = (flowIndex) => {
        const flow = flows[flowIndex];
        const fromStep = stepsById.get(flow?.from);
        const toStep = stepsById.get(flow?.to);
        const flowClass = classifyFlowRoutingClass(flow, fromStep);
        if (flowClass === "gateway-side" || flowClass === "loop") return false;
        return fromStep?._roleId && toStep?._roleId && fromStep._roleId !== toStep._roleId;
    };
    const isProtectedBridgeSegment = (flowIndex, segmentIndex) => {
        const flow = flows[flowIndex];
        const sourceStep = stepsById.get(flow?.from);
        const flowClass = classifyFlowRoutingClass(flow, sourceStep);
        if (flowClass === "gateway-side" && segmentIndex < ROUTING_POLICY.PROTECT_GATEWAY_SIDE_EXIT_SEGMENTS) {
            return true;
        }
        if (flowClass === "main" && segmentIndex < ROUTING_POLICY.PROTECT_MAIN_SOURCE_SEGMENTS) {
            return true;
        }
        if (
            flowClass === "loop"
            && segmentIndex >= Math.max(0, (source?.[flowIndex]?.length || 0) - 1 - ROUTING_POLICY.PROTECT_LOOP_TARGET_SEGMENTS)
        ) {
            return true;
        }
        return false;
    };
    const isOrthogonalPoints = (points) => {
        for (let i = 0; i < points.length - 1; i += 1) {
            const a = points[i];
            const b = points[i + 1];
            const horizontal = a.y === b.y;
            const vertical = a.x === b.x;
            if (!horizontal && !vertical) return false;
        }
        return true;
    };

    for (let i = 0; i < source.length; i += 1) {
        // Design-Regel 5: Prüfe auf Überlappungen vor Brücken-Erstellung
        if (checkFlowShapeOverlaps(i, source[i])) {
            // Erzwinge größeren Abstand bei Überlappungen
            const adjustedPoints = source[i].map(point => ({
                ...point,
                y: point.y + (i % 2 === 0 ? 20 : -20)
            }));
            source[i] = adjustedPoints;
        }
        
        for (let j = i + 1; j < source.length; j += 1) {
            const pointsA = source[i];
            const pointsB = source[j];

            for (let a = 0; a < pointsA.length - 1; a += 1) {
                for (let b = 0; b < pointsB.length - 1; b += 1) {
                    const cross = getSegmentIntersection(pointsA[a], pointsA[a + 1], pointsB[b], pointsB[b + 1]);
                    if (!cross) continue;

                    const endpointContact =
                        pointEquals(cross, pointsA[a])
                        || pointEquals(cross, pointsA[a + 1])
                        || pointEquals(cross, pointsB[b])
                        || pointEquals(cross, pointsB[b + 1]);
                    if (endpointContact) continue;

                    // Plan one bridge per flow for readability and stability.
                    const preferJ = !bridgePlan.has(j)
                        && isBridgeCandidateFlow(j)
                        && isHorizontalSegment(pointsB[b], pointsB[b + 1]);
                    const bridgeFlowIndex = preferJ ? j : i;
                    const bridgeSegIndex = bridgeFlowIndex === j ? b : a;
                    const bridgePoints = bridgeFlowIndex === j ? pointsB : pointsA;
                    if (isProtectedBridgeSegment(bridgeFlowIndex, bridgeSegIndex)) continue;

                    const flowForBridge = flows[bridgeFlowIndex];
                    if (flowForBridge?._isBackEdge) continue;

                    const bSegA = bridgePoints[bridgeSegIndex];
                    const bSegB = bridgePoints[bridgeSegIndex + 1];
                    if (
                        !bridgePlan.has(bridgeFlowIndex)
                        && isBridgeCandidateFlow(bridgeFlowIndex)
                        && isHorizontalSegment(bSegA, bSegB)
                        && Math.abs(bSegB.x - bSegA.x) >= 100
                    ) {
                        bridgePlan.set(bridgeFlowIndex, { segmentIndex: bridgeSegIndex, crossPoint: cross });
                    }
                }
            }
        }
    }

    bridgePlan.forEach((plan, flowIndex) => {
        if (flows[flowIndex]?._isBackEdge) return;
        const withBridge = insertBridge(result[flowIndex], plan.segmentIndex, plan.crossPoint);
        result[flowIndex] = isOrthogonalPoints(withBridge) ? withBridge : result[flowIndex];
    });

    return result;
}

function resolveInterFlowCrossings(flowWaypoints, flows = [], stepsById = null) {
    const result = flowWaypoints.map((points) => points.map((p) => ({ ...p })));

    const segmentsOf = (points, flowIndex) => {
        const segments = [];
        for (let i = 0; i < points.length - 1; i += 1) {
            segments.push({
                flowIndex,
                segIndex: i,
                a: points[i],
                b: points[i + 1]
            });
        }
        return segments;
    };

    const isEndpointTouch = (cross, seg) =>
        pointEquals(cross, seg.a) || pointEquals(cross, seg.b);

    const hasCollinearOverlap = (segA, segB) => {
        const aVertical = isVerticalSegment(segA.a, segA.b);
        const bVertical = isVerticalSegment(segB.a, segB.b);
        const aHorizontal = isHorizontalSegment(segA.a, segA.b);
        const bHorizontal = isHorizontalSegment(segB.a, segB.b);

        if (aVertical && bVertical && segA.a.x === segB.a.x) {
            const overlap =
                Math.max(Math.min(segA.a.y, segA.b.y), Math.min(segB.a.y, segB.b.y))
                < Math.min(Math.max(segA.a.y, segA.b.y), Math.max(segB.a.y, segB.b.y));
            if (overlap) return "vertical";
        }

        if (aHorizontal && bHorizontal && segA.a.y === segB.a.y) {
            const overlap =
                Math.max(Math.min(segA.a.x, segA.b.x), Math.min(segB.a.x, segB.b.x))
                < Math.min(Math.max(segA.a.x, segA.b.x), Math.max(segB.a.x, segB.b.x));
            if (overlap) return "horizontal";
        }

        return null;
    };

    const nudgeSegment = (points, segIndex, axis, amount) => {
        const p1 = points[segIndex];
        const p2 = points[segIndex + 1];
        if (axis === "x") {
            const next = Math.max(12, p1.x + amount);
            if (next === p1.x) return false;
            p1.x = next;
            p2.x = next;
            return true;
        }
        p1.y += amount;
        p2.y += amount;
        return true;
    };

    let changed = true;
    let pass = 0;
    while (changed && pass < 6) {
        pass += 1;
        changed = false;

        for (let i = 0; i < result.length; i += 1) {
            const current = result[i];
            const currentSegments = segmentsOf(current, i);
            const flow = flows[i];
            if (flow?._preferShortestJoin || flow?._isBackEdge) continue;
            const sourceStep = stepsById && flow ? stepsById.get(flow.from) : null;
            const flowClass = classifyFlowRoutingClass(flow, sourceStep);
            if (flowClass === "gateway-side") continue;

            for (const seg of currentSegments) {
                if (flowClass === "main" && seg.segIndex < ROUTING_POLICY.PROTECT_MAIN_SOURCE_SEGMENTS) {
                    continue;
                }
                let conflictMove = null;
                const allPrevious = result
                    .slice(0, i)
                    .flatMap((points, idx) => segmentsOf(points, idx));

                for (const prev of allPrevious) {
                    const cross = getSegmentIntersection(seg.a, seg.b, prev.a, prev.b);
                    if (cross && !isEndpointTouch(cross, seg) && !isEndpointTouch(cross, prev)) {
                        if (isVerticalSegment(seg.a, seg.b)) {
                            conflictMove = { axis: "x", amount: -36 };
                        } else if (isHorizontalSegment(seg.a, seg.b) && isVerticalSegment(prev.a, prev.b)) {
                            conflictMove = { axis: "y", amount: (i % 2 === 0 ? -1 : 1) * 36 };
                        } else {
                            conflictMove = { axis: "y", amount: (i % 2 === 0 ? -1 : 1) * 36 };
                        }
                        break;
                    }

                    const overlapType = hasCollinearOverlap(seg, prev);
                    if (overlapType) {
                        if (overlapType === "vertical") {
                            conflictMove = { axis: "x", amount: -36 };
                        } else {
                            conflictMove = { axis: "y", amount: (i % 2 === 0 ? -1 : 1) * 36 };
                        }
                        break;
                    }
                }

                if (!conflictMove) continue;
                const moved = nudgeSegment(
                    current,
                    seg.segIndex,
                    conflictMove.axis,
                    conflictMove.amount
                );
                if (moved) {
                    changed = true;
                    break;
                }
            }
        }
    }

    return result;
}

function separateParallelSegmentOverlaps(flowWaypoints, flows = [], stepsById = null) {
    const result = flowWaypoints.map((points) => points.map((p) => ({ ...p })));

    const segmentsOf = (points, flowIndex) => {
        const segments = [];
        for (let i = 0; i < points.length - 1; i += 1) {
            const a = points[i];
            const b = points[i + 1];
            segments.push({
                flowIndex,
                segIndex: i,
                a,
                b,
                horizontal: a.y === b.y && a.x !== b.x,
                vertical: a.x === b.x && a.y !== b.y
            });
        }
        return segments;
    };

    const overlapLength = (a1, a2, b1, b2) =>
        Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));

    const nudgeSegment = (points, segIndex, axis, amount) => {
        const p1 = points[segIndex];
        const p2 = points[segIndex + 1];
        if (!p1 || !p2) return false;
        if (axis === "x") {
            p1.x = snap(p1.x + amount);
            p2.x = snap(p2.x + amount);
            return true;
        }
        p1.y = snap(p1.y + amount);
        p2.y = snap(p2.y + amount);
        return true;
    };

    for (let pass = 0; pass < 4; pass += 1) {
        let changed = false;

        for (let i = 1; i < result.length; i += 1) {
            const currentFlow = flows[i];
            const currentSource = currentFlow ? stepsById?.get(currentFlow.from) : null;
            const flowClass = classifyFlowRoutingClass(currentFlow, currentSource);
            const protectGatewayExit = flowClass === "gateway-side";
            const currentSegments = segmentsOf(result[i], i);
            const previousSegments = result.slice(0, i).flatMap((points, idx) => segmentsOf(points, idx));

            for (const seg of currentSegments) {
                if (protectGatewayExit && seg.segIndex < ROUTING_POLICY.PROTECT_GATEWAY_SIDE_EXIT_SEGMENTS) continue;
                if (
                    flowClass === "loop"
                    && seg.segIndex >= result[i].length - ROUTING_POLICY.PROTECT_LOOP_TARGET_SEGMENTS
                ) continue;
                if (seg.segIndex >= result[i].length - 2 && flowClass !== "loop") continue;
                if (flowClass === "main" && seg.segIndex < ROUTING_POLICY.PROTECT_MAIN_SOURCE_SEGMENTS) continue;

                for (const prev of previousSegments) {
                    if (seg.horizontal && prev.horizontal && seg.a.y === prev.a.y) {
                        const overlap = overlapLength(seg.a.x, seg.b.x, prev.a.x, prev.b.x);
                        if (overlap > 28) {
                            const direction = (i + seg.segIndex) % 2 === 0 ? 1 : -1;
                            if (nudgeSegment(result[i], seg.segIndex, "y", direction * 24)) {
                                changed = true;
                            }
                            break;
                        }
                    }
                    if (seg.vertical && prev.vertical && seg.a.x === prev.a.x) {
                        const overlap = overlapLength(seg.a.y, seg.b.y, prev.a.y, prev.b.y);
                        if (overlap > 28) {
                            const direction = (i + seg.segIndex) % 2 === 0 ? 1 : -1;
                            if (nudgeSegment(result[i], seg.segIndex, "x", direction * 24)) {
                                changed = true;
                            }
                            break;
                        }
                    }
                }

                if (changed) break;
            }
        }

        if (!changed) break;
    }

    return result;
}

function enforceOrthogonalWaypoints(flowWaypoints, flows = [], stepsById = null) {
    const usedVerticalRails = new Set();
    const usedHorizontalRails = new Set();

    return flowWaypoints.map((points, flowIndex) => {
        if (!Array.isArray(points) || points.length < 2) return points;
        const flow = flows[flowIndex];
        const sourceStep = stepsById && flow ? stepsById.get(flow.from) : null;
        const preserveGatewayExitDiagonal = Boolean(
            sourceStep?.type === "gateway"
            && flow?._isMain
            && points[1]
            && points[0].x !== points[1].x
            && points[0].y !== points[1].y
        );
        const normalized = preserveGatewayExitDiagonal ? [points[0], points[1]] : [points[0]];
        const startIndex = preserveGatewayExitDiagonal ? 2 : 1;

        for (let i = startIndex; i < points.length; i += 1) {
            const prev = normalized[normalized.length - 1];
            const next = points[i];
            const horizontal = prev.y === next.y;
            const vertical = prev.x === next.x;

            if (!horizontal && !vertical) {
                const candidateA = { x: next.x, y: prev.y };
                const candidateB = { x: prev.x, y: next.y };

                // A: horizontal on prev.y + vertical on next.x
                const scoreA =
                    (usedHorizontalRails.has(prev.y) ? 1 : 0)
                    + (usedVerticalRails.has(next.x) ? 1 : 0);
                // B: vertical on prev.x + horizontal on next.y
                const scoreB =
                    (usedVerticalRails.has(prev.x) ? 1 : 0)
                    + (usedHorizontalRails.has(next.y) ? 1 : 0);

                normalized.push(scoreA <= scoreB ? candidateA : candidateB);
            }
            normalized.push(next);
        }

        const compacted = [normalized[0]];
        for (let i = 1; i < normalized.length; i += 1) {
            const prev = compacted[compacted.length - 1];
            const curr = normalized[i];
            if (prev.x === curr.x && prev.y === curr.y) continue;
            compacted.push(curr);
        }

        for (let i = 0; i < compacted.length - 1; i += 1) {
            const a = compacted[i];
            const b = compacted[i + 1];
            if (a.x === b.x && a.y !== b.y) usedVerticalRails.add(a.x);
            if (a.y === b.y && a.x !== b.x) usedHorizontalRails.add(a.y);
        }

        return compacted;
    });
}

function segmentTouchesRectInterior(a, b, rect) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;

    if (a.y === b.y) {
        const y = a.y;
        if (!(top < y && y < bottom)) return false;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        return Math.max(minX, left) < Math.min(maxX, right);
    }

    if (a.x === b.x) {
        const x = a.x;
        if (!(left < x && x < right)) return false;
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        return Math.max(minY, top) < Math.min(maxY, bottom);
    }

    return false;
}

function resolveFlowOverShapeIntersections(flowWaypoints, flows, stepRects, laneBounds, stepsById) {
    const result = flowWaypoints.map((points) => points.map((p) => ({ ...p })));
    let pass = 0;
    let changed = true;
    const maxX = laneBounds.maxX + 360;
    const minX = Math.max(24, laneBounds.minX - 360);

    while (changed && pass < 8) {
        changed = false;
        pass += 1;

        for (let i = 0; i < result.length; i += 1) {
            const points = result[i];
            const flow = flows[i];
            if (!flow || points.length < 2) continue;
            if (flow._preferShortestJoin) continue;
            const sourceStep = stepsById?.get(flow.from);
            const flowClass = classifyFlowRoutingClass(flow, sourceStep);
            if (flowClass === "loop") continue;
            const protectedGatewaySegments = flowClass === "gateway-side"
                ? ROUTING_POLICY.PROTECT_GATEWAY_SIDE_EXIT_SEGMENTS
                : 0;

            for (let s = 0; s < points.length - 1; s += 1) {
                if (s < protectedGatewaySegments) continue;
                if (flowClass === "main" && s < ROUTING_POLICY.PROTECT_MAIN_SOURCE_SEGMENTS) continue;
                const a = points[s];
                const b = points[s + 1];

                for (const [stepId, rect] of stepRects.entries()) {
                    if (stepId === flow.from || stepId === flow.to) continue;
                    if (!segmentTouchesRectInterior(a, b, rect)) continue;

                    if (a.y === b.y) {
                        const aboveY = snap(laneBounds.minY - 72 - i * 12);
                        const belowY = snap(laneBounds.maxY + 72 + i * 12);
                        const nextY = Math.abs(a.y - aboveY) <= Math.abs(a.y - belowY) ? aboveY : belowY;
                        a.y = nextY;
                        b.y = nextY;
                        changed = true;
                        break;
                    }

                    if (a.x === b.x) {
                        const leftX = snap(Math.max(minX, laneBounds.minX - 72 - i * 12));
                        const rightX = snap(Math.min(maxX, laneBounds.maxX + 72 + i * 12));
                        const nextX = Math.abs(a.x - leftX) <= Math.abs(a.x - rightX) ? leftX : rightX;
                        a.x = nextX;
                        b.x = nextX;
                        changed = true;
                        break;
                    }
                }

                if (changed) break;
            }
        }
    }

    return result;
}

function enforceGatewayExitDiagonals(flowWaypoints, flows, stepsById) {
    void flows;
    void stepsById;
    return flowWaypoints;
}

function enforceDominantForwardEdges(flowWaypoints, flows, stepsById, positions) {
    const outgoingIndex = buildOutgoingIndex(flows, positions, stepsById);
    return flowWaypoints.map((points, index) => {
        const flow = flows[index];
        if (!flow) return points;
        const fromStep = stepsById.get(flow.from);
        const toStep = stepsById.get(flow.to);
        const fromPos = positions[flow.from];
        const toPos = positions[flow.to];
        if (!fromStep || !toStep || !fromPos || !toPos) return points;

        const meta = outgoingIndex.get(index) || { localIndex: 0 };
        const isPrimaryForward = meta.localIndex === 0;
        const sameRole = fromStep._roleId && toStep._roleId && fromStep._roleId === toStep._roleId;
        const fromSize = getNodeSize(fromStep);
        const toSize = getNodeSize(toStep);
        const startX = fromPos.x + fromSize.width;
        const startY = fromPos.y + fromSize.height / 2;
        const endX = toPos.x;
        const endY = toPos.y + toSize.height / 2;
        const sameRow = Math.abs(snap(startY) - snap(endY)) <= SNAP_GRID;
        const isTaskToGateway = fromStep.type !== "gateway" && toStep.type === "gateway";
        const flowClass = classifyFlowRoutingClass(flow, fromStep);
        if (flowClass === "gateway-side" || flowClass === "loop") return points;

        if (
            isPrimaryForward
            && isTaskToGateway
            && endX > startX
            && Math.abs(snap(startY) - snap(endY)) <= SNAP_GRID * 2
        ) {
            return [
                { x: snap(startX), y: snap(startY) },
                { x: snap(endX), y: snap(startY) }
            ];
        }

        if (isPrimaryForward && sameRole && endX > startX && sameRow) {
            return [
                { x: snap(startX), y: snap(startY) },
                { x: snap(endX), y: snap(endY) }
            ];
        }

        return points;
    });
}

function enforceFlowEndpoints(flowWaypoints, flows, stepsById, positions, laneMeta, outgoingIndexMeta = null) {
    const incomingByTarget = new Map();
    flows.forEach((flow, idx) => {
        const list = incomingByTarget.get(flow.to) || [];
        list.push({ ...flow, flowIndex: idx });
        incomingByTarget.set(flow.to, list);
    });
    const incomingIndex = new Map();
    incomingByTarget.forEach((list) => {
        list.forEach((item, localIndex) => {
            incomingIndex.set(item.flowIndex, { localIndex, total: list.length });
        });
    });
    const loopFlows = flows
        .map((flow, idx) => ({ flow, flowIndex: idx }))
        .filter((entry) => Boolean(entry.flow?._isBackEdge));
    const loopIncomingIndex = new Map();
    loopFlows.forEach((entry, localIndex) => {
        loopIncomingIndex.set(entry.flowIndex, { localIndex, total: loopFlows.length });
    });

    return flowWaypoints.map((points, index) => {
        const flow = flows[index];
        if (!flow) return points;
        const fromStep = stepsById.get(flow.from);
        const toStep = stepsById.get(flow.to);
        const fromPos = positions[flow.from];
        const toPos = positions[flow.to];
        if (!fromStep || !toStep || !fromPos || !toPos) return points;

        const fromSize = getNodeSize(fromStep);
        const toSize = getNodeSize(toStep);
        const outgoingMeta = outgoingIndexMeta?.get(index) || { localIndex: 0, isPrimary: false };
        const branchKind = classifyBranchLabel(flow.condition);
        const preferYesAsMain = shouldPreferYesAsMainExit(fromStep, flow, flows);
        let isGatewayMainExit = isGatewayMainExitFlow(fromStep, flow, outgoingMeta)
            || (
                preferYesAsMain
                && toPos.x > fromPos.x
            );
        if (
            fromStep?.type === "gateway"
            && branchKind === "yes"
            && !flow?._isBackEdge
            && toPos.x > fromPos.x
        ) {
            isGatewayMainExit = true;
        }
        const branchDirection = fromStep?.type === "gateway" && !isGatewayMainExit
            ? ((branchKind === "no" || branchKind === "error")
                ? 1
                : resolveGatewayBranchDirectionWithFallback(flow, flows, stepsById, laneMeta, fromPos, toPos))
            : 0;
        const gatewayTopBottomStart = fromStep?.type === "gateway" && !isGatewayMainExit
            ? {
                x: Math.round(fromPos.x + fromSize.width / 2),
                y: Math.round(branchDirection < 0 ? fromPos.y : (fromPos.y + fromSize.height))
            }
            : null;
        const start = gatewayTopBottomStart || {
            x: Math.round(fromPos.x + fromSize.width),
            y: Math.round(fromPos.y + fromSize.height / 2)
        };
        const inMeta = incomingIndex.get(index) || { localIndex: 0, total: 1 };
        const targetAnchorY = inMeta.total <= 1
            ? (toPos.y + toSize.height / 2)
            : (toPos.y + ((inMeta.localIndex + 1) * toSize.height) / (inMeta.total + 1));
        const isLoop = Boolean(flow._isBackEdge);
        const targetCenterX = toPos.x + toSize.width / 2;
        const end = isLoop
            ? {
                x: Math.round(targetCenterX),
                y: Math.round(toPos.y + toSize.height)
            }
            : {
                x: Math.round(toPos.x),
                y: Math.round(toStep.type === "endEvent" ? (toPos.y + toSize.height / 2) : targetAnchorY)
            };

        const safe = Array.isArray(points) ? points.map((p) => ({ ...p })) : [];
        if (safe.length < 2) {
            return [start, end];
        }

        safe[0] = start;
        safe[safe.length - 1] = end;

        const second = safe[1];
        if (fromStep.type !== "gateway" && second && second.x !== start.x && second.y !== start.y) {
            safe.splice(1, 0, { x: second.x, y: start.y });
        }
        if (fromStep.type === "gateway") {
            if (!isGatewayMainExit) {
                const fallbackDir = safe[1]?.y > start.y ? 1 : safe[1]?.y < start.y ? -1 : 1;
                const sideDir = branchDirection !== 0 ? branchDirection : fallbackDir;
                const stubY = snap(start.y + sideDir * 24);
                if (!safe[1]) safe.push({ x: start.x, y: stubY });
                else {
                    safe[1].x = start.x;
                    safe[1].y = stubY;
                }
                if (!safe[2]) {
                    safe.push({ x: snap(start.x + 48), y: stubY });
                } else if (safe[2].y !== stubY) {
                    safe.splice(2, 0, { x: safe[2].x, y: stubY });
                }
            } else if (safe[1]) {
                safe[1].y = start.y;
                if (safe[1].x <= start.x) safe[1].x = snap(start.x + 24);
            }
        }

        const loopMeta = loopIncomingIndex.get(index) || { localIndex: 0, total: 1 };
        const spreadIndex = loopMeta.localIndex - (loopMeta.total - 1) / 2;
        const loopRailX = isLoop && loopMeta.total > 1
            ? snap(end.x + (spreadIndex === 0 ? 24 : spreadIndex * 24))
            : end.x;
        const prevIndex = safe.length - 2;
        const prev = safe[prevIndex];
        const last = safe[safe.length - 1];
        if (isLoop && prev && loopMeta.total > 1) {
            if (prev.x !== loopRailX) {
                safe.splice(safe.length - 1, 0, { x: loopRailX, y: prev.y });
            }
            const nearEnd = safe[safe.length - 2];
            if (nearEnd.y !== last.y || nearEnd.x !== loopRailX) {
                safe.splice(safe.length - 1, 0, { x: loopRailX, y: last.y });
            }
        } else if (prev && last && prev.x !== last.x && prev.y !== last.y) {
            safe.splice(safe.length - 1, 0, { x: last.x, y: prev.y });
        }

        return safe;
    });
}

function enforceGatewaySplitPattern(flowWaypoints, flows, stepsById) {
    const outgoingBySource = new Map();
    flows.forEach((flow, idx) => {
        const list = outgoingBySource.get(flow.from) || [];
        list.push({ ...flow, flowIndex: idx });
        outgoingBySource.set(flow.from, list);
    });
    const flowOrderByIndex = new Map();
    outgoingBySource.forEach((list) => {
        list.forEach((item, localIndex) => {
            flowOrderByIndex.set(item.flowIndex, { localIndex, total: list.length });
        });
    });

    return flowWaypoints.map((points, index) => {
        const flow = flows[index];
        if (!flow || !Array.isArray(points) || points.length < 2) return points;
        const fromStep = stepsById.get(flow.from);
        if (fromStep?.type !== "gateway") return points;

        const result = points.map((p) => ({ ...p }));
        if (!flow._isMain) {
            // Hard side-branch rule: keep explicit side exit geometry untouched.
            return result;
        }
        const start = result[0];
        const branchKind = classifyBranchLabel(flow.condition);
        if (!result[1]) return result;

        result[1].y = start.y;
        if (result[1].x <= start.x) {
            result[1].x = snap(start.x + 24);
        }

        if (branchKind === "no" && result[2]) {
            result[2].y = start.y;
        }

        // Keep one gateway branch visibly on the main axis after the first segment.
        const meta = flowOrderByIndex.get(index) || { localIndex: 0, total: 1 };
        const isPrimaryBranch = meta.total > 1 && meta.localIndex === 0;
        if (isPrimaryBranch) {
            if (!result[2]) {
                result.push({ x: snap(result[1].x + 24), y: start.y });
            } else if (result[2].y !== start.y) {
                result.splice(2, 0, { x: snap(Math.max(result[1].x + 24, start.x + 48)), y: start.y });
            }
        }

        return result;
    });
}

function computeStepRank(steps, flows, startId) {
    const rank = {};
    steps.forEach((step) => {
        rank[step.id] = Number.MAX_SAFE_INTEGER;
    });

    rank[startId] = 0;
    const queue = [startId];

    while (queue.length > 0) {
        const current = queue.shift();
        const outgoing = flows.filter((flow) => flow.from === current);
        outgoing.forEach((flow) => {
            const nextRank = (rank[current] ?? 0) + 1;
            if (nextRank < (rank[flow.to] ?? Number.MAX_SAFE_INTEGER)) {
                rank[flow.to] = nextRank;
                queue.push(flow.to);
            }
        });
    }

    steps.forEach((step) => {
        if (rank[step.id] === Number.MAX_SAFE_INTEGER) {
            rank[step.id] = 1;
        }
    });

    return rank;
}

function computeMainPath(startId, flows, rank) {
    const outgoingBySource = new Map();
    flows.forEach((flow) => {
        const list = outgoingBySource.get(flow.from) || [];
        list.push(flow);
        outgoingBySource.set(flow.from, list);
    });

    const path = [startId];
    const visited = new Set([startId]);
    let current = startId;
    let guard = 0;

    while (guard < flows.length + 5) {
        guard += 1;
        const outgoing = outgoingBySource.get(current) || [];
        if (outgoing.length === 0) break;

        const currentRank = rank[current] ?? 0;
        const nextFlow = [...outgoing]
            .filter((flow) => !visited.has(flow.to))
            .sort((a, b) => {
                const rankA = (rank[a.to] ?? currentRank) - currentRank;
                const rankB = (rank[b.to] ?? currentRank) - currentRank;
                const kindA = classifyBranchLabel(a.condition);
                const kindB = classifyBranchLabel(b.condition);
                const kindScore = (kind) => (kind === "yes" ? 3 : kind === "no" ? 1 : 2);
                return (rankB + kindScore(kindB)) - (rankA + kindScore(kindA));
            })[0];

        if (!nextFlow) break;
        path.push(nextFlow.to);
        visited.add(nextFlow.to);
        current = nextFlow.to;
    }

    return path;
}

function branchLeadsToLoop(startId, flows, rank, thresholdRank) {
    const outgoingBySource = new Map();
    flows.forEach((flow) => {
        const list = outgoingBySource.get(flow.from) || [];
        list.push(flow.to);
        outgoingBySource.set(flow.from, list);
    });
    const visited = new Set();
    const queue = [startId];
    let guard = 0;
    while (queue.length > 0 && guard < flows.length * 4 + 16) {
        guard += 1;
        const current = queue.shift();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        const currentRank = Number(rank[current] ?? Number.MAX_SAFE_INTEGER);
        if (currentRank < thresholdRank) return true;
        const nextTargets = outgoingBySource.get(current) || [];
        nextTargets.forEach((nextId) => {
            if (!visited.has(nextId)) queue.push(nextId);
        });
    }
    return false;
}

export function generateBPMN(process, options = {}) {
    const strictQuality = Boolean(options?.strictQuality);
    const roles = Array.isArray(process?.roles) && process.roles.length > 0 ? process.roles : ["System"];
    const processAnnotations = Array.isArray(process?.annotations)
        ? JSON.parse(JSON.stringify(process.annotations))
        : [];
    const steps = JSON.parse(JSON.stringify(process?.steps || []));
    let stepById = new Map(steps.map((step) => [step.id, step]));

    const flows = [];
    steps.forEach((step) => {
        if (Array.isArray(step.next)) {
            step.next.forEach((target) => {
                if (stepById.has(target)) flows.push({ from: step.id, to: target });
            });
        }
        if (Array.isArray(step.conditions)) {
            step.conditions.forEach((cond) => {
                if (stepById.has(cond.target)) {
                    flows.push({
                        from: step.id,
                        to: cond.target,
                        condition: normalizeBranchLabel(cond.label, "Bedingung")
                    });
                }
            });
        }
    });

    steps.forEach((step) => {
        step.type = normalizeType(step);
    });

    const hasOutgoing = new Set(flows.map((flow) => flow.from));
    steps.forEach((step) => {
        if (!hasOutgoing.has(step.id) && step.type !== "gateway") {
            step.type = "endEvent";
        }
    });

    const incoming = new Set(flows.map((flow) => flow.to));
    const startCandidates = steps.filter((step) => !incoming.has(step.id));
    const startId = "StartEvent_1";

    steps.unshift({
        id: startId,
        type: "startEvent",
        label: "Start"
    });

    startCandidates.forEach((step) => {
        flows.unshift({ from: startId, to: step.id });
    });
    let normalizedFlows = dedupeFlows(flows);

    const roleMap = {};
    roles.forEach((role, i) => {
        const id = typeof role === "string" ? `role_${i}` : role.id || `role_${i}`;
        const rawName = typeof role === "string" ? role : role.name || `Role ${i + 1}`;
        const name = compactLabel(rawName, 3) || `Role ${i + 1}`;
        roleMap[id] = { id, name, steps: [] };
    });

    const defaultRoleId = Object.keys(roleMap)[0];

    steps.forEach((step) => {
        let roleId;
        if (step.type === "startEvent") {
            const firstTarget = normalizedFlows.find((flow) => flow.from === startId)?.to;
            const targetStep = steps.find((candidate) => candidate.id === firstTarget);
            roleId = Object.values(roleMap).find((role) => role.name === targetStep?.role)?.id;
        } else {
            roleId = Object.values(roleMap).find((role) => role.name === step.role)?.id;
        }

        if (!roleId) roleId = defaultRoleId;
        roleMap[roleId].steps.push(step.id);
        step._roleId = roleId;
    });

    const liveById = new Map(steps.map((step) => [step.id, step]));
    steps.forEach((step) => {
        if (step.type === "startEvent" || step.type === "gateway" || step.type === "endEvent") return;
        const timers = Array.isArray(step.boundaryTimers) ? step.boundaryTimers : [];
        timers.forEach((bt, i) => {
            const target = typeof bt?.target === "string" ? bt.target : "";
            if (!target || !liveById.has(target)) return;
            const bid = `${step.id}_timer_${i}`;
            if (liveById.has(bid)) return;
            const interrupting = bt.interrupting !== false;
            const durationRaw = typeof bt.duration === "string" ? bt.duration.trim().slice(0, 120) : "";
            const bstep = {
                id: bid,
                type: "boundaryTimer",
                label: compactLabel(bt.label || "Timer", 3) || "Timer",
                hostId: step.id,
                boundaryTarget: target,
                role: step.role,
                _roleId: step._roleId,
                interrupting,
                duration: durationRaw || undefined
            };
            steps.push(bstep);
            liveById.set(bid, bstep);
            roleMap[step._roleId].steps.push(bid);
            normalizedFlows.push({ from: bid, to: target });
        });
    });
    normalizedFlows = dedupeFlows(normalizedFlows);

    stepById = new Map(steps.map((step) => [step.id, step]));

    const rank = computeStepRank(steps, normalizedFlows, startId);
    steps.forEach((step) => {
        if (step.type === "boundaryTimer" && step.hostId && rank[step.hostId] != null) {
            rank[step.id] = rank[step.hostId];
        }
    });
    const mainPath = computeMainPath(startId, normalizedFlows, rank);
    const mainPathIndex = new Map(mainPath.map((stepId, idx) => [stepId, idx]));
    const mainEdges = new Set();
    for (let i = 0; i < mainPath.length - 1; i += 1) {
        mainEdges.add(`${mainPath[i]}->${mainPath[i + 1]}`);
    }
    normalizedFlows.forEach((flow) => {
        const fromRank = Number(rank[flow.from] ?? 0);
        const toRank = Number(rank[flow.to] ?? 0);
        const loopByRank = toRank <= fromRank;
        const fromStep = stepById.get(flow.from);
        const gatewayBranchLeadsToLoop = fromStep?.type === "gateway"
            && branchLeadsToLoop(flow.to, normalizedFlows, rank, fromRank);
        flow._leadsToLoop = Boolean(gatewayBranchLeadsToLoop);
        flow._isMain = mainEdges.has(`${flow.from}->${flow.to}`) && !loopByRank && !gatewayBranchLeadsToLoop;
    });

    const roleRankGroups = new Map();
    steps.forEach((step) => {
        if (step.type === "boundaryTimer") return;
        const currentRank = rank[step.id] || 1;
        const key = `${step._roleId}:${currentRank}`;
        const group = roleRankGroups.get(key) || [];
        group.push(step);
        roleRankGroups.set(key, group);
    });

    const positions = {};
    const laneMeta = {};
    const STEP_SLOT = 84;
    const LANE_BRANCH_OFFSET = 72;
    const LANE_PADDING = 16;
    const LANE_BASE_HEIGHT = 120;
    const LANE_GAP = 12;
    let currentY = 88;

    const stepByIdWithStart = new Map(steps.map((step) => [step.id, step]));
    const incomingByTarget = new Map();
    const outgoingBySource = new Map();
    normalizedFlows.forEach((flow) => {
        incomingByTarget.set(flow.to, (incomingByTarget.get(flow.to) || 0) + 1);
        outgoingBySource.set(flow.from, (outgoingBySource.get(flow.from) || 0) + 1);
    });
    const hasGateway = steps.some((step) => step.type === "gateway");
    const maxOutDegree = Math.max(1, ...steps.map((step) => outgoingBySource.get(step.id) || 0));
    const maxInDegree = Math.max(1, ...steps.map((step) => incomingByTarget.get(step.id) || 0));
    const isLinearLike = !hasGateway && maxOutDegree <= 1 && maxInDegree <= 1;
    // Design-Regel 3: Platzsparende Prozessmodell-Optimierung
    const RANK_SPACING = isLinearLike ? 160 : hasGateway ? 200 : 180;
    const BASE_X = isLinearLike ? 156 : 180;

    const gatewayBranchOffsetByTarget = new Map();
    const outgoingBySourceList = new Map();
    normalizedFlows.forEach((flow) => {
        const list = outgoingBySourceList.get(flow.from) || [];
        list.push(flow);
        outgoingBySourceList.set(flow.from, list);
    });
    steps.forEach((step) => {
        if (step.type !== "gateway") return;
        const sourceRoleId = step._roleId;
        const outgoing = (outgoingBySourceList.get(step.id) || [])
            .filter((flow) => stepByIdWithStart.get(flow.to)?._roleId === sourceRoleId);
        if (outgoing.length <= 1) return;
        outgoing.forEach((flow, idx) => {
            if (gatewayBranchOffsetByTarget.has(flow.to)) return;
            const offset = idx === 0
                ? 0
                : (idx % 2 === 1 ? 1 : -1) * Math.ceil(idx / 2) * LANE_BRANCH_OFFSET;
            gatewayBranchOffsetByTarget.set(flow.to, offset);
        });
    });

    Object.values(roleMap).forEach((role) => {
        const groupSizes = [];
        roleRankGroups.forEach((group, key) => {
            if (key.startsWith(`${role.id}:`)) groupSizes.push(group.length);
        });

        let maxFanIn = 1;
        let maxFanOut = 1;
        role.steps.forEach((stepId) => {
            maxFanIn = Math.max(maxFanIn, incomingByTarget.get(stepId) || 1);
            maxFanOut = Math.max(maxFanOut, outgoingBySource.get(stepId) || 1);
        });

        const maxGatewayFanOut = role.steps.reduce((max, stepId) => {
            const s = stepByIdWithStart.get(stepId);
            if (s?.type !== "gateway") return max;
            return Math.max(max, (outgoingBySourceList.get(stepId) || []).length);
        }, 1);
        const branchBuffer = Math.max(0, maxFanIn - 1) * 20 + Math.max(0, maxFanOut - 1) * 16;
        const gatewayBranchBuffer = Math.max(0, maxGatewayFanOut - 1) * 30;
        const maxStack = Math.max(1, ...groupSizes);
        const stackHeight = (maxStack - 1) * STEP_SLOT + 60;
        const hasGateway = role.steps.some((stepId) => stepByIdWithStart.get(stepId)?.type === "gateway");
        const gatewayBuffer = hasGateway ? 12 : 0;
        const height = snap(
            Math.max(
                LANE_BASE_HEIGHT,
                stackHeight + LANE_PADDING * 2 + branchBuffer + gatewayBuffer + gatewayBranchBuffer
            )
        );
        laneMeta[role.id] = { y: currentY, height };
        currentY += height + LANE_GAP;
    });


    steps.forEach((step) => {
        if (step.type === "boundaryTimer") return;
        step._isMain = mainPathIndex.has(step.id);
        const lane = laneMeta[step._roleId];
        const currentRank = rank[step.id] || 1;
        const groupKey = `${step._roleId}:${currentRank}`;
        const group = roleRankGroups.get(groupKey) || [step];
        const roleRankIndex = Math.max(0, group.findIndex((candidate) => candidate.id === step.id));
        const centeredOffset = roleRankIndex - (group.length - 1) / 2;
        const { height } = getNodeSize(step);
        const effectiveBlockHeight = height + SHAPE_LABEL_GAP + SHAPE_LABEL_HEIGHT;
        const laneCenterY = lane.y + lane.height / 2;
        const minY = lane.y + LANE_PADDING;
        const maxY = lane.y + lane.height - LANE_PADDING - effectiveBlockHeight;
        const isMainNode = step._isMain;
        const branchOffset = gatewayBranchOffsetByTarget.get(step.id) || 0;
        const isGatewayNode = step.type === "gateway";
        const nonGatewayOffset = gatewayBranchOffsetByTarget.has(step.id)
            ? branchOffset
            : centeredOffset * STEP_SLOT;
        const rawY = isMainNode
            ? laneCenterY - effectiveBlockHeight / 2
            : isGatewayNode
                ? laneCenterY - height / 2 + centeredOffset * STEP_SLOT
                : laneCenterY - height / 2 + nonGatewayOffset;
        const y = snap(Math.max(minY, Math.min(maxY, rawY)));
        const x = snap(
            mainPathIndex.has(step.id)
                ? BASE_X + mainPathIndex.get(step.id) * RANK_SPACING
                : BASE_X + currentRank * RANK_SPACING
        );
        positions[step.id] = { x, y };
    });

    steps.forEach((step) => {
        if (step.type !== "boundaryTimer") return;
        const hostPos = positions[step.hostId];
        const hostStep = stepById.get(step.hostId);
        if (!hostPos || !hostStep) return;
        const hs = getNodeSize(hostStep);
        const bs = getNodeSize(step);
        positions[step.id] = {
            x: snap(hostPos.x + hs.width / 2 - bs.width / 2),
            y: snap(hostPos.y + hs.height - Math.floor(bs.height / 2))
        };
    });

    // Keep simple same-role chains visually straight on one axis.
    const incomingCount = new Map();
    const outgoingCount = new Map();
    normalizedFlows.forEach((flow) => {
        incomingCount.set(flow.to, (incomingCount.get(flow.to) || 0) + 1);
        outgoingCount.set(flow.from, (outgoingCount.get(flow.from) || 0) + 1);
    });
    for (let pass = 0; pass < 3; pass += 1) {
        let changed = false;
        normalizedFlows.forEach((flow) => {
            const fromStep = stepById.get(flow.from);
            const toStep = stepById.get(flow.to);
            if (!fromStep || !toStep) return;
            if (fromStep.type === "gateway") return;
            if (fromStep._roleId !== toStep._roleId) return;
            if ((outgoingCount.get(flow.from) || 0) !== 1) return;
            if ((incomingCount.get(flow.to) || 0) !== 1) return;
            if (toStep._isMain) return;

            const fromPos = positions[flow.from];
            const toPos = positions[flow.to];
            const fromSize = getNodeSize(fromStep);
            const toSize = getNodeSize(toStep);
            const fromCenter = fromPos.y + fromSize.height / 2;
            const targetY = snap(fromCenter - toSize.height / 2);
            if (toPos.y !== targetY) {
                toPos.y = targetY;
                changed = true;
            }
        });
        if (!changed) break;
    }

    // Keep primary forward branch on source row when a split exists in same role.
    const longestPathToEnd = computeLongestPathToEnd(steps, normalizedFlows);
    const outgoingMetaByFlow = buildOutgoingIndex(normalizedFlows, positions, stepById, longestPathToEnd);
    normalizedFlows.forEach((flow, flowIndex) => {
        const meta = outgoingMetaByFlow.get(flowIndex) || { localIndex: 0, total: 1 };
        if (meta.total <= 1 || meta.localIndex !== 0) return;
        const fromStep = stepById.get(flow.from);
        const toStep = stepById.get(flow.to);
        if (!fromStep || !toStep) return;
        if (fromStep.type === "gateway") return;
        if (toStep._isMain) return;
        if (fromStep._roleId !== toStep._roleId) return;

        const fromPos = positions[flow.from];
        const toPos = positions[flow.to];
        const fromSize = getNodeSize(fromStep);
        const toSize = getNodeSize(toStep);
        const lane = laneMeta[toStep._roleId];
        const sourceCenterY = fromPos.y + fromSize.height / 2;
        const minY = lane.y + LANE_PADDING;
        const maxY = lane.y + lane.height - LANE_PADDING - toSize.height;
        toPos.y = snap(Math.max(minY, Math.min(maxY, sourceCenterY - toSize.height / 2)));
    });

    // Explicitly align forward Task->Gateway edges on the same Y axis
    // even when gateway has additional incoming loop edges.
    normalizedFlows.forEach((flow) => {
        const fromStep = stepById.get(flow.from);
        const toStep = stepById.get(flow.to);
        if (!fromStep || !toStep) return;
        if (fromStep.type === "gateway" || toStep.type !== "gateway") return;
        if (toStep._isMain) return;
        if (fromStep._roleId !== toStep._roleId) return;

        const fromPos = positions[flow.from];
        const toPos = positions[flow.to];
        const fromSize = getNodeSize(fromStep);
        const toSize = getNodeSize(toStep);
        const startX = fromPos.x + fromSize.width;
        const endX = toPos.x;
        if (endX <= startX) return;

        const lane = laneMeta[toStep._roleId];
        const sourceCenterY = fromPos.y + fromSize.height / 2;
        const minY = lane.y + LANE_PADDING;
        const maxY = lane.y + lane.height - LANE_PADDING - toSize.height;
        toPos.y = snap(Math.max(minY, Math.min(maxY, sourceCenterY - toSize.height / 2)));
    });

    // Reuse the relayout strategy from the editor button:
    // resolve shape overlaps inside each lane before edge routing.
    resolveLaneNodeOverlaps(steps, positions, laneMeta, LANE_PADDING);

    // Neue Kreuzungsvermeidung: Versuche, Flow-Kreuzungen zu reduzieren
    detectAndReduceFlowCrossings(normalizedFlows, positions, steps, laneMeta);

    const firstFlow = normalizedFlows.find((flow) => flow.from === startId);
    if (firstFlow && positions[firstFlow.to]) {
        const firstTargetStep = steps.find((step) => step.id === firstFlow.to);
        const startSize = getNodeSize(steps.find((step) => step.id === startId));
        const targetSize = getNodeSize(firstTargetStep);
        positions[startId] = {
            x: snap(positions[firstFlow.to].x - Math.max(104, RANK_SPACING - 56)),
            y: snap(positions[firstFlow.to].y + (targetSize.height - startSize.height) / 2)
        };
    }

    // For strict linear flows, enforce uniform center-to-center spacing
    // so arrow segments look equally long between consecutive nodes.
    if (isLinearLike && mainPath.length >= 2) {
        const linearCenterSpacing = 188;
        const firstMainId = mainPath[0];
        const firstMainStep = stepByIdWithStart.get(firstMainId);
        const firstMainPos = positions[firstMainId];
        if (firstMainStep && firstMainPos) {
            const firstSize = getNodeSize(firstMainStep);
            const baseCenterX = firstMainPos.x + firstSize.width / 2;
            mainPath.forEach((stepId, idx) => {
                const step = stepByIdWithStart.get(stepId);
                const pos = positions[stepId];
                if (!step || !pos) return;
                const size = getNodeSize(step);
                const centerX = baseCenterX + idx * linearCenterSpacing;
                pos.x = snap(centerX - size.width / 2);
            });
        }
    }

    const nonEndRight = Math.max(
        ...steps
            .filter((step) => step.type !== "endEvent")
            .map((step) => {
                const pos = positions[step.id];
                const size = getNodeSize(step);
                return (pos?.x || 0) + size.width;
            })
    );
    const endByRole = new Map();
    steps.filter((step) => step.type === "endEvent").forEach((step) => {
        const key = step._roleId || "_default";
        const list = endByRole.get(key) || [];
        list.push(step);
        endByRole.set(key, list);
    });
    endByRole.forEach((endSteps, roleId) => {
        const lane = laneMeta[roleId];
        endSteps.forEach((step, idx) => {
            const pos = positions[step.id];
            if (!pos) return;
            const size = getNodeSize(step);
            const preferredCenterY = lane ? lane.y + lane.height / 2 : pos.y + size.height / 2;
            const minY = lane ? lane.y + LANE_PADDING : pos.y;
            const maxY = lane ? lane.y + lane.height - LANE_PADDING - size.height : pos.y;
            pos.x = snap(nonEndRight + 144 + idx * 60);
            pos.y = snap(Math.max(minY, Math.min(maxY, preferredCenterY - size.height / 2)));
        });
    });

    // Adaptive compaction: tighten horizontal whitespace inside lanes,
    // but only for simple nodes to avoid creating crossing clusters.
    compactLaneHorizontalGaps(steps, positions, normalizedFlows, laneMeta);

    // Keep gateway successors from collapsing onto the split point.
    for (let pass = 0; pass < 3; pass += 1) {
        let moved = false;
        normalizedFlows.forEach((flow) => {
            const fromStep = stepById.get(flow.from);
            const toStep = stepById.get(flow.to);
            if (!fromStep || !toStep || fromStep.type !== "gateway") return;
            const fromPos = positions[flow.from];
            const toPos = positions[flow.to];
            if (!fromPos || !toPos) return;
            const fromSize = getNodeSize(fromStep);
            const minGap = 84;
            const minTargetX = snap(fromPos.x + fromSize.width + minGap);
            if (toPos.x < minTargetX) {
                toPos.x = minTargetX;
                moved = true;
            }
        });
        if (!moved) break;
    }

    normalizedFlows.forEach((flow) => {
        const fromStep = stepById.get(flow.from);
        const toStep = stepById.get(flow.to);
        const fromPos = positions[flow.from];
        const toPos = positions[flow.to];
        if (!fromStep || !toStep || !fromPos || !toPos) return;
        const fromSize = getNodeSize(fromStep);
        const startXGeom = fromPos.x + fromSize.width;
        const endXGeom = toPos.x;
        const fromRank = Number(rank[flow.from] ?? 0);
        const toRank = Number(rank[flow.to] ?? 0);
        flow._isBackEdge = toRank <= fromRank;
    });

    const nodeBounds = steps.map((step) => {
        const pos = positions[step.id];
        const { width } = getNodeSize(step);
        return { left: pos.x, right: pos.x + width };
    });
    const contentMinX = Math.min(...nodeBounds.map((bounds) => bounds.left));
    const contentMaxX = Math.max(...nodeBounds.map((bounds) => bounds.right));
    const shiftX = snap((LANE_X + LANE_SIDE_PADDING) - contentMinX);
    if (shiftX !== 0) {
        Object.keys(positions).forEach((stepId) => {
            positions[stepId].x = snap(positions[stepId].x + shiftX);
        });
    }
    const shiftedMaxX = contentMaxX + shiftX;
    let diagramWidth = snap(Math.max(540, shiftedMaxX - LANE_X + LANE_SIDE_PADDING));

    const annotationLayouts = [];
    let annCounter = 0;
    processAnnotations.forEach((ann) => {
        const attachId = typeof ann.attachTo === "string" ? ann.attachTo : "";
        const hostStep = stepById.get(attachId);
        if (!attachId || !positions[attachId] || !hostStep) return;
        annCounter += 1;
        const aid = typeof ann.id === "string" && ann.id.trim() ? ann.id.trim() : `TextAnn_${annCounter}`;
        const textRaw = String(ann.text ?? ann.label ?? "Hinweis").trim();
        const textDisplay = compactLabel(textRaw, 40) || "Hinweis";
        const pos = positions[attachId];
        const sz = getNodeSize(hostStep);
        const tw = Math.min(300, Math.max(96, textDisplay.length * 6 + 32));
        const th = 72;
        const ax = snap(pos.x + sz.width + 24);
        const ay = snap(pos.y + 6);
        annotationLayouts.push({
            id: aid,
            text: escapeXml(textDisplay),
            attachTo: attachId,
            x: ax,
            y: ay,
            w: tw,
            h: th
        });
    });

    if (annotationLayouts.length > 0) {
        const maxAnnRight = Math.max(...annotationLayouts.map((a) => a.x + a.w));
        const minW = snap(maxAnnRight - LANE_X + LANE_SIDE_PADDING + 40);
        if (minW > diagramWidth) diagramWidth = minW;
    }

    const gatewayDefaultFlowByStepId = new Map();
    const gatewayOutflows = new Map();
    normalizedFlows.forEach((flow, idx) => {
        const source = stepById.get(flow.from);
        if (source?.type !== "gateway") return;
        const list = gatewayOutflows.get(flow.from) || [];
        list.push({ idx, kind: classifyBranchLabel(flow.condition) });
        gatewayOutflows.set(flow.from, list);
    });
    gatewayOutflows.forEach((list, gatewayId) => {
        if (list.length < 2) return;
        const noBranch = list.find((item) => item.kind === "no");
        const errorBranch = list.find((item) => item.kind === "error");
        const defaultBranch = noBranch || errorBranch || list[list.length - 1];
        gatewayDefaultFlowByStepId.set(gatewayId, `flow_${defaultBranch.idx}`);
    });

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
xmlns:probpm="${PROBPM_EMAIL_NS}"
id="Defs_1">
<bpmn:process id="Process_1" isExecutable="false">`;

    xml += `<bpmn:laneSet id="LaneSet_1">`;
    Object.values(roleMap).forEach((role) => {
        xml += `<bpmn:lane id="Lane_${role.id}" name="${escapeXml(role.name)}">`;
        role.steps.forEach((stepId) => {
            xml += `<bpmn:flowNodeRef>${stepId}</bpmn:flowNodeRef>`;
        });
        xml += `</bpmn:lane>`;
    });
    xml += `</bpmn:laneSet>`;

    steps.forEach((step) => {
        const name = escapeXml(compactLabel(step.label || "undefined", 3));
        if (step.type === "startEvent") {
            xml += `<bpmn:startEvent id="${step.id}" name="${name}" />`;
        } else if (step.type === "endEvent") {
            const endName = name === "undefined" ? "Ende" : name;
            xml += `<bpmn:endEvent id="${step.id}" name="${endName}" />`;
        } else if (step.type === "gateway") {
            const gatewayName = normalizeGatewayDisplayName(name === "undefined" ? "Entscheidung" : name);
            const defaultFlowRef = gatewayDefaultFlowByStepId.get(step.id);
            const defaultAttr = defaultFlowRef ? ` default="${defaultFlowRef}"` : "";
            xml += `<bpmn:exclusiveGateway id="${step.id}" name="${gatewayName}"${defaultAttr} />`;
        } else if (step.type === "boundaryTimer") {
            const cancel = step.interrupting === false ? "false" : "true";
            const dur = typeof step.duration === "string" && step.duration
                ? `<bpmn:timeDuration xsi:type="bpmn:tFormalExpression">${escapeXml(step.duration)}</bpmn:timeDuration>`
                : "";
            xml += `<bpmn:boundaryEvent id="${step.id}" name="${name}" attachedToRef="${step.hostId}" cancelActivity="${cancel}"><bpmn:timerEventDefinition>${dur}</bpmn:timerEventDefinition></bpmn:boundaryEvent>`;
        } else {
            xml += buildActivityElementXml(step, name);
        }
    });

    normalizedFlows.forEach((flow, i) => {
        const name = flow.condition ? ` name="${escapeXml(flow.condition)}"` : "";
        xml += `<bpmn:sequenceFlow id="flow_${i}" sourceRef="${flow.from}" targetRef="${flow.to}"${name} />`;
    });

    annotationLayouts.forEach((ann) => {
        const assocId = `Association_${ann.id}`;
        xml += `<bpmn:textAnnotation id="${ann.id}"><bpmn:text>${ann.text}</bpmn:text></bpmn:textAnnotation>`;
        xml += `<bpmn:association id="${assocId}" sourceRef="${ann.id}" targetRef="${ann.attachTo}" />`;
    });

    xml += `</bpmn:process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="Process_1">`;

    Object.values(roleMap).forEach((role) => {
        const meta = laneMeta[role.id];
        xml += `<bpmndi:BPMNShape bpmnElement="Lane_${role.id}" isHorizontal="true"><dc:Bounds x="${LANE_X}" y="${meta.y}" width="${diagramWidth}" height="${meta.height}" /></bpmndi:BPMNShape>`;
    });

    const stepsById = new Map(steps.map((step) => [step.id, step]));
    normalizedFlows.forEach((flow) => {
        const fromStep = stepsById.get(flow.from);
        const toStep = stepsById.get(flow.to);
        const fromPos = positions[flow.from];
        const toPos = positions[flow.to];
        flow._preferShortestJoin = Boolean(
            fromStep?.type !== "gateway"
            && toStep?.type === "gateway"
            && fromPos
            && toPos
        );
    });
    steps.forEach((step) => {
        const pos = positions[step.id];
        const { width, height } = getNodeSize(step);
        const labelText = compactLabel(step.label || "undefined", 3);
        const labelWidth = Math.max(48, Math.min(180, labelText.length * 7));
        const labelX = snap(pos.x + width / 2 - labelWidth / 2);
        const labelY = snap(pos.y + height + SHAPE_LABEL_GAP);
        xml += `<bpmndi:BPMNShape bpmnElement="${step.id}"><dc:Bounds x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" /><bpmndi:BPMNLabel><dc:Bounds x="${labelX}" y="${labelY}" width="${labelWidth}" height="18" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>`;
    });

    annotationLayouts.forEach((ann) => {
        xml += `<bpmndi:BPMNShape bpmnElement="${ann.id}"><dc:Bounds x="${ann.x}" y="${ann.y}" width="${ann.w}" height="${ann.h}" /></bpmndi:BPMNShape>`;
    });

    const outgoingIndexMeta = buildOutgoingIndex(normalizedFlows, positions, stepsById, longestPathToEnd);
    const horizontalBands = new Map();
    const loopBands = new Map();
    const laneBounds = {
        minX: Math.min(...Object.values(positions).map((pos) => pos.x)),
        maxX: Math.max(...Object.values(positions).map((pos) => pos.x)),
        minY: Math.min(...Object.values(laneMeta).map((lane) => lane.y)),
        maxY: Math.max(...Object.values(laneMeta).map((lane) => lane.y + lane.height))
    };
    const corridorState = {
        up: 0,
        down: 0,
        roleChange: 0,
        loop: 0,
        gatewayBranchLevels: new Map(),
        gatewayForks: new Map(),
        taskForks: new Map()
    };
    const flowWaypoints = normalizedFlows.map((flow, i) => {
        const waypoints = routeFlow(
            flow,
            i,
            stepsById,
            positions,
            normalizedFlows,
            outgoingIndexMeta,
            horizontalBands,
            loopBands,
            corridorState,
            laneBounds,
            laneMeta,
            strictQuality
        );
        return waypoints || [];
    });

    const stepRects = new Map(
        steps.map((step) => {
            const pos = positions[step.id];
            const size = getNodeSize(step);
            return [step.id, { x: pos.x, y: pos.y, width: size.width, height: size.height }];
        })
    );

    let refinedWaypoints = flowWaypoints.map((points) => points.map((p) => ({ ...p })));
    for (let refinePass = 0; refinePass < 2; refinePass += 1) {
        refinedWaypoints = resolveInterFlowCrossings(refinedWaypoints, normalizedFlows, stepsById);
        refinedWaypoints = enforceOrthogonalWaypoints(refinedWaypoints, normalizedFlows, stepsById);
        refinedWaypoints = resolveFlowOverShapeIntersections(
            refinedWaypoints,
            normalizedFlows,
            stepRects,
            laneBounds,
            stepsById
        );
    }
    const withGatewayDiagonals = enforceGatewayExitDiagonals(refinedWaypoints, normalizedFlows, stepsById);
    const finalWaypoints = enforceDominantForwardEdges(
        withGatewayDiagonals,
        normalizedFlows,
        stepsById,
        positions
    );
    const splitPatternWaypoints = enforceGatewaySplitPattern(
        finalWaypoints,
        normalizedFlows,
        stepsById
    );
    const endpointSafeWaypoints = enforceFlowEndpoints(
        splitPatternWaypoints,
        normalizedFlows,
        stepsById,
        positions,
        laneMeta,
        outgoingIndexMeta
    );
    const postEndpointResolved = resolveInterFlowCrossings(endpointSafeWaypoints, normalizedFlows, stepsById);
    const postEndpointOrthogonal = enforceOrthogonalWaypoints(postEndpointResolved, normalizedFlows, stepsById);
    const postEndpointSeparated = separateParallelSegmentOverlaps(postEndpointOrthogonal, normalizedFlows, stepsById);
    const postEndpointSeparatedOrthogonal = enforceOrthogonalWaypoints(postEndpointSeparated, normalizedFlows, stepsById);
    const postEndpointCollisionReduced = resolveFlowOverShapeIntersections(
        postEndpointSeparatedOrthogonal,
        normalizedFlows,
        stepRects,
        laneBounds,
        stepsById
    );
    const postEndpointCollisionOrthogonal = enforceOrthogonalWaypoints(
        postEndpointCollisionReduced,
        normalizedFlows,
        stepsById
    );
    const withFlowBridges = applyFlowBridges(postEndpointCollisionOrthogonal, normalizedFlows, stepsById);
    const finalEndpointWaypoints = enforceFlowEndpoints(
        withFlowBridges,
        normalizedFlows,
        stepsById,
        positions,
        laneMeta,
        outgoingIndexMeta
    );
    normalizedFlows.forEach((flow, i) => {
        const waypoints = compactOrthogonalWaypoints(finalEndpointWaypoints[i] || []);
        if (!waypoints || waypoints.length === 0) return;
        const waypointXml = waypoints
            .map((point) => `<di:waypoint x="${snap(point.x)}" y="${snap(point.y)}" />`)
            .join("");
        const fromStep = stepsById.get(flow.from);
        const hasConditionLabel = Boolean(flow.condition);
        const branchKind = classifyBranchLabel(flow.condition);
        const labelAnchor = fromStep?.type === "gateway"
            ? (
                branchKind === "error"
                    ? (waypoints[2] || waypoints[1] || waypoints[0])
                    : (waypoints[1] || waypoints[0])
            )
            : waypoints[0];
        const labelWidth = Math.max(48, Math.min(180, String(flow.condition || "").length * 7));
        const labelBounds = placeEdgeLabelBounds(labelAnchor, labelWidth, 18, stepRects, 0);
        const labelXml = hasConditionLabel
            ? `<bpmndi:BPMNLabel><dc:Bounds x="${labelBounds.x}" y="${labelBounds.y}" width="${labelBounds.width}" height="${labelBounds.height}" /></bpmndi:BPMNLabel>`
            : "";
        xml += `<bpmndi:BPMNEdge bpmnElement="flow_${i}">${waypointXml}${labelXml}</bpmndi:BPMNEdge>`;
    });

    annotationLayouts.forEach((ann) => {
        const tPos = positions[ann.attachTo];
        const tSize = getNodeSize(stepsById.get(ann.attachTo));
        if (!tPos || !tSize) return;
        const x1 = snap(ann.x);
        const y1 = snap(ann.y + ann.h / 2);
        const x2 = snap(tPos.x + tSize.width / 2);
        const y2 = snap(tPos.y + tSize.height / 2);
        const assocId = `Association_${ann.id}`;
        xml += `<bpmndi:BPMNEdge bpmnElement="${assocId}"><di:waypoint x="${x1}" y="${y1}" /><di:waypoint x="${x2}" y="${y2}" /></bpmndi:BPMNEdge>`;
    });

    xml += `</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
    return xml;
}