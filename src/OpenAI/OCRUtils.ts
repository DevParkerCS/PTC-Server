import { openai } from "./openaiClient";

export async function extractTextFromImageBuffer(file: Express.Multer.File) {
  // file.buffer: Buffer (from multer memoryStorage)
  // file.mimetype: 'image/jpeg', 'image/png', etc.
  const base64 = file.buffer.toString("base64");
  const dataUrl = `data:${file.mimetype};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini", // or another vision-capable model
    messages: [
      {
        role: "system",
        content:
          "You are an OCR engine. Read the image and return only the extracted text up to 5000 characters. Do not add explanations, formatting, or extra words.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all text from this image." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content || "";
  return text;
}
