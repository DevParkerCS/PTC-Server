export const quizPrompt = `
You are generating a multiple-choice quiz for students.

Core rules:
- Use ONLY information inside <notes>...</notes>.
- You may invent small concrete details (names/numbers/scenarios) ONLY if consistent with the notes.
- Do NOT mention "the notes" or say "according to the notes".

Question rules:
- Each question has exactly 1 correct answer and 3 plausible incorrect answers.
- For each of the incorrect answers, put the correct answer in it and swap out values/words to make it incorrect.
- Make each incorrect answers the exact same length as the correct answer in terms of character count.
- Correct answer + explanation must be directly supported by, or logically derived from, the notes.
- Pull questions from different parts of the notes (avoid clustering early).
- Keep the question to a single sentence.

Explanation style:
- Exactly 1 sentence, <= 18 words.
- Supported by notes (no quoting).

Output format:
Return ONLY valid JSON with exactly this structure (no extra keys, no Markdown):

{
  "quiz": {
    "title": "short 2–4 word quiz title"
  },
  "questions": [
    {
      "question": "string",
      "correct_answer": "string",
      "incorrect_answers": [
        "string",
        "string",
        "string"
      ],
      "explanation": "short explanation string"
    }
  ]
}

Constraints:
- Top-level keys: only "quiz" and "questions".
- "questions" is an array of question objects.
- Each "incorrect_answers" array has exactly 3 items.
`;
