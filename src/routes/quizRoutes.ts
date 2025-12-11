import express from "express";
import { supabase } from "../supabaseClient";
import { extractTextFromImageFile } from "../OpenAI/OCRUtils";
import {
  AiQuestion,
  DbQuestionRow,
  generateQuizFromNotes,
  shuffleOptions,
} from "../OpenAI/quizUtils";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { json } from "stream/consumers";
import { requireAuth } from "../middleware/AuthMiddleware";
import { error } from "console";
import path from "path";
import fs from "fs";
import fsPromises from "fs/promises";
import { loadProfile } from "../middleware/LoadProfile";

const uploadDir = path.join(__dirname, "..", "..", "uploads");

// Ensure the upload directory exists at startup
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

const router = express.Router();

router.get("/questions/:id", requireAuth, async (req, res) => {
  const quizId = req.params.id;

  if (!quizId) {
    return res.status(400).json({ error: "QuizId Is Missing" });
  }
  try {
    const [quizInfoRes, questionsRes] = await Promise.all([
      supabase.from("quizzes").select().eq("id", quizId).single(),
      supabase.from("quiz_questions").select().eq("quiz_id", quizId),
    ]);

    if (quizInfoRes.error) {
      return res.status(500).json({ error: "Error getting quiz info" });
    } else if (questionsRes.error) {
      return res.status(500).json({ error: "Error getting questions" });
    }

    const quizInfo = quizInfoRes.data;
    const questions = questionsRes.data;

    res.json({ quizInfo, questions });
  } catch (e) {
    res.status(500).json({ error: "Error Getting Quiz Content" });
  }
});

router.delete("/:quizId", requireAuth, async (req, res) => {
  const { quizId } = req.params;

  if (!quizId) {
    return res.status(400).json({ error: "QuizId is missing" });
  }

  try {
    const { data, error } = await supabase
      .from("quizzes")
      .delete()
      .eq("id", quizId)
      .single();

    if (error) {
      return res.status(500).json({ error: "Error deleting quiz" });
    }

    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: "Error deleting quiz" });
  }
});

router.patch("/:quizId/title", requireAuth, async (req, res) => {
  const { quizId } = req.params;
  const updates = req.body;

  try {
    const { data, error } = await supabase
      .from("quizzes")
      .update(updates)
      .eq("id", quizId);

    if (error) {
      console.log(error);
      return res.status(500).json({ error: "Error updating quiz" });
    }

    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: "Error updating title" });
  }
});

router.get("/:quizId/attempts", requireAuth, async (req, res) => {
  const { quizId } = req.params;
  console.log(quizId);

  if (!quizId) {
    return res.status(400).json({ error: "Missing quizId" });
  }

  try {
    const attemptsRes = await supabase
      .from("completed_quizzes")
      .select()
      .eq("quiz_id", quizId)
      .order("completed_at", { ascending: false });

    if (attemptsRes.error) {
      return res.status(500).json({ error: "Error fetching attempts" });
    }

    const attempts = attemptsRes.data;
    return res.status(200).json(attempts);
  } catch (e) {
    res.status(500).json({ error: "Error fetching attempts" });
  }
});

