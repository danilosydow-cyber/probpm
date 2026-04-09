export function getSequenceFlowId(xml, sourceRef, targetRef) {
    const escapedSource = sourceRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedTarget = targetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flowRegex = new RegExp(
        `<bpmn:sequenceFlow id="([^"]+)" sourceRef="${escapedSource}" targetRef="${escapedTarget}"`,
        "i"
    );
    const match = flowRegex.exec(xml);
    return match ? match[1] : null;
}

export function getSequenceFlowName(xml, sourceRef, targetRef) {
    const escapedSource = sourceRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedTarget = targetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flowRegex = new RegExp(
        `<bpmn:sequenceFlow id="[^"]+" sourceRef="${escapedSource}" targetRef="${escapedTarget}"(?: name="([^"]+)")?`,
        "i"
    );
    const match = flowRegex.exec(xml);
    return match ? match[1] || "" : "";
}

export function getEdgeWaypoints(xml, flowId) {
    if (!flowId) return [];
    const edgeRegex = new RegExp(
        `<bpmndi:BPMNEdge bpmnElement="${flowId}">([\\s\\S]*?)<\\/bpmndi:BPMNEdge>`,
        "i"
    );
    const edgeMatch = edgeRegex.exec(xml);
    if (!edgeMatch) return [];
    const waypointRegex = /<di:waypoint x="(-?\d+)" y="(-?\d+)" \/>/g;
    const points = [];
    let match = waypointRegex.exec(edgeMatch[1]);
    while (match) {
        points.push({ x: Number(match[1]), y: Number(match[2]) });
        match = waypointRegex.exec(edgeMatch[1]);
    }
    return points;
}

export function isOrthogonal(points) {
    if (points.length < 2) return true;
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const horizontal = a.y === b.y;
        const vertical = a.x === b.x;
        if (!horizontal && !vertical) return false;
    }
    return true;
}

export function toSegments(points, flowId) {
    const segments = [];
    for (let i = 0; i < points.length - 1; i += 1) {
        segments.push({
            flowId,
            a: points[i],
            b: points[i + 1]
        });
    }
    return segments;
}

export function pointsEqual(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
}

export function segmentIntersection(seg1, seg2) {
    const { a: p1, b: p2 } = seg1;
    const { a: p3, b: p4 } = seg2;

    const seg1Horizontal = p1.y === p2.y;
    const seg2Horizontal = p3.y === p4.y;
    const seg1Vertical = p1.x === p2.x;
    const seg2Vertical = p3.x === p4.x;

    if (seg1Horizontal && seg2Vertical) {
        const inX = Math.min(p1.x, p2.x) <= p3.x && p3.x <= Math.max(p1.x, p2.x);
        const inY = Math.min(p3.y, p4.y) <= p1.y && p1.y <= Math.max(p3.y, p4.y);
        if (inX && inY) return { x: p3.x, y: p1.y };
    }
    if (seg1Vertical && seg2Horizontal) {
        const inX = Math.min(p3.x, p4.x) <= p1.x && p1.x <= Math.max(p3.x, p4.x);
        const inY = Math.min(p1.y, p2.y) <= p3.y && p3.y <= Math.max(p1.y, p2.y);
        if (inX && inY) return { x: p1.x, y: p3.y };
    }
    return null;
}

export function getAllFlowIds(xml) {
    const regex = /<bpmn:sequenceFlow id="([^"]+)"/g;
    const ids = [];
    let match = regex.exec(xml);
    while (match) {
        ids.push(match[1]);
        match = regex.exec(xml);
    }
    return ids;
}

export function getFlowRefs(xml) {
    const regex = /<bpmn:sequenceFlow id="([^"]+)" sourceRef="([^"]+)" targetRef="([^"]+)"/g;
    const refs = [];
    let match = regex.exec(xml);
    while (match) {
        refs.push({ flowId: match[1], sourceRef: match[2], targetRef: match[3] });
        match = regex.exec(xml);
    }
    return refs;
}

export function getLaneYBounds(xml) {
    const laneRegex = /<bpmndi:BPMNShape bpmnElement="Lane_[^"]+"[^>]*><dc:Bounds x="[^"]+" y="(-?\d+)" width="[^"]+" height="(-?\d+)" \/>/g;
    const values = [];
    let match = laneRegex.exec(xml);
    while (match) {
        const y = Number(match[1]);
        const h = Number(match[2]);
        values.push({ min: y, max: y + h });
        match = laneRegex.exec(xml);
    }
    if (values.length === 0) return null;
    return {
        min: Math.min(...values.map((v) => v.min)),
        max: Math.max(...values.map((v) => v.max))
    };
}

export function getLaneBounds(xml, laneElementId) {
    const escapedId = laneElementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const laneRegex = new RegExp(
        `<bpmndi:BPMNShape bpmnElement="${escapedId}"[^>]*><dc:Bounds x="(-?\\d+)" y="(-?\\d+)" width="(-?\\d+)" height="(-?\\d+)" \\/>`,
        "i"
    );
    const match = laneRegex.exec(xml);
    if (!match) return null;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: Number(match[4])
    };
}

export function getShapeBounds(xml, elementId) {
    const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shapeRegex = new RegExp(
        `<bpmndi:BPMNShape bpmnElement="${escapedId}"[^>]*><dc:Bounds x="(-?\\d+)" y="(-?\\d+)" width="(-?\\d+)" height="(-?\\d+)" \\/>`,
        "i"
    );
    const match = shapeRegex.exec(xml);
    if (!match) return null;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
        width: Number(match[3]),
        height: Number(match[4])
    };
}

export function segmentTouchesRectInterior(seg, rect) {
    if (!rect) return false;
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;

    if (seg.a.y === seg.b.y) {
        const y = seg.a.y;
        if (!(top < y && y < bottom)) return false;
        const minX = Math.min(seg.a.x, seg.b.x);
        const maxX = Math.max(seg.a.x, seg.b.x);
        return Math.max(minX, left) < Math.min(maxX, right);
    }

    if (seg.a.x === seg.b.x) {
        const x = seg.a.x;
        if (!(left < x && x < right)) return false;
        const minY = Math.min(seg.a.y, seg.b.y);
        const maxY = Math.max(seg.a.y, seg.b.y);
        return Math.max(minY, top) < Math.min(maxY, bottom);
    }

    return false;
}

export function segmentOverlapType(segA, segB) {
    const aHorizontal = segA.a.y === segA.b.y;
    const bHorizontal = segB.a.y === segB.b.y;
    const aVertical = segA.a.x === segA.b.x;
    const bVertical = segB.a.x === segB.b.x;

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
}

export function getEdgeLabelBounds(xml, flowId) {
    if (!flowId) return null;
    const edgeRegex = new RegExp(
        `<bpmndi:BPMNEdge bpmnElement="${flowId}">([\\s\\S]*?)<\\/bpmndi:BPMNEdge>`,
        "i"
    );
    const edgeMatch = edgeRegex.exec(xml);
    if (!edgeMatch) return null;
    const labelRegex = /<bpmndi:BPMNLabel><dc:Bounds x="(-?\d+)" y="(-?\d+)" width="(-?\d+)" height="(-?\d+)" \/><\/bpmndi:BPMNLabel>/i;
    const labelMatch = labelRegex.exec(edgeMatch[1]);
    if (!labelMatch) return null;
    return {
        x: Number(labelMatch[1]),
        y: Number(labelMatch[2]),
        width: Number(labelMatch[3]),
        height: Number(labelMatch[4])
    };
}
