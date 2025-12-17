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

const scenarioInstruction =
  `For this quiz, generate mostly scenario-based practice problems that make the student apply the notes in realistic situations. ` +
  `Aim for ~80–90% of questions to follow this format: Scenario → Task → Answer format. ` +
  `Each should require multi-step reasoning and use concrete details/numbers when possible. Avoid pure recall. ` +
  `Use the notes’ terminology and rules only. The remaining 10–20% can be short checks for key definitions needed to solve the harder problems.`;

export const generateQuizFromNotes = async ({
  notes,
  gradeLevel,
  numQuestions,
  genExample,
}: GQMParams): Promise<QuizAIObject> => {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    service_tier: "priority",
    stream: false,
    messages: [
      { role: "system", content: quizPrompt },
      {
        role: "system",
        content: `
Additional constraints:
- Try your hardest to generate exactly ${numQuestions} unique questions.
- Pull questions from different sections in the notes (avoid clustering early).
- If the notes do not support ${numQuestions} good questions, generate fewer.
- Match difficulty to a ${gradeLevel || "college"} student.
${genExample ? `- ${scenarioInstruction}` : ""}
        `.trim(),
      },
      { role: "user", content: `<notes>${notes}</notes>` },
    ],
  });

  const text = response.choices?.[0]?.message?.content || "";
  const quizObj: QuizAIObject = JSON.parse(cleanJsonFromModel(text));
  return quizObj;
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

// --- robust JSON cleaner ---
const cleanJsonFromModel = (text: string) => {
  return text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
};
