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
    model: "gpt-4.1-mini",
    service_tier: "priority",
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
    ? "For this quiz, some questions should be concrete practice problems that directly use the concepts in the student's notes. Ask the student to solve, simplify, or interpret something.  Aim for at least half of the questions to be of this type"
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

  const quizObj: QuizAIObject = JSON.parse(cleanJsonFromModel(text));
  // return quizObj;
  try {
    const rebalanced = await rebalanceQuiz({
      quiz: quizObj,
      notes,
    });
    return rebalanced;
  } catch (e) {
    // If rebalance fails for any reason, fall back to original quiz.
    return quizObj;
  }
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

// --- NEW: robust JSON cleaner ---
const cleanJsonFromModel = (text: string) => {
  return text
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
};

// --- UPDATED: rebalance prompt (NO NOTES) ---
const rebalancePrompt = `
You are a quiz rebalancer. Your ONLY job is to remove length-based answer giveaways (longest OR shortest) using ONLY the provided quiz JSON, while ensuring any rewritten incorrect answers do not contradict the notes.

Rules:
- Use <notes> ONLY as a constraint/check so rewritten incorrect answers remain consistent with the notes.
- Treat the existing correct_answer as ground truth. Do NOT change its meaning.
- Do NOT change the question text unless absolutely necessary (prefer rewriting incorrect answers only).
- Return ONLY valid JSON in the exact schema below. No markdown. No extra keys.
- Keep the same quiz title and the same number of questions.

Task (do this for EACH question):
1) Compute word counts for:
   - correct_answer (Nc)
   - each incorrect answer (Ni1, Ni2, Ni3)
   - Let minI = min(Ni1,Ni2,Ni3), maxI = max(Ni1,Ni2,Ni3)

2) If BOTH are true, make NO changes:
   - Nc is NOT strictly greater than maxI (correct is not uniquely longest), AND
   - Nc is NOT strictly less than minI (correct is not uniquely shortest), AND
   - All incorrect answers are within Nc±1 words.

3) Otherwise, rewrite incorrect_answers with MINIMAL changes until ALL are true:
   A) Length neutrality (HARD):
      - correct_answer must NOT be the unique longest option.
      - correct_answer must NOT be the unique shortest option.
      (Ties are allowed.)
   B) Tight length band (HARD):
      - Each incorrect answer must be within Nc±1 words.
      - At least one incorrect answer must have word count >= Nc.
      - At least one incorrect answer must have word count <= Nc.
   C) Minimal-change procedure:
      - If correct is uniquely shortest: rewrite ONLY the SINGLE longest incorrect answer to shorten it (or rewrite another to shorten),
        keeping it plausible and within Nc±1.
      - If correct is uniquely longest: rewrite ONLY the SINGLE shortest incorrect answer to lengthen it (or next shortest if needed),
        keeping it plausible and within Nc±1.
      - Re-check after each single-answer rewrite and stop as soon as all constraints pass.
   D) Quality constraints:
      - Incorrect answers remain clearly incorrect but still plausible.
      - Rewritten incorrect answers must NOT introduce facts or rules that contradict <notes>.

Notes (STRICT):
- Do NOT add new rules/facts not supported by <notes>.
- If the notes do not mention a specific value/detail, keep distractors generic rather than inventing specifics.
- Keep incorrect answers the same general “shape” as the correct answer (phrase vs sentence).

Do NOT change correct_answer text unless you cannot satisfy the rules otherwise.

Output schema (EXACT):
{
  "quiz": { "title": "string" },
  "questions": [
    {
      "question": "string",
      "correct_answer": "string",
      "incorrect_answers": ["string","string","string"],
      "explanation": "string"
    }
  ]
}
`.trim();

const chunkArray = <T>(arr: T[], size: number): T[][] => {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size)
    chunks.push(arr.slice(i, i + size));
  return chunks;
};

const tryParseRebalancedQuiz = (text: string): QuizAIObject | null => {
  try {
    const cleaned = cleanJsonFromModel(text);
    return JSON.parse(cleaned) as QuizAIObject;
  } catch {
    return null;
  }
};

export const rebalanceQuiz = async (params: {
  quiz: QuizAIObject;
  notes: string;
  batchSize?: number; // default 10
}) => {
  const { quiz, notes } = params;

  const total = quiz.questions.length;
  if (total < 5 || total > 50) {
    throw new Error(`Quiz must have 5–50 questions. Received ${total}.`);
  }

  // Recommended default: 10 (max 5 calls for 50 questions)
  const batchSize = 10;
  const batches = chunkArray(quiz.questions, batchSize);

  const rebalancedQuestions: QuizAIObject["questions"] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const originalBatchQuestions = batches[batchIndex];

    const batchQuiz: QuizAIObject = {
      quiz: { title: quiz.quiz.title },
      questions: originalBatchQuestions,
    };

    try {
      // --- First attempt ---
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        service_tier: "priority",
        messages: [
          { role: "system", content: rebalancePrompt },
          {
            role: "user",
            content: `
<notes>${notes}</notes>
<quiz_json>${JSON.stringify(batchQuiz)}</quiz_json>
            `.trim(),
          },
        ],
      });

      const text = response.choices?.[0]?.message?.content || "";
      let parsed = tryParseRebalancedQuiz(text);

      // --- Retry if parse failed ---
      if (!parsed) {
        const retry = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          service_tier: "priority",
          messages: [
            { role: "system", content: rebalancePrompt },
            {
              role: "user",
              content: `
Your last output was not valid JSON. Output ONLY valid JSON in the exact schema.
This is batch ${batchIndex + 1} of ${batches.length}.
Only rebalance the questions inside <quiz_json>. Do not add/remove/reorder questions.

<notes>${notes}</notes>
<quiz_json>${JSON.stringify(batchQuiz)}</quiz_json>
              `.trim(),
            },
          ],
        });

        const retryText = retry.choices?.[0]?.message?.content || "";
        parsed = tryParseRebalancedQuiz(retryText);
      }

      // --- If still bad, fall back to original batch (no crash) ---
      if (
        !parsed ||
        !parsed.questions ||
        parsed.questions.length !== originalBatchQuestions.length
      ) {
        console.warn(
          `[rebalanceQuiz] Batch ${batchIndex + 1}/${
            batches.length
          } failed (parse/schema). Falling back to original batch.`
        );
        rebalancedQuestions.push(...originalBatchQuestions);
        continue;
      }

      rebalancedQuestions.push(...parsed.questions);
    } catch (err) {
      // Any API/network error: also fall back to original batch
      console.warn(
        `[rebalanceQuiz] Batch ${batchIndex + 1}/${
          batches.length
        } threw error. Falling back to original batch.`,
        err
      );
      rebalancedQuestions.push(...originalBatchQuestions);
    }
  }

  return {
    quiz: { title: quiz.quiz.title },
    questions: rebalancedQuestions,
  } as QuizAIObject;
};
