import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import classesRoutes from "./routes/classesRoutes";
import contentRoutes from "./routes/contentRoutes";
import quizRoutes from "./routes/quizRoutes";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000", // your React dev server
    // credentials: true,
  })
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/classes", classesRoutes);
app.use("/content", contentRoutes);
app.use("/quiz", quizRoutes);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
