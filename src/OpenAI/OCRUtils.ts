// src/OpenAI/OCRUtils.ts
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import vision from "@google-cloud/vision";
import fsPromises from "fs/promises";

const MAX_OCR_LONG_EDGE = 1600;

const credentials = process.env.GCP_VISION_API
  ? JSON.parse(process.env.GCP_VISION_API)
  : undefined;

const visionClient = new vision.ImageAnnotatorClient(
  credentials ? { credentials } : {}
);

type OcrResult = {
  text: string;
  pagesUsed: number; // how many "image slots" this call consumed
};

export async function extractTextFromImageFile(
  file: Express.Multer.File,
  numImagesProcessed: number,
  profile: any
): Promise<OcrResult> {
  const start = performance.now();
  const filePath = file.path;
  const mime = file.mimetype;

  try {
    // ---- PDF PATH (Vision, each page = 1 "image") ----
    if (mime === "application/pdf") {
      const imageLimit: number =
        profile?.plan?.image_limit ?? Number.POSITIVE_INFINITY;

      const remainingSlots = Math.max(0, imageLimit - numImagesProcessed);

      // no remaining "image slots" → skip entirely
      if (remainingSlots <= 0) {
        console.log(
          `Skipping PDF ${file.originalname}: image limit ${imageLimit} reached (processed ${numImagesProcessed}).`
        );
        return { text: "", pagesUsed: 0 };
      }

      const pdfBytes = await fsPromises.readFile(filePath);

      // Vision only allows up to 5 pages per call
      const maxPagesThisCall = Math.min(remainingSlots, 5);

      // Example: only ever ask for 1..10, but capped by both limits
      const allPages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const pagesToProcess = allPages.slice(0, maxPagesThisCall);

      const request = {
        requests: [
          {
            inputConfig: {
              mimeType: "application/pdf",
              content: pdfBytes,
            },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            pages: pagesToProcess, // 👈 now ≤ 5
          },
        ],
      };

      const [batchResult] = await visionClient.batchAnnotateFiles(
        request as any
      );

      const fileResponses = batchResult.responses?.[0]?.responses ?? [];

      let fullText = "";
      for (const resp of fileResponses) {
        const pageText = resp.fullTextAnnotation?.text;
        if (pageText) {
          fullText += pageText + "\n";
        }
      }

      const text = fullText.trim();
      const end = performance.now();
      console.log(
        `extractTextFromImageFile (Vision PDF) got ${text.length} chars from ${
          fileResponses.length
        } pages in ${(end - start).toFixed(0)} ms`
      );

      if (!text) {
        return { text: "", pagesUsed: fileResponses.length };
      }

      return {
        text,
        pagesUsed: fileResponses.length, // each page counts as one "image"
      };
    }

    // ---- IMAGE PATH ----
    // sharp can take a file path directly
    const resizedBuffer = await sharp(filePath)
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
      `extractTextFromImageFile (Vision image) took ${(end - start).toFixed(
        0
      )} ms`
    );

    return { text, pagesUsed: 1 };
  } catch (err) {
    const end = performance.now();
    console.error(
      `extractTextFromImageFile (Vision) failed after ${(end - start).toFixed(
        0
      )} ms`,
      err
    );
    throw new Error("Error Parsing Image");
  }
}
