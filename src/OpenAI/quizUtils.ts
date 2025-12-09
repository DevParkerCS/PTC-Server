import { openai } from "./openaiClient";
import { quizPrompt } from "../API/quizPrompts";

type GQMParams = {
  notes: string;
  gradeLevel: string;
  numQuestions: number;
  genExample: boolean;
};

export type QuizAIObject = {
  quiz: {
    title: string;
  };
  questions: AiQuestion[];
};

export type AiQuestion = {
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
  explanation: string;
};

export const generateQuizFromNotes = async ({
  notes,
  gradeLevel,
  numQuestions,
  genExample,
}: GQMParams) => {
  console.log(genExample);

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: quizPrompt },
      {
        role: "system",
        content: `
Additional constraints:
- Try your hardest to generate exactly ${numQuestions} unique questions. Make sure to grab questions from different sections in the notes and not just generate the first ${numQuestions} questions.
- If the notes do not support ${numQuestions} good questions, generate fewer.
- Match difficulty to a ${gradeLevel || "college"} student.
${
  genExample
    ? "For this quiz, some questions should be concrete practice problems that directly use the concepts in the student's notes. Ask the student to solve, simplify, or interpret something."
    : ""
}
        `.trim(),
      },
      {
        role: "user",
        content: `<notes>${notes}</notes>`,
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content || "";

  const cleaned = text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const quizObj: QuizAIObject = JSON.parse(cleaned);

  return quizObj;
};

type ShuffledResult = {
  options: string[];
  correctIndex: number;
};

export type DbQuestionRow = {
  quiz_id: string;
  question: string;
  options: { id: string; text: string }[];
  correct_index: number;
  explanation: string;
};

export const shuffleOptions = (
  correct: string,
  incorrect: string[]
): ShuffledResult => {
  const tagged = [
    { text: correct, isCorrect: true },
    ...incorrect.map((opt) => ({ text: opt, isCorrect: false })),
  ];

  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }

  const correctIndex = tagged.findIndex((o) => o.isCorrect);
  return { options: tagged.map((o) => o.text), correctIndex };
};
