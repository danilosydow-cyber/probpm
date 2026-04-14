function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function parseShapes(xml) {
    const shapes = [];
    const shapeRegex = /<bpmndi:BPMNShape bpmnElement="([^"]+)"[^>]*>\s*<dc:Bounds x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g;
    let match = shapeRegex.exec(xml);
    while (match) {
        shapes.push({
            id: match[1],
            x: toNumber(match[2]),
            y: toNumber(match[3]),
            width: toNumber(match[4]),
            height: toNumber(match[5])
        });
        match = shapeRegex.exec(xml);
    }
    return shapes;
}

function parseFlowRefs(xml) {
    const refs = new Map();
    const attrValue = (attrs, key) => {
        const re = new RegExp(`${key}="([^"]+)"`);
        const m = re.exec(attrs);
        return m ? m[1] : "";
    };
    const flowRegex = /<bpmn:sequenceFlow\s+([^>]+?)\/?>/g;
    let match = flowRegex.exec(xml);
    while (match) {
        const attrs = match[1];
        const id = attrValue(attrs, "id");
        const sourceRef = attrValue(attrs, "sourceRef");
        const targetRef = attrValue(attrs, "targetRef");
        if (id && sourceRef && targetRef) refs.set(id, { sourceRef, targetRef });
        match = flowRegex.exec(xml);
    }
    return refs;
}

function parseEdges(xml) {
    const edges = [];
    const edgeRegex = /<bpmndi:BPMNEdge bpmnElement="([^"]+)">([\s\S]*?)<\/bpmndi:BPMNEdge>/g;
    const waypointRegex = /<di:waypoint x="([^"]+)" y="([^"]+)"\s*\/>/g;
    let edgeMatch = edgeRegex.exec(xml);
    while (edgeMatch) {
        const id = edgeMatch[1];
        const body = edgeMatch[2];
        const points = [];
        let wp = waypointRegex.exec(body);
        while (wp) {
            points.push({ x: toNumber(wp[1]), y: toNumber(wp[2]) });
            wp = waypointRegex.exec(body);
        }
        if (points.length >= 2) edges.push({ id, points });
        edgeMatch = edgeRegex.exec(xml);
    }
    return edges;
}

function rectIntersectionArea(a, b) {
    const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return xOverlap * yOverlap;
}

function isHorizontal(a, b) {
    return a.y === b.y && a.x !== b.x;
}

function isVertical(a, b) {
    return a.x === b.x && a.y !== b.y;
}

function segments(edge) {
    const list = [];
    for (let i = 0; i < edge.points.length - 1; i += 1) {
        const a = edge.points[i];
        const b = edge.points[i + 1];
        if (a.x === b.x && a.y === b.y) continue;
        list.push({ a, b });
    }
    return list;
}

function pointEquals(a, b) {
    return a.x === b.x && a.y === b.y;
}

function pointNear(a, b, tolerance = 8) {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function pointInsideRectWithPadding(point, rect, padding = 12) {
    return point.x >= rect.x - padding
        && point.x <= rect.x + rect.width + padding
        && point.y >= rect.y - padding
        && point.y <= rect.y + rect.height + padding;
}

function segmentIntersection(a1, a2, b1, b2) {
    if (isHorizontal(a1, a2) && isVertical(b1, b2)) {
        const minAx = Math.min(a1.x, a2.x);
        const maxAx = Math.max(a1.x, a2.x);
        const minBy = Math.min(b1.y, b2.y);
        const maxBy = Math.max(b1.y, b2.y);
        if (minAx <= b1.x && b1.x <= maxAx && minBy <= a1.y && a1.y <= maxBy) {
            return { x: b1.x, y: a1.y };
        }
    }
    if (isVertical(a1, a2) && isHorizontal(b1, b2)) {
        const minBx = Math.min(b1.x, b2.x);
        const maxBx = Math.max(b1.x, b2.x);
        const minAy = Math.min(a1.y, a2.y);
        const maxAy = Math.max(a1.y, a2.y);
        if (minBx <= a1.x && a1.x <= maxBx && minAy <= b1.y && b1.y <= maxAy) {
            return { x: a1.x, y: b1.y };
        }
    }
    return null;
}

function segmentTouchesRectInterior(a, b, rect) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    if (a.y === b.y) {
        if (!(top < a.y && a.y < bottom)) return false;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        return Math.max(minX, left) < Math.min(maxX, right);
    }
    if (a.x === b.x) {
        if (!(left < a.x && a.x < right)) return false;
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        return Math.max(minY, top) < Math.min(maxY, bottom);
    }
    return false;
}

function segmentRectInteriorOverlapLength(a, b, rect) {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    if (a.y === b.y) {
        if (!(top < a.y && a.y < bottom)) return 0;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        return Math.max(0, Math.min(maxX, right) - Math.max(minX, left));
    }
    if (a.x === b.x) {
        if (!(left < a.x && a.x < right)) return 0;
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        return Math.max(0, Math.min(maxY, bottom) - Math.max(minY, top));
    }
    return 0;
}

function segmentTouchesDiamondInterior(a, b, rect, insetScale = 0.82) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const halfW = (rect.width * insetScale) / 2;
    const halfH = (rect.height * insetScale) / 2;
    if (halfW <= 0 || halfH <= 0) return false;

    if (a.y === b.y) {
        const y = a.y;
        const dyRatio = Math.abs(y - cy) / halfH;
        if (dyRatio >= 1) return false;
        const span = halfW * (1 - dyRatio);
        const left = cx - span;
        const right = cx + span;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        return Math.max(minX, left) < Math.min(maxX, right);
    }

    if (a.x === b.x) {
        const x = a.x;
        const dxRatio = Math.abs(x - cx) / halfW;
        if (dxRatio >= 1) return false;
        const span = halfH * (1 - dxRatio);
        const top = cy - span;
        const bottom = cy + span;
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        return Math.max(minY, top) < Math.min(maxY, bottom);
    }

    return false;
}

