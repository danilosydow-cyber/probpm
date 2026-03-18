import express from "express";
import { generateBpmn } from "../services/bpmnGenerator.js";

const router = express.Router();

router.post("/", async (req, res) => {

  const { text } = req.body;

  try {

    const xml = await generateBpmn(text);

    res.json({ xml });

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: "BPMN generation failed" });

  }

});

export default router;