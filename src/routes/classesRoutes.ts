import express from "express";
import { supabaseAsUser } from "../supabaseClient";
import { requireAuth } from "../middleware/AuthMiddleware";
import { loadProfile } from "../middleware/LoadProfile";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).user.id;
  const token = (req as any).accessToken;

  const supabase = supabaseAsUser(token);

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

router.post("/", requireAuth, loadProfile, async (req, res) => {
  const userId = (req as any).user?.id;
  const token = (req as any).accessToken;
  const { name } = req.body;
  const profile = (req as any).profile;

  const supabase = supabaseAsUser(token);

  const { data: classData, error: classError } = await supabase
    .from("classes")
    .select()
    .eq("user_id", userId);

  if (!classData || classError) {
    return res.status(500).json({ error: "Error loading previous classes" });
  }

  if (
    profile.plan.class_limit &&
    classData?.length >= profile.plan.class_limit
  ) {
    return res.status(400).json({ error: "Max Free Classes Reached" });
  }

  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "Missing Class Name" });
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
  const userId = (req as any).user?.id;
  const { classId } = req.params;
  const { newTitle } = req.body;
  const token = (req as any).accessToken;

  if (!classId) {
    return res.status(400).json({ error: "Missing ClassID" });
  }

  const supabase = supabaseAsUser(token);

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
  const userId = (req as any).user?.id;
  const { classId } = req.params;
  const token = (req as any).accessToken;

  if (!classId) {
    return res.status(400).json({ error: "ClassID is Missing" });
  }

  const supabase = supabaseAsUser(token);

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
