import express from "express";
import { supabase } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  console.log(userId);

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

router.patch("/:classId/edit", requireAuth, async (req, res) => {
  const { classId } = req.params;
  const { newTitle } = req.body;

  if (!classId) {
    return res.status(400).json({ error: "Missing ClassID" });
  }

  try {
    const { data, error } = await supabase
      .from("classes")
      .update({
        name: newTitle,
      })
      .eq("id", classId)
      .select()
      .single();

    if (error) {
      console.log(error);
      return res.status(500).json({ error: "Error updating class" });
    }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "Server Error Updating Class" });
  }
});

router.delete("/:classId", requireAuth, async (req, res) => {
  const { classId } = req.params;

  if (!classId) {
    return res.status(400).json({ error: "ClassID is Missing" });
  }

  try {
    const { data, error } = await supabase
      .from("classes")
      .delete()
      .eq("id", classId)
      .single();

    if (error) {
      return res.status(500).json({ error: "Error deleting class" });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: "Error deleting class" });
  }
});

export default router;