router.post("/:quizId/attempt", requireAuth, async (req, res) => {
  const { quizId } = req.params;
  const { numCorrect, seconds, incorrectIndexes } = req.body;
  const userId = (req as any).user?.id;

  // Basic validation - allow 0 but not undefined/null
  if (!quizId) {
    return res.status(400).json({ error: "Missing quizId" });
  }
  if (numCorrect === undefined || seconds === undefined) {
    return res
      .status(400)
      .json({ error: "numCorrect and seconds are required" });
  }
  if (!Array.isArray(incorrectIndexes)) {
    return res
      .status(400)
      .json({ error: "incorrectIndexes must be an array of numbers" });
  }

  try {
    // 1. Fetch current quiz stats
    const { data: quiz, error: quizFetchError } = await supabase
      .from("quizzes")
      .select(
        `
        id,
        average_score,
        highest_score,
        attempts_count,
        average_time_seconds
      `
      )
      .eq("id", quizId)
      .single();

    if (quizFetchError || !quiz) {
      console.error("Error fetching quiz stats:", quizFetchError);
      return res.status(404).json({ error: "Quiz not found" });
    }

    const prevAttempts = quiz.attempts_count ?? 0;
    const prevAvgScore = quiz.average_score ?? 0;
    const prevAvgTime = quiz.average_time_seconds ?? 0;
    const prevHighScore = quiz.highest_score ?? 0;

    const newAttempts = prevAttempts + 1;

    const newAverageScore = Math.round(
      (prevAvgScore * prevAttempts + numCorrect) / newAttempts
    );

    const newAverageTime = Math.round(
      (prevAvgTime * prevAttempts + seconds) / newAttempts
    );

    const newHighestScore = Math.max(prevHighScore, numCorrect);

    const now = new Date().toISOString();

    // 2. Update quiz stats + insert completed_quizzes row
    const [updateQuizRes, insertCompletedRes] = await Promise.all([
      supabase
        .from("quizzes")
        .update({
          average_score: newAverageScore,
          highest_score: newHighestScore,
          attempts_count: newAttempts,
          average_time_seconds: newAverageTime,
          last_taken_at: now,
        })
        .eq("id", quizId)
        .select()
        .single(),
      supabase
        .from("completed_quizzes")
        .insert({
          quiz_id: quizId,
          num_correct: numCorrect,
          incorrect_indexes: incorrectIndexes,
          seconds,
        })
        .select()
        .single(),
    ]);

    if (updateQuizRes.error) {
      console.error("Error updating quiz stats:", updateQuizRes.error);
      return res
        .status(500)
        .json({ error: "Failed to update quiz statistics" });
    }

    if (insertCompletedRes.error) {
      console.error(
        "Error inserting completed_quizzes row:",
        insertCompletedRes.error
      );
      return res
        .status(500)
        .json({ error: "Failed to record completed quiz attempt" });
    }

    return res
      .status(200)
      .json({ quiz: updateQuizRes.data, attempt: insertCompletedRes.data });
  } catch (e) {
    console.error("Unexpected error adding attempt:", e);
    return res.status(500).json({ error: "Error adding attempt" });
  }
});

type UsageType = {
  id: string;
  generations_used: number;
  period_start: string;
  period_end: string;
};

