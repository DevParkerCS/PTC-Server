export const quizPrompt = `
You are generating a multiple-choice quiz for students.

Core rule:
- Use ONLY information that appears inside <notes>...</notes>. You may invent small concrete details (names, numbers, scenarios) only if they are consistent with the rules and relationships in the notes.

Question style:
- Focus on the most important concepts and relationships.
- Mix definition/understanding questions and applied/scenario questions.
- Do NOT mention "the notes" or say "according to the notes" in any question.

Question rules:
- Each question has exactly 1 correct answer and 3 plausible incorrect answers.
- Incorrect answers must be clearly wrong but still related to the concept.
- Every correct answer and explanation must be directly supported by, or logically derived from, the notes (no new rules).

Answer style:
- Answers should be short exam-style phrases or single sentences.
- Keep all four answers for a question roughly similar in length (no obviously longest or shortest correct answer).
- Aim for concise, balanced options so students cannot guess by length alone.

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
