// src/OpenAI/OCRUtils.ts
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import vision from "@google-cloud/vision";

const MAX_OCR_CHARS = 20000;
const MAX_OCR_LONG_EDGE = 1600;

const credentials = process.env.GCP_VISION_API
  ? JSON.parse(process.env.GCP_VISION_API)
  : undefined;

const visionClient = new vision.ImageAnnotatorClient(
  credentials ? { credentials } : {}
);

export async function extractTextFromImageBuffer(
  file: Express.Multer.File
): Promise<string> {
  const start = performance.now();

  try {
    const resizedBuffer = await sharp(file.buffer)
      .resize({
        width: MAX_OCR_LONG_EDGE,
        height: MAX_OCR_LONG_EDGE,
        fit: "inside",
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    const [result] = await visionClient.textDetection({
      image: { content: resizedBuffer },
    });

    const text = result.fullTextAnnotation?.text ?? "";

    const end = performance.now();
    console.log(
      `extractTextFromImageBuffer (Vision) took ${(end - start).toFixed(0)} ms`
    );

    if (!text) return "";
    return text.slice(0, MAX_OCR_CHARS);
  } catch (err) {
    const end = performance.now();
    console.error(
      `extractTextFromImageBuffer (Vision) failed after ${(end - start).toFixed(
        0
      )} ms`,
      err
    );
    throw new Error("Error Parsing Image");
  }
}