export function analyzeBpmnDiagram(xml, processJson = {}) {
    const CROSSING_NEAR_ENDPOINT_PX = 8;
    const CROSSING_SHAPE_PADDING_PX = 8;
    const SHAPE_OVERLAP_MIN_LENGTH = 10;
    const shapes = parseShapes(xml);
    const flowRefs = parseFlowRefs(xml);
    const edgeList = parseEdges(xml).filter((edge) => flowRefs.has(edge.id) || edge.id.startsWith("flow_"));
    const processSteps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    const stepTypeById = new Map(processSteps.map((step) => [String(step?.id || ""), String(step?.type || "").toLowerCase()]));
    const stepShapes = shapes.filter((shape) => (
        !shape.id.startsWith("Lane_")
        && !shape.id.startsWith("Participant_")
        && !shape.id.startsWith("TextAnnotation_")
        && !shape.id.startsWith("ann_")
    ));
    const stepShapeById = new Map(stepShapes.map((shape) => [shape.id, shape]));

    const laneLikeShapes = shapes.filter((shape) => shape.id.startsWith("Lane_") || shape.id.startsWith("Participant_"));
    const workspaceShapes = laneLikeShapes.length > 0 ? laneLikeShapes : stepShapes;
    const workspace = workspaceShapes.length === 0
        ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        : {
            minX: Math.min(...workspaceShapes.map((shape) => shape.x)) - 18,
            minY: Math.min(...workspaceShapes.map((shape) => shape.y)) - 18,
            maxX: Math.max(...workspaceShapes.map((shape) => shape.x + shape.width)) + 18,
            maxY: Math.max(...workspaceShapes.map((shape) => shape.y + shape.height)) + 18
        };

    let elementOverlaps = 0;
    for (let i = 0; i < stepShapes.length; i += 1) {
        for (let j = i + 1; j < stepShapes.length; j += 1) {
            if (rectIntersectionArea(stepShapes[i], stepShapes[j]) > 0) elementOverlaps += 1;
        }
    }

    let flowCrossingsTotal = 0;
    let flowCrossingsNecessary = 0;
    let flowCrossingsAvoidable = 0;
    const countedCrossings = new Set();
    const pairCrossings = new Map();
    for (let i = 0; i < edgeList.length; i += 1) {
        const edgeA = edgeList[i];
        const refsA = flowRefs.get(edgeA.id) || {};
        const segA = segments(edgeA);
        for (let j = i + 1; j < edgeList.length; j += 1) {
            const edgeB = edgeList[j];
            const refsB = flowRefs.get(edgeB.id) || {};
            const segB = segments(edgeB);
            const endpointRects = [
                stepShapeById.get(refsA.sourceRef),
                stepShapeById.get(refsA.targetRef),
                stepShapeById.get(refsB.sourceRef),
                stepShapeById.get(refsB.targetRef)
            ].filter(Boolean);
            for (const a of segA) {
                for (const b of segB) {
                    const intersection = segmentIntersection(a.a, a.b, b.a, b.b);
                    if (!intersection) continue;
                    const sharedEndpoint = pointEquals(intersection, a.a)
                        || pointEquals(intersection, a.b)
                        || pointEquals(intersection, b.a)
                        || pointEquals(intersection, b.b);
                    if (sharedEndpoint) continue;
                    const nearSegmentEndpoint = pointNear(intersection, a.a, CROSSING_NEAR_ENDPOINT_PX)
                        || pointNear(intersection, a.b, CROSSING_NEAR_ENDPOINT_PX)
                        || pointNear(intersection, b.a, CROSSING_NEAR_ENDPOINT_PX)
                        || pointNear(intersection, b.b, CROSSING_NEAR_ENDPOINT_PX);
                    if (nearSegmentEndpoint) continue;
                    const crossingKey = `${edgeA.id}|${edgeB.id}|${Math.round(intersection.x / 6)}:${Math.round(intersection.y / 6)}`;
                    if (countedCrossings.has(crossingKey)) continue;
                    countedCrossings.add(crossingKey);
                    const pairKey = `${edgeA.id}|${edgeB.id}`;
                    const nearEndpointShape = endpointRects.some((rect) => (
                        pointInsideRectWithPadding(intersection, rect, CROSSING_SHAPE_PADDING_PX)
                    ));
                    const outsideCore = intersection.x < workspace.minX
                        || intersection.x > workspace.maxX
                        || intersection.y < workspace.minY
                        || intersection.y > workspace.maxY;
                    const nearAnyShape = stepShapes.some((shape) => (
                        pointInsideRectWithPadding(intersection, shape, CROSSING_SHAPE_PADDING_PX)
                    ));
                    const pairState = pairCrossings.get(pairKey) || { avoidable: 0, necessary: 0 };
                    if (outsideCore || nearEndpointShape || nearAnyShape) pairState.necessary += 1;
                    else pairState.avoidable += 1;
                    pairCrossings.set(pairKey, pairState);
                }
            }
        }
    }
    pairCrossings.forEach((state) => {
        flowCrossingsTotal += 1;
        if (state.avoidable > state.necessary) flowCrossingsAvoidable += 1;
        else flowCrossingsNecessary += 1;
    });

    let flowShapeOverlaps = 0;
    const countedFlowShape = new Set();
    edgeList.forEach((edge) => {
        const refs = flowRefs.get(edge.id) || {};
        const sourceRef = refs.sourceRef;
        const targetRef = refs.targetRef;
        const segs = segments(edge);
        segs.forEach((seg) => {
            stepShapes.forEach((shape) => {
                if (shape.id === sourceRef || shape.id === targetRef) return;
                const shapeType = stepTypeById.get(shape.id) || "";
                const touchesInterior = shapeType === "gateway"
                    ? segmentTouchesDiamondInterior(seg.a, seg.b, shape)
                    : segmentTouchesRectInterior(seg.a, seg.b, shape);
                if (touchesInterior) {
                    const overlapLength = shapeType === "gateway"
                        ? SHAPE_OVERLAP_MIN_LENGTH
                        : segmentRectInteriorOverlapLength(seg.a, seg.b, shape);
                    if (overlapLength < SHAPE_OVERLAP_MIN_LENGTH) return;
                    const key = `${edge.id}->${shape.id}`;
                    if (!countedFlowShape.has(key)) {
                        countedFlowShape.add(key);
                        flowShapeOverlaps += 1;
                    }
                }
            });
        });
    });

    let outOfWorkspaceFlows = 0;
    edgeList.forEach((edge) => {
        const hasOutsidePoint = edge.points.some((point) => (
            point.x < workspace.minX
            || point.x > workspace.maxX
            || point.y < workspace.minY
            || point.y > workspace.maxY
        ));
        if (hasOutsidePoint) outOfWorkspaceFlows += 1;
    });

    return {
        elementOverlaps,
        flowCrossingsTotal,
        flowCrossingsNecessary,
        flowCrossingsAvoidable,
        flowShapeOverlaps,
        outOfWorkspaceFlows
    };
}
