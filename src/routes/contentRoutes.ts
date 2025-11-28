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
    const [quizzesRes, flashcardsRes] = await Promise.all([
      supabase
        .from("quizzes")
        .select("id, title, num_questions, last_taken_at, created_at")
        .eq("class_id", classId),
      supabase
        .from("flashcards")
        .select("id, title, num_cards, last_used_at, created_at")
        .eq("class_id", classId),
    ]);

    const quizzes =
      quizzesRes.data?.map((row) => {
        const lastUsed = row.last_taken_at ?? row.created_at; // fallback if never taken

        return {
          id: row.id,
          type: "quiz",
          title: row.title,
          num_items: `${row.num_questions} Questions`,
          last_used_at: lastUsed, // ISO string from Supabase
        };
      }) ?? [];

    const flashcards =
      flashcardsRes.data?.map((row) => {
        const lastUsed = row.last_used_at ?? row.created_at;

        return {
          id: row.id,
          type: "card",
          title: row.title,
          num_items: `${row.num_cards} Cards`,
          last_used_at: lastUsed,
        };
      }) ?? [];

    const content = [...quizzes, ...flashcards].sort(
      (a, b) =>
        new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime()
    );

    return res.json(content);
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: "Failed to load class content (server error)" });
  }
});

export default router;
