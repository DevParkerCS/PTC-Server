import express from "express";
import { supabase } from "../supabaseClient";
import { FAKE_USER_ID } from "../server";

const router = express.Router();

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("classes")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.log(error);
    return res.status(500).json({ error: "Failed to fetch classes" });
  }

  res.json(data);
});

router.post("/", async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({});
  }

  const { data, error } = await supabase
    .from("classes")
    .insert([
      {
        name,
        user_id: FAKE_USER_ID,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create class" });
  }

  res.status(201).json(data);
});

export default router;