router.post(
  "/from-notes",
  requireAuth,
  loadProfile,
  upload.array("images"),
  async (req, res) => {
    const {
      notesText = "",
      gradeLevel = "",
      numQuestions = "10",
      classId = "",
      newQuizId = "",
      genExample = "false",
      existingQuiz = "false",
    } = req.body;

    const userId: string = (req as any).user?.id;
    const profile = (req as any).profile;
    const files = (req.files as Express.Multer.File[]) ?? [];
    const isNewQuiz: boolean = existingQuiz === "false";
    let reserved = false;

    // 🔒 1) Reserve a generation up front using the DB function
    const { error: reserveError } = await supabase.rpc("reserve_generation", {
      p_user_id: userId,
    });

    if (reserveError) {
      console.error("reserve_generation error:", reserveError);

      const msg = reserveError.message || reserveError.details || "";

      // Out of credits for current plan (free or pro)
      if (msg.includes("NO_CREDITS")) {
        return res.status(402).json({
          code: "OUT_OF_CREDITS",
          error: "You’ve used all your quiz generations for your current plan.",
        });
      }

      // Profile/plan misconfiguration
      if (msg.includes("PROFILE_NOT_FOUND") || msg.includes("PLAN_NOT_FOUND")) {
        return res.status(500).json({
          code: "PROFILE_OR_PLAN_ERROR",
          error: "Your account is not fully set up. Please contact support.",
        });
      }

      // No active period or other billing window issues
      if (msg.includes("NO_ACTIVE_USAGE_PERIOD")) {
        return res.status(402).json({
          code: "NO_ACTIVE_PERIOD",
          error: "No active usage period is configured for your subscription.",
        });
      }

      // Unexpected error reserving generation
      return res.status(500).json({
        code: "RESERVE_FAILED",
        error: "Could not reserve a quiz generation.",
      });
    }

    reserved = true;

    try {
      if (!classId || !newQuizId) {
        return res.status(400).json({ error: "Missing classId or newQuizId" });
      }

      if (isNewQuiz) {
        const { data: generatingData, error: generatingError } = await supabase
          .from("quizzes")
          .insert({
            id: newQuizId,
            class_id: classId,
            title: "Generating...",
            num_questions: numQuestions,
            status: "generating",
            difficulty: gradeLevel,
          })
          .select()
          .single();

        if (generatingError || !generatingData) {
          if (generatingError?.code === "23505") {
            return res
              .status(500)
              .json({ error: "Duplicate Attempts Detected" });
          }
          return res.status(500).json({ error: "Error inserting new quiz" });
        }
      } else {
        const { error: generatingError } = await supabase
          .from("quizzes")
          .update({
            created_at: new Date().toISOString(),
            title: "Generating...",
            num_questions: numQuestions,
            status: "generating",
            difficulty: gradeLevel,
          })
          .eq("id", newQuizId);

        if (generatingError) {
          return res.status(500).json({ error: "Error updating old quiz" });
        }

        // 🔥 clear out old questions for this quiz before inserting new ones
        const { error: deleteError } = await supabase
          .from("quiz_questions")
          .delete()
          .eq("quiz_id", newQuizId);

        if (deleteError) {
          console.error("Error deleting old questions:", deleteError);
          return res
            .status(500)
            .json({ error: "Error resetting quiz questions" });
        }
      }

      // 🧾 OCR loop
      const ocrPieces: string[] = [];
      for (const file of files) {
        const ocrText = await extractTextFromImageFile(file);
        if (ocrText) ocrPieces.push(ocrText);
      }

      const ocrTextCombined = ocrPieces.join("\n\n");

      // 20k char budget: typed notes first, then OCR
      const MAX_CHARS = 20000;
      const typed = notesText.slice(0, MAX_CHARS);
      const remaining = MAX_CHARS - typed.length;
      const ocrTrimmed =
        remaining > 0 ? ocrTextCombined.slice(0, remaining) : "";

      const combinedNotes = [typed, ocrTrimmed].filter(Boolean).join("\n\n");

      // 🤖 Call OpenAI quiz generator
      const quizObj = await generateQuizFromNotes({
        notes: combinedNotes,
        gradeLevel,
        numQuestions: Number(numQuestions),
        genExample: genExample === "true" || genExample === true,
      });

      // Update quiz with final title/num_questions/status
      const { data: quizData, error: quizError } = await supabase
        .from("quizzes")
        .update({
          title: quizObj.quiz.title,
          class_id: classId,
          num_questions: quizObj.questions.length,
          status: "ready",
        })
        .eq("id", newQuizId)
        .eq("status", "generating")
        .select()
        .single();

      if (quizError) {
        console.error("quiz update error:", quizError);
        return res.status(500).json({ error: "Error updating quiz" });
      }

      if (!quizData) {
        return res.status(409).json({ error: "Quiz was cancelled or deleted" });
      }

      // Build question rows
      const questionRows: DbQuestionRow[] = quizObj.questions.map(
        (q: AiQuestion) => {
          const { options, correctIndex } = shuffleOptions(
            q.correct_answer,
            q.incorrect_answers
          );

          const optionObjects = options.map((text) => ({
            id: uuidv4(),
            text,
          }));

          return {
            quiz_id: quizData.id,
            question: q.question,
            options: optionObjects,
            correct_index: correctIndex,
            explanation: q.explanation,
          };
        }
      );

      const { data: questionData, error: questionError } = await supabase
        .from("quiz_questions")
        .insert(questionRows)
        .select();

      if (questionError) {
        console.error("Question insert error:", questionError);
        return res.status(500).json({ error: "Error inserting questions" });
      }

      return res.status(200).json({
        quiz: quizData,
        questions: questionData,
      });
    } catch (err) {
      console.error("Error in /quiz/from-notes:", err);

      // mark quiz as error if we got that far
      try {
        if (newQuizId) {
          await supabase
            .from("quizzes")
            .update({ status: "error", title: "Error Generating" })
            .eq("id", newQuizId);
        }
      } catch {
        // ignore secondary failure
      }

      if (reserved) {
        try {
          await supabase.rpc("refund_generation", { p_user_id: userId });
        } catch (refundErr) {
          console.error("refund_generation failed:", refundErr);
          // even if refund fails, we still return the main error
        }
      }

      // We do NOT refund the reserved generation here (Option B).
      return res.status(500).json({ error: "Error generating quiz" });
    } finally {
      await Promise.all(
        files.map((file) =>
          file.path
            ? fsPromises.unlink(file.path).catch(() => {
                // ignore unlink errors
              })
            : Promise.resolve()
        )
      );
    }
  }
);

router.patch("/:quizId/setError", requireAuth, async (req, res) => {
  const { quizId } = req.params;

  if (!quizId) {
    return res.status(400).json({ error: "Missing QuizID" });
  }

  try {
    await supabase
      .from("quizzes")
      .update({ status: "error", title: "Error Generating" })
      .eq("id", quizId)
      .eq("status", "generating");

    return res.status(200);
  } catch (e) {
    return res.status(500).json({ error: "Error Updating Quiz" });
  }
});

export default router;
