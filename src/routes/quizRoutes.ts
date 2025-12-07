import express from "express";
import { supabase } from "../supabaseClient";
import { extractTextFromImageBuffer } from "../OpenAI/OCRUtils";
import {
  AiQuestion,
  balanceQuizAnswers,
  DbQuestionRow,
  generateQuizFromNotes,
  shuffleOptions,
} from "../OpenAI/quizUtils";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { json } from "stream/consumers";
import { requireAuth } from "../middleware/AuthMiddleware";
import { error } from "console";

const upload = multer({ storage: multer.memoryStorage() });
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
      supabase.from("completed_quizzes").insert({
        quiz_id: quizId,
        num_correct: numCorrect,
        incorrect_indexes: incorrectIndexes,
        seconds,
      }),
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

    return res.status(200).json({
      message: "Attempt recorded successfully",
      quizStats: updateQuizRes.data,
    });
  } catch (e) {
    console.error("Unexpected error adding attempt:", e);
    return res.status(500).json({ error: "Error adding attempt" });
  }
});

router.post(
  "/from-notes",
  requireAuth,
  upload.array("images"),
  async (req, res) => {
    // Let the client know this will be a streaming JSON response
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const send = (data: any) => {
      res.write(JSON.stringify(data) + "\n");
    };

    try {
      const {
        notesText = "",
        gradeLevel = "",
        numQuestions = "10",
        classId = "",
        genExample = "false",
      } = req.body;

      if (!classId) {
        send({ stage: "error", error: "Missing Class ID" });
        return res.end();
      }

      const files = (req.files as Express.Multer.File[]) ?? [];

      // ---- OCR STAGE ----
      send({ stage: "ocr_started" });

      const ocrPieces: string[] = [];
      for (const file of files) {
        const ocrText = await extractTextFromImageBuffer(file);
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

      send({
        stage: "ocr_done",
        meta: {
          typedLength: typed.length,
          ocrLength: ocrTrimmed.length,
          combinedLength: combinedNotes.length,
        },
      });

      // ---- QUIZ GENERATION STAGE ----
      send({ stage: "quiz_started" });

      const quizObj = await generateQuizFromNotes({
        notes: combinedNotes,
        gradeLevel,
        numQuestions: Number(numQuestions),
        genExample: genExample === "true" || genExample === true,
      });

      // const balancedQuiz = await balanceQuizAnswers(quizObj);

      // send({ stage: "cleaning_quiz" });

      // Insert quiz row
      const { data: quizData, error: quizError } = await supabase
        .from("quizzes")
        .insert([
          {
            title: quizObj.quiz.title,
            class_id: classId,
            num_questions: quizObj.questions.length,
          },
        ])
        .select()
        .single();

      if (quizError || !quizData) {
        console.error("Quiz insert error:", quizError);
        send({
          stage: "error",
          error: "Failed to save quiz",
          details: quizError,
        });
        return res.end();
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

      // Insert questions
      const { data: questionData, error: questionError } = await supabase
        .from("quiz_questions")
        .insert(questionRows)
        .select();

      if (questionError) {
        console.error("Question insert error:", questionError);
        send({
          stage: "error",
          error: "Failed to save quiz questions",
          details: questionError,
        });
        return res.end();
      }

      // Final success payload
      send({
        stage: "quiz_done",
        quiz: quizData,
        questions: questionData,
      });

      res.end();
    } catch (err) {
      console.error("Error in POST /from-notes (combined):", err);
      send({ stage: "error", error: "Failed to generate quiz" });
      res.end();
    }
  }
);

export default router;
