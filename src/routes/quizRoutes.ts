import express from "express";
import { supabase } from "../supabaseClient";
import { extractTextFromImageBuffer } from "../OpenAI/OCRUtils";
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
    res.status(400).json({ error: "QuizId is missing" });
  }

  try {
    const { data, error } = await supabase
      .from("quizzes")
      .delete()
      .eq("id", quizId)
      .single();

    if (error) {
      res.status(500).json({ error: "Error deleting quiz" });
    }

    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: "Error deleting quiz" });
  }
});

router.post(
  "/from-notes/ocr",
  requireAuth,
  upload.array("images"),
  async (req, res) => {
    try {
      const { notesText = "" } = req.body;

      const files = (req.files as Express.Multer.File[]) ?? [];

      // 1) OCR all images
      const ocrPieces: string[] = [];
      for (const file of files) {
        const ocrText = await extractTextFromImageBuffer(file);
        if (ocrText) ocrPieces.push(ocrText);
      }
      const ocrTextCombined = ocrPieces.join("\n\n");

      // 2) Combine typed notes + OCR within 20k char budget
      const MAX_CHARS = 20000;
      const typed = notesText.slice(0, MAX_CHARS);
      const remaining = MAX_CHARS - typed.length;
      const ocrTrimmed =
        remaining > 0 ? ocrTextCombined.slice(0, remaining) : "";

      const combinedNotes = [typed, ocrTrimmed].filter(Boolean).join("\n\n");

      // Return all pieces so frontend can decide what to use
      res.json({
        combinedNotes,
        typedNotes: typed,
        ocrText: ocrTrimmed,
      });
    } catch (err) {
      console.error("Error in /from-notes/ocr:", err);
      res.status(500).json({ error: "Failed to extract text from notes" });
    }
  }
);

router.post("/from-notes", requireAuth, async (req, res) => {
  try {
    const {
      notesText = "",
      gradeLevel = "",
      numQuestions = "10",
      classId = "",
      genExample = false,
    } = req.body;

    if (!classId) {
      return res.status(400).json({ error: "Missing Class ID" });
    }

    // 1) Generate quiz from provided notes text
    const quizObj = await generateQuizFromNotes({
      notes: notesText,
      gradeLevel,
      numQuestions: Number(numQuestions),
      genExample,
    });

    // 2) Insert quiz row
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
      return res
        .status(500)
        .json({ error: "Failed to save quiz", details: quizError });
    }

    // 3) Build question rows
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

    // 4) Insert questions
    const { data: questionData, error: questionError } = await supabase
      .from("quiz_questions")
      .insert(questionRows)
      .select();

    if (questionError) {
      console.error("Question insert error:", questionError);
      return res.status(500).json({
        error: "Failed to save quiz questions",
        details: questionError,
      });
    }

    res.json({ quiz: quizData, questions: questionData });
  } catch (err) {
    console.error("Error in POST /from-notes:", err);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

export default router;
