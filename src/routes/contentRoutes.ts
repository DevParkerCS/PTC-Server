import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";

const router = express.Router();

router.get("/:id", requireAuth, async (req, res) => {
  const classId = req.params.id;

  if (!classId) {
    return res.status(400).json({ error: "ClassId Is Missing" });
  }

  try {
    const { data, error } = await supabase
      .from("quizzes")
      .select("id, title, num_questions, last_taken_at, created_at")
      .eq("class_id", classId)
      .order("created_at");

    const quizzes =
      data?.map((row) => {
        const lastUsed = row.last_taken_at ?? row.created_at;

        return {
          id: row.id,
          type: "quiz",
          title: row.title,
          num_items: row.num_questions,
          last_used_at: lastUsed,
        };
      }) ?? [];

    return res.json(quizzes);
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: "Failed to load class content (server error)" });
  }
});

export default router;
