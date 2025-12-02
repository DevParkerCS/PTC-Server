import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).user.id;

  const { data, error } = await supabase
    .from("classes")
    .select("*")
    .order("created_at", { ascending: true })
    .eq("user_id", userId);

  if (error) {
    console.log(error);
    return res.status(500).json({ error: "Failed to fetch classes" });
  }

  res.json(data);
});

router.post("/", requireAuth, async (req, res) => {
  const userId = (req as any).user?.id;
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({});
  }

  const { data, error } = await supabase
    .from("classes")
    .insert([
      {
        name,
        user_id: userId,
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
