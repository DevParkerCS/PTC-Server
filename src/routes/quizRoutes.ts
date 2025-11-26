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
import { FAKE_USER_ID } from "../server";
import { v4 as uuidv4 } from "uuid";
import { json } from "stream/consumers";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.get("/questions/:id", async (req, res) => {
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

router.post("/from-notes", upload.array("images"), async (req, res) => {
  try {
    const {
      notesText = "",
      gradeLevel = "",
      numQuestions = "10",
      classId = "",
    } = req.body;

    if (classId === "") {
      res.status(400).json({ error: "Missing Class ID" });
    }

    const files = (req.files as Express.Multer.File[]) ?? [];

    // 1) OCR all images
    const ocrPieces = [];
    for (const file of files) {
      const ocrText = await extractTextFromImageBuffer(file);
      ocrPieces.push(ocrText);
    }
    const ocrTextCombined = ocrPieces.join("\n\n");

    // 2) Combine typed notes + OCR within 10k char budget
    const MAX_CHARS = 10000;
    const typed = notesText.slice(0, MAX_CHARS);
    const remaining = MAX_CHARS - typed.length;
    const ocrTrimmed = remaining > 0 ? ocrTextCombined.slice(0, remaining) : "";

    const combinedNotes = [typed, ocrTrimmed].filter(Boolean).join("\n\n");

    // 3) Generate quiz from combined notes
    const quizObj = await generateQuizFromNotes({
      notes: combinedNotes,
      gradeLevel,
      numQuestions: Number(numQuestions),
    });

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

    if (quizError) {
      res.status(500).json(quizError);
    }

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

    const { data: questionData, error } = await supabase
      .from("quiz_questions")
      .insert(questionRows)
      .select();

    if (error) {
      res.status(500).json(error);
    }

    res.json({ quiz: quizData, questions: questionData });
  } catch (err) {
    console.error("Error in /from-notes:", err);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

export default router;
