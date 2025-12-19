import express from "express";
import { supabaseAsUser } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";

const router = express.Router();

router.get("/:id", requireAuth, async (req, res) => {
  const classId = req.params.id;
  const userId = (req as any).user?.id;
  const token = (req as any).accessToken;

  if (!classId) {
    return res.status(400).json({ error: "ClassId Is Missing" });
  }

  const supabase = supabaseAsUser(token);

  try {
    const { data, error } = await supabase
      .from("quizzes")
      .select()
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("fetch quizzes error:", error);
      return res.status(500).json({ error: error.message });
    }

    const quizzes =
      data?.map((row) => {
        const lastUsed = row.last_taken_at;

        return {
          id: row.id,
          type: "quiz",
          title: row.title,
          num_items: row.num_questions,
          last_used_at: lastUsed,
          created_at: row.created_at,
          status: row.status,
          difficulty: row.difficulty,
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
