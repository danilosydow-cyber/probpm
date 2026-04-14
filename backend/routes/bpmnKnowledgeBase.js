import express from "express";

import { getBpmnKnowledgeBase } from "../services/bpmnKnowledgeBase.js";

export function createBpmnKnowledgeBaseRouter({ getKnowledgeBase = getBpmnKnowledgeBase } = {}) {
    const router = express.Router();

    router.get("/", (req, res, next) => {
        try {
            const { category, level, search } = req.query || {};
            const data = getKnowledgeBase({ category, level, search });
            res.json({
                success: true,
                data
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
