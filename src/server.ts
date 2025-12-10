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
    origin: [
      "http://localhost:3000",
      "http://10.20.8.48:3000", // your LAN dev origin
      "https://passthatclass.com",
      "https://www.passthatclass.com",
    ],
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
